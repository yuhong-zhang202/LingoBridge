/**
 * @module   AnalysisPage
 * @desc     题目分析页外壳 —— 集中持有取数/换词/收藏/跳转逻辑（savedSet 的 localStorage 读写为单一真源），
 *           按 lg 断点分发移动/桌面两套视图：<1024 渲染 AnalysisMobile；≥1024 用 FlowShellDesktop
 *           （analysis 步激活）包住 AnalysisDesktop。逻辑单实例，两视图仅接收状态与回调做展示。
 * @author   LingoBridge
 * @created  2026-05-28
 */
'use client'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { mutate } from 'swr'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useNav } from '@/components/NavProgress'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
import Toast from '@/components/Toast'
import AnalysisMobile from './AnalysisMobile'
import AnalysisDesktop from './AnalysisDesktop'
import AnalysisTopProgress from './_components/AnalysisTopProgress'
import type { AnalysisViewProps } from './types'
import type { AnalysisResponse, AnalysisPhraseGroup, AnalysisPhrase, AnalysisFocusPoint, SavedWord } from '@/lib/types'
import { addSavedWord, removeSavedWord, listSavedWords } from '@/lib/db/saved-words'
import { useSavedWords, SAVED_WORDS_KEY } from '@/hooks/library-data'
import { apiFetch } from '@/lib/api-client'
import { requestAnalysis, type AnalysisSnapshot } from '@/lib/analysis-inflight'
import { useAccount } from '@/hooks/useAccount'
import { targetBandToLevel } from '@/lib/constants'

/**
 * 从「进行中」的流式 snapshot（meta + 已到段）拼一个 partial AnalysisResponse 驱动逐段渲染：
 * structureLabel / focusPoints / phrases 按已到段填，未到的为空（视图对应区块自然留空占位）。
 * done 帧到达后由权威 final 整份替换，故 partial 只在流式中途生效。
 * @param meta      meta 帧的题目展示信息（此时必非 null）
 * @param sections  已到的段序列
 * @returns         进行中的 partial 分析结果
 */
function buildPartialAnalysis(
  meta: NonNullable<AnalysisSnapshot['meta']>,
  sections: AnalysisSnapshot['sections'],
): AnalysisResponse {
  let structureLabel = ''
  const focusPoints: AnalysisFocusPoint[] = []
  const phrases: AnalysisPhraseGroup[] = []
  for (const s of sections) {
    if (s.kind === 'structureLabel') structureLabel = s.value
    else if (s.kind === 'focusPoint') focusPoints.push(s.value)
    else phrases.push(s.value)
  }
  return { question: meta, analysis: { structureLabel, focusPoints, phrases } }
}

function AnalysisContent() {
  const router     = useRouter()
  const { navigate } = useNav()
  const params     = useSearchParams()
  const questionId = params.get('questionId') ?? ''
  const storyId    = params.get('storyId') ?? ''
  const review     = params.get('review') === '1'
  // 选题行为埋点(乙.2)：rank 从匹配页跳转 query 透传而来（仅故事流有），此页只做「有则续传给 practice」的管道，
  // 自身不解读；泛题池流无此 query → 空串 → 不拼进 practice URL。仅接受 1..10000 正整数字符串（上界与
  // events 侧 route.ts 收敛口径对齐，防深链构造超大 rank），脏值/超界忽略、不续传。
  const rankParam  = params.get('rank')
  const rank       = rankParam !== null && /^[1-9]\d*$/.test(rankParam) && Number(rankParam) <= 10000 ? rankParam : ''
  // 流向判别：from=matching（故事流）→ 回匹配页；from=restructure（雅思流）→ 回整理页（带 qid）；
  // from=question-bank（题库练习入口）→ 回题库页；深链缺 from → 安全默认回首页，绝不静默走错分支。
  const from       = params.get('from')
  const backTarget = from === 'matching'
    ? { href: `/matching?corpusId=${storyId}`, label: '返回题目' }
    : from === 'restructure'
      ? { href: `/restructure?corpusId=${storyId}&qid=${questionId}`, label: '返回整理' }
      : from === 'question-bank'
        ? { href: '/question-bank', label: '返回题库' }
        : from === 'practice-question'
          ? { href: `/practice-question?questionId=${questionId}`, label: '返回题目' }
          : { href: '/', label: '返回首页' }
  const [data, setData]       = useState<AnalysisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  // 402（匿名试用额度用尽）→ 弹 QuotaReached trial 引导注册；429（注册用户当日上限）→ 行内/Toast 提示，绝不引导注册。
  // 记来源而非布尔：两处 402 的关闭语义不同 —— 整页取数失败关掉只能回首页（页面无内容），
  // 换词失败时页面主体（当前档位词组）还在，关掉应留在原页继续看。
  const [quotaShown, setQuotaShown] = useState<'page' | 'phrases' | null>(null)
  const [dailyLimitHit, setDailyLimitHit] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [openPhrase, setOpenPhrase] = useState<string | null>(null)
  // 词组档位：初值【直接取 account 目标分映射档】。useAccount 是模块级共享快照、卸载保留 → 匹配→分析/题库→分析
  // 常见路径首帧 account 即热、初值即真实档位，取数 effect 首帧读 levelRef 拿到的就是对的档 —— 从而复用匹配页
  // 点击即发的在飞请求（同键 id::corpus::band）、不冷发一条 6.0 白烧、不出现「标签 7.0 配 6.0 词组」的脱节。
  // 冷深链（account 首帧为 null）回落 '6.0'，account 到位后由下方 effect【一次性】校正选择器（levelInitRef 守卫）。
  const { account } = useAccount()
  const [level, setLevel] = useState(() => targetBandToLevel(account?.targetBand ?? null))
  const levelInitRef = useRef(false)
  // fetchedLevelRef：记初次取数实际用的档位（当时 levelRef 的值），供下方 account 校正时判断冷路径是否需自愈重取。
  const fetchedLevelRef = useRef<string | null>(null)
  useEffect(() => {
    if (account && !levelInitRef.current) {
      levelInitRef.current = true
      const corrected = targetBandToLevel(account.targetBand)
      setLevel(corrected)
      // 冷深链自愈：account 未热时首取用了 '6.0' 兜底，account 到位后若真实档 ≠ 已取的档，重取一次 ——
      // 否则「选择器显真档、内容是旧档」且点当前档 changeLevel no-op 无法自救（product-logic 复查·发现1）。
      // 热路径首取即真档（fetchedLevelRef===corrected）、不触发；此 effect 有 levelInitRef 守卫只跑一次、不成环。
      if (fetchedLevelRef.current !== null && fetchedLevelRef.current !== corrected) {
        setRetryKey((k) => k + 1)
      }
    }
  }, [account])
  // levelRef：供「初次取分析」effect（依赖仅 questionId/retryKey，不含 level，避免 account 迟到触发重取双计）
  // 在发起 requestAnalysis / 降级请求时读到最新档位。
  const levelRef = useRef(level)
  levelRef.current = level
  const [levelMenuOpen, setLevelMenuOpen] = useState(false)
  const [phrasesLoading, setPhrasesLoading] = useState(false)
  // 已收藏词组高亮：以云端 useSavedWords 为唯一真源，直接派生集合（不镜像成本地 state，
  // 否则「用 effect 同步 state」会因 savedWords 每 render 新引用而无限重渲染 / Maximum update depth）。
  const { words: savedWords } = useSavedWords()
  const savedSet = useMemo(() => new Set(savedWords.map(w => w.text)), [savedWords])
  const [retryKey, setRetryKey] = useState(0)
  // A15 防重入：error 态两个重试入口共用一个 ref 守卫，连点只触发一次重新分析
  const [retry] = useAsyncAction(() => setRetryKey(k => k + 1))

  useEffect(() => {
    if (!questionId) { setLoading(false); setError('缺少题目'); return }
    let cancelled = false
    // finished：终态只走一次（final 定稿 / 降级 / 状态路由 三者互斥）——subscribe 与 promise 两条异步反应共用此守卫防重入。
    let finished = false
    const freshAc = new AbortController()

    // 采纳（或新发）该题的在飞【流式】请求：匹配页「点击即发」已在点击当帧发起（见 analysis-inflight），
    // 分析页晚挂载 200ms 也能 subscribe 回放到已到的 meta+段——这是流式改造的命根。
    // 重试（retryKey>0）时上一条已 settle 移除，requestAnalysis 自然新发一条。
    const entry = requestAnalysis(questionId, storyId, false, levelRef.current)
    fetchedLevelRef.current = levelRef.current   // 记下本次取数实际用的档，供 account 校正判是否需自愈重取
    setLoading(true); setError(null); setDailyLimitHit(false)

    // 降级：流断 / 无 done / error 帧 / 初始非流失败 → 重发 ?stream=0 缓冲整批、整份渲染（用户无感）。
    // POST 而非 GET：该接口扣额度 + 真调 AI，用 GET 会被浏览器预取 / 爬虫无意触发、白烧钱。
    const degrade = async (): Promise<void> => {
      if (finished) return
      finished = true
      try {
        const res = await apiFetch('/api/analysis?stream=0', { method: 'POST', json: { questionId, storyId, level: levelRef.current }, signal: freshAc.signal })
        // 与现状一致：403 回首页触发同意 / 402 弹注册引导 / 429 明天恢复
        if (res.status === 403) { if (!cancelled) { setLoading(false); router.push('/') } return }
        if (res.status === 402) { if (!cancelled) { setLoading(false); setQuotaShown('page') } return }
        if (res.status === 429) { if (!cancelled) { setLoading(false); setDailyLimitHit(true) } return }  // 置 loading=false 否则 429 横幅永不显示、卡转圈
        if (!res.ok) throw new Error('生成分析失败')
        const json = (await res.json()) as AnalysisResponse
        if (!cancelled) { setData(json); setLoading(false) }
      } catch (e) {
        if (freshAc.signal.aborted) return   // 中断（卸载）不算错误，忽略
        if (!cancelled) { setError(e instanceof Error ? e.message : '生成分析失败'); setLoading(false) }
      }
    }

    // 逐段渲染：meta 到→题头就位；structureLabel / focusPoints / phrases 自然序逐个冒；final 到→权威定稿。
    // 骨架保留到首个内容段到达（AI 生成 gap 期间不闪空卡）；空态/错误只在 done/error 后判，流式中途绝不误判。
    const onSnap = (snap: AnalysisSnapshot): void => {
      if (cancelled || finished) return
      if (snap.final) { finished = true; setData(snap.final); setLoading(false); return }
      if (snap.error) { void degrade(); return }   // 流断/无 done/error 帧 → 降级
      if (snap.meta && snap.sections.length > 0) {
        setData(buildPartialAnalysis(snap.meta, snap.sections))
        setLoading(false)
      }
    }
    const unsub = entry.subscribe(onSnap)

    // 状态路由 + 非流失败降级：从初始 Response 读 402/403/429（handleStreaming 开流前的普通 JSON 早退）；
    // 非流(非 SSE)且 !ok（如 500）→ 降级。ok SSE 的数据流由 subscribe 驱动，这里不再处理。
    entry.promise.then((res) => {
      if (cancelled || finished) return
      if (res.status === 403) { finished = true; if (!cancelled) { setLoading(false); router.push('/') } return }
      if (res.status === 402) { finished = true; if (!cancelled) { setLoading(false); setQuotaShown('page') } return }
      if (res.status === 429) { finished = true; if (!cancelled) { setLoading(false); setDailyLimitHit(true) } return }  // 置 loading=false 否则 429 横幅永不显示、卡转圈
      if (!res.ok) { void degrade(); return }
    }).catch(() => {
      // 初始 fetch 本身失败（网络/被 abort）：abort 由 cleanup 触发、cancelled 拦掉；其余降级兜底。
      if (!cancelled && !finished) void degrade()
    })

    // 卸载：先退订（阻断 abort 触发的 error 回放）再 abort 在飞流（仅停客户端读流，服务端跑完写缓存）+ 兜底请求。
    return () => { cancelled = true; unsub(); entry.abort(); freshAc.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- storyId 随首帧固定不变，初次加载即取用；列入依赖只会无谓重跑分析
  }, [questionId, retryKey])

  function changeLevel(newLevel: string) {
    const prevLevel = level
    setLevel(newLevel)
    setOpenPhrase(null)
    setPhrasesLoading(true)
    ;(async () => {
      try {
        // 同 /api/analysis：POST 而非 GET（扣额度 + 真调 AI，不能被预取无意触发）
        const res = await apiFetch('/api/analysis/phrases', {
          method: 'POST',
          json: { questionId, storyId, level: newLevel },
        })
        // 服务端同意闸拒绝（403）：回首页触发同意弹窗，不停在换词失败态。
        // 同样要回退档位：跳转是异步的，回退前这一帧（以及用户按浏览器返回退回本页时）
        // 档位不能停在换失败的新值上，否则与页面里没换成的词组内容对不上。
        if (res.status === 403) { setLevel(prevLevel); router.push('/'); return }
        // 402/429 必须在此判、不能等 catch —— catch 里拿不到 res.status。
        // 档位回退保留（状态不该与内容脱节），但必须配提示：否则用户点 7.0 → 档位自己跳回 6.0
        // → 内容一字未变 → 零反馈 → 以为按钮坏了反复点，每点一次烧一次 AI。
        if (res.status === 402) { setLevel(prevLevel); setQuotaShown('phrases'); return }
        if (res.status === 429) { setLevel(prevLevel); setToast('操作太频繁，今天先歇歇吧。明天会自动恢复。'); return }
        if (!res.ok) throw new Error('换词失败')
        const json = (await res.json()) as { phrases: AnalysisPhraseGroup[] }
        setData(prev => prev ? { ...prev, analysis: { ...prev.analysis, phrases: json.phrases } } : prev)
      } catch {
        setLevel(prevLevel)
        setToast(`没换成 ${newLevel}，还是 ${prevLevel} 的版本。再点一次试试？`)
      } finally {
        setPhrasesLoading(false)
      }
    })()
  }

  function toggleSave(item: AnalysisPhrase, group: string) {
    const key = item.text
    const isSaved = savedSet.has(key)
    const newWord: SavedWord = {
      id: key,
      text: key,
      meaning: item.meaning,
      scene: item.scene,
      group,
      level,
      questionEn: data?.question.en ?? '',
      createdAt: new Date().toISOString(),
    }
    // 乐观更新走 SWR 缓存（唯一真源）：点按即时切高亮，出错自动回滚，落库后以服务端结果为准。
    const optimisticWords = isSaved
      ? savedWords.filter(w => w.text !== key)
      : [newWord, ...savedWords]
    const persist = isSaved ? removeSavedWord(key) : addSavedWord(newWord).then(() => undefined)
    void mutate(
      SAVED_WORDS_KEY,
      persist.then(() => listSavedWords()),
      { optimisticData: optimisticWords, rollbackOnError: true, revalidate: false },
    ).catch((e) => console.error('[analysis] 词组收藏失败', e))
  }

  const viewProps: AnalysisViewProps = {
    data,
    loading,
    error,
    dailyLimitHit,
    level,
    levelMenuOpen,
    phrasesLoading,
    openPhrase,
    savedSet,
    onRetry: () => void retry(),
    onToggleLevelMenu: () => setLevelMenuOpen(v => !v),
    onSelectLevel: (lv) => { setLevelMenuOpen(false); if (lv !== level) changeLevel(lv) },
    onTogglePhrase: (key) => setOpenPhrase(key),
    onToggleSave: toggleSave,
    // navigate：点「开始练习」瞬间即亮顶部条，练习页初始化对话（AI 调用）期间有跳转反馈。
    onStartPractice: () => navigate(`/practice?questionId=${questionId}&storyId=${storyId}&level=${level}&review=${review ? 1 : 0}${rank ? `&rank=${rank}` : ''}`),
    // 复习卡/返回上一步/退出跳首页均走 navigate → 点击当帧亮顶部进度条（消冷缓存空窗）
    onReviewCards: () => navigate('/review'),
    onBack: () => navigate(backTarget.href),
    // 退出（顶栏 ✕）回来源页（题库/匹配/整理），而非恒回首页——从哪进来关掉就回哪，深链缺 from 才回首页兜底
    onExit: () => navigate(backTarget.href),
  }

  return (
    <>
      {/* 落地分析页后页内等 AI 生成分析（POST /api/analysis 较慢，非路由跳转）时亮顶部涓流条 + sr-only 播报，
          与题目匹配页顶部条给用户同样的「正在处理」反馈。单实例即可（fixed 覆盖桌面/移动两视图）。 */}
      {loading && <AnalysisTopProgress />}
      <div className="lg:hidden"><AnalysisMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 沉浸外壳（分析步激活）+ split 两栏舞台 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="analysis" onExit={viewProps.onExit} onBack={viewProps.onBack} backLabel={backTarget.label} showFeedback>
          <AnalysisDesktop {...viewProps} />
        </FlowShellDesktop>
      </div>
      {/* 402 匿名试用额度用尽：引导注册。整页失败关掉回首页；换词失败关掉留在原页（词组内容还在） */}
      {quotaShown && (
        <QuotaReached
          variant="trial"
          asOverlay
          onClose={quotaShown === 'phrases' ? () => setQuotaShown(null) : () => router.push('/')}
        />
      )}
      {/* 换词失败/换词当日上限：页面主体内容仍可读，用 Toast 而非遮罩，不打断阅读 */}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </>
  )
}

export default function AnalysisPage() {
  return <Suspense><AnalysisContent /></Suspense>
}
