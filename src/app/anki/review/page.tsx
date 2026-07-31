/**
 * @module   AnkiReviewPage
 * @desc     Anki 题卡 SRS 复习宿主页 —— 套用 /review 骨架（顶栏关闭 + 进度条/点、翻卡、左右滑评级、Leitner 排下次）。
 *           拉当季题卡 → QuestionFlashCard 逐张翻面/滑动/逐点编辑。
 *   牌堆构成（S3）：并行拉当季 part1 + part2 两份列表，按 RPC 返回顺序 concat 成完整牌堆（part1 段在前、
 *     part2 段在后）；part3 子卡由 get_anki_cards 随其 part2 父卡成组、已排好序（见 0034/0039），前端【不重排】、
 *     直接沿用返回顺序渲染，保成组不被打散。part3 卡背走静态 analysis.example（CardBack 已支持）。
 *   两级筛选（2026-07-26）：一级「全部题库 / 今日复习 N」= mode（all/due）的页内切换，经 router.replace 同步
 *     ?mode=due（深链/刷新保持），切换重置卡索引并按新口径重建队列；二级「全部 / Part 1 / Part 2」两种模式下
 *     都显示，与一级组合生效（due 快照队列同样按 activePart 过滤）。「今日复习」标签带到期数 N（快照口径见下）；
 *     匿名无 SRS、到期恒空 → 隐藏一级切换（恒全部题库），匿名深链 ?mode=due 仍自然落空态（现状兜底保留）。
 *   二级 Part 筛选 Chip（全部 / Part 1 / Part 2，默认「全部」，与题库页同款胶囊）：从当前队列按 card.part 派生 visibleQueue —— 「全部」=
 *     整副牌（与素材库 Hero 计数「当季 N 张」一致、所见即所得），Part 1 取 part===1，Part 2 取 part===2 或 3
 *     （part3 子卡跟随父 part2 一并展示、成组顺序不打散）。翻卡/评级只作用在 visibleQueue 上；切 Tab 把卡索引
 *     重置到该段第一张。
 *   今日复习（?mode=due）：只拉两 part 的 answered 卡，进入时快照 now，取「已答 + 到期（dueAt<=now）」的主卡
 *     （part≠3，与 Hero 待复习计数口径一致——library/page.tsx 只数主卡）按 dueAt 升序成队。「今日复习 N」角标：
 *     due 模式 = 快照队列总数；all 模式从 all 牌堆免请求推出（answered ⊆ all，同为当季、同一 RPC 按季过滤，
 *     口径同式）。空队/完成态各自指路回全部题卡（router.replace 防回退落空态）；评级/重练/401/错误分支全部复用现状。
 * @author   LingoBridge
 * @created  2026-07-24
 */
'use client'
import { type JSX, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useNav } from '@/components/NavProgress'
import { X } from 'lucide-react'
import Chip from '@/components/Chip'
import EmptyState from '@/components/EmptyState'
import QuestionFlashCard from '@/components/anki/QuestionFlashCard'
import AnkiRegisterGate from '@/components/anki/AnkiRegisterGate'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useAccount } from '@/hooks/useAccount'
import { ensureSession } from '@/lib/supabase'
import { fetchAnkiCards, fetchCardAnalyses, gradeAnkiCard, patchAnkiPoint, AnkiFetchError } from '@/lib/anki/cards-client'
import { parseEditOverrides, applyEditOverride, serializeEditOverrides } from '@/lib/anki/answer-points'
import type { AnkiCard } from '@/lib/anki/list'
import type { QuestionAnalysis } from '@/lib/types'

// 二级 Part 筛选 Chip：全部 / Part 1 / Part 2（part3 子卡跟随 part2、不单列）；默认「全部」= 与 Hero 计数一致
type PartTab = 'all' | 1 | 2
const PART_TABS: readonly { id: PartTab; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 1, label: 'Part 1' },
  { id: 2, label: 'Part 2' },
]

// 一级分段：全部题库 / 今日复习（= mode all/due 的页内切换；「今日复习」旁挂到期数角标）
const MODE_TABS: readonly { due: boolean; label: string }[] = [
  { due: false, label: '全部题库' },
  { due: true, label: '今日复习' },
]

/**
 * 从卡列表滤出「到期主卡」（已答 + part≠3 + dueAt<=now）——due 队列与「今日复习 N」角标的共用口径，
 * 与素材库 Hero「待复习」计数一致（library/page.tsx 只数主卡，part3 子卡不单独计到期）。
 * @param  cards  卡列表（due 模式的 answered 卡 或 all 模式的整副牌）
 * @param  now    快照时间戳（进入/加载时取一次，保「本轮以进入时为准」的快照语义）
 * @returns       到期主卡列表（未排序，排序由调用方按需做）
 */
function filterDueMainCards(cards: readonly AnkiCard[], now: number): AnkiCard[] {
  return cards.filter((c) => c.part !== 3 && c.isAnswered && new Date(c.dueAt).getTime() <= now)
}

/**
 * 页面壳：App Router 要求 useSearchParams 在 Suspense 边界内（否则 next build 报错），
 * 实际内容抽为 AnkiReviewContent，此处仅包一层 Suspense。
 * @returns 复习页（Suspense 边界内渲染实际内容）
 */
export default function AnkiReviewPage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <AnkiReviewContent />
    </Suspense>
  )
}

function AnkiReviewContent(): JSX.Element {
  const router = useRouter()
  // 今日复习模式（?mode=due）：只复习到期的已答主卡（见模块头）；派生成布尔再进 effect 依赖，避免 params 对象每次导航换引用
  const dueMode = useSearchParams().get('mode') === 'due'
  // 空点态指路跳 /question-bank 走 navigate 亮进度条；关闭复习走 router.back()（回退，非前进加载页）
  const { navigate } = useNav()
  const [queue, setQueue] = useState<AnkiCard[]>([])
  const [current, setCurrent] = useState(0)
  // 每个段的原始张数（完成语「这轮过了 N 张」按当前段计；不含没记住后追加到队尾的重练卡）
  const [totals, setTotals] = useState<{ all: number; 1: number; 2: number }>({ all: 0, 1: 0, 2: 0 })
  const [activePart, setActivePart] = useState<PartTab>('all')
  // 「今日复习」一级标签的到期数角标：due 模式 = 快照队列总数；all 模式从 all 牌堆推出（口径见模块头）
  const [dueBadge, setDueBadge] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 401（GET 理论已匿名放行，但会话过期/被吊销仍可能 401）→ 注册引导态，不当「加载失败」；其余走加载失败 + 重试。
  const [authRequired, setAuthRequired] = useState(false)
  // 匿名会话：卡背 UI 与注册一致（同款评级箭头、刷卡一样顺），评级只前进不落库、不显进度点、绝不弹注册；
  // GET 已匿名放行（返回默认无语料卡）。唯一注册引导 = 卡底「分享你的想法」（想输入语料时）。
  const { account } = useAccount()
  const isAnonymous = account?.isAnonymous ?? false
  // 重试键：错误态「重试」自增触发重新拉取（而非只「返回」把用户踢走）
  const [reloadKey, setReloadKey] = useState(0)
  // 匿名用户点空点态「分享你的想法」→ 弹注册引导（复用 AnkiRegisterGate）；注册用户直接跳 /write?qid=
  const [registerGate, setRegisterGate] = useState(false)
  // 题目分析懒加载缓存（列表不再随行下发 analysis，见 anki/list.ts mapRow ⚠️）：{ questionId: analysis|null }。
  // 键存在即「已拉过」（null = 拉过但该题无分析），据此区分「加载中」与「确无要点」。fetchedRef 镜像已拉键，
  // 供预取 effect 判缺失而不把 map 放进依赖（避免合并→重跑→再合并的循环）。跨 mode/part 切换保留缓存、免重拉。
  const [analysisMap, setAnalysisMap] = useState<Record<string, QuestionAnalysis | null>>({})
  const fetchedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setAuthRequired(false)
    // mode 切换（due ↔ 全部走 router.replace，组件不卸载）时重拉牌堆，卡索引一并归零
    setCurrent(0)
    void (async () => {
      try {
        // 先确保有会话（无则匿名登录）：GET 已匿名放行，匿名 token 存在才能拿到当季全库默认卡；
        // 深链直达本页的首访者否则无 Authorization 头 → 401 误入注册引导态。
        await ensureSession()
        if (dueMode) {
          // 今日复习：只拉已答卡，取到期主卡。排除 part3 = 与 Hero「待复习」计数口径一致（library/page.tsx
          // 只数主卡，part3 子卡不单独计到期）。匿名深链 answered 恒空 → 自然落入场空态，不专门拦截。
          const [p1, p2] = await Promise.all([
            fetchAnkiCards(1, 'answered'),
            fetchAnkiCards(2, 'answered'),
          ])
          if (cancelled) return
          // 快照语义：本轮队列以进入时为准，不动态插入中途新到期的卡
          const now = Date.now()
          const due = filterDueMainCards([...p1, ...p2], now)
            .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
          setQueue(due)
          // 分段计数按 due 快照队列口径（due 队列无 part3，Part 2 段即 part===2）；完成语两模式同式 totals[activePart]
          setTotals({
            all: due.length,
            1: due.filter((c) => c.part === 1).length,
            2: due.filter((c) => c.part === 2).length,
          })
          setDueBadge(due.length)
        } else {
          // part1 + part2 两副牌并行拉，按 RPC 返回顺序 concat（part1 在前、part2 在后）；
          // part3 子卡已随其 part2 父卡在 p2 内成组排好，不在前端重排、直接沿用顺序，保成组。
          const [p1, p2] = await Promise.all([
            fetchAnkiCards(1, 'all'),
            fetchAnkiCards(2, 'all'),
          ])
          if (cancelled) return
          const cards = [...p1, ...p2]
          setQueue(cards)
          // fetchAnkiCards(1) 只回 part1；fetchAnkiCards(2) 回 part2 + 其 part3 子卡（已成组）；「全部」= 整副牌
          setTotals({ all: cards.length, 1: p1.length, 2: p2.length })
          // 角标从 all 牌堆免请求推出：answered ⊆ all（同为当季、同一 RPC 按季过滤），口径与 due 队列同式
          setDueBadge(filterDueMainCards(cards, Date.now()).length)
        }
      } catch (e) {
        if (cancelled) return
        // 按 status 分流：401 → 注册引导态；其余（500 / 网络，status=0）→ 加载失败 + 重试。
        if (e instanceof AnkiFetchError && e.status === 401) setAuthRequired(true)
        else setError(e instanceof Error ? e.message : '加载失败，请重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [reloadKey, dueMode])

  // 当前 Tab 可见牌堆：从完整 queue 按 part 派生（Part 1 → part===1；Part 2 → part===2 或 3，part3 跟随父 part2
  // 成组，filter 不改相对顺序故成组不被打散）。翻卡/评级/进度全作用在 visibleQueue 上。
  const visibleQueue = useMemo(
    () => queue.filter((c) => {
      if (activePart === 'all') return true
      if (activePart === 1) return c.part === 1
      return c.part === 2 || c.part === 3
    }),
    [queue, activePart],
  )

  // 滑动窗口预取分析：拉当前及往后 PREFETCH_AHEAD 张里还没拉过的题的 analysis（一次 batch 请求），随 current
  // 前进滚动补窗口。首屏只等题面（列表 368kB），analysis 随翻随到、先于翻面就位 → 卡背感知为零、不闪空态。
  // fetchedRef 判缺失（不把 analysisMap 放依赖，避免循环）；失败静默——翻到未就位卡时卡背自然回落「加载中/空态」。
  const PREFETCH_AHEAD = 6
  useEffect(() => {
    if (loading || visibleQueue.length === 0) return
    const want = visibleQueue
      .slice(current, current + PREFETCH_AHEAD)
      .map((c) => c.questionId)
      .filter((id) => !fetchedRef.current.has(id))
    if (want.length === 0) return
    // 乐观占位：先记入 fetchedRef 防同窗口重复请求；请求失败则撤销这些占位、下轮可重试。
    want.forEach((id) => fetchedRef.current.add(id))
    let cancelled = false
    void fetchCardAnalyses(want)
      .then((got) => {
        if (cancelled) return
        // 请求的每个 id 都落 map：命中的存 analysis、未命中的存 null（= 拉过但无分析，区别于「未拉」）。
        setAnalysisMap((prev) => {
          const next = { ...prev }
          for (const id of want) next[id] = got[id] ?? null
          return next
        })
      })
      .catch(() => {
        if (cancelled) return
        want.forEach((id) => fetchedRef.current.delete(id)) // 撤销占位，允许后续重试
      })
    return () => { cancelled = true }
  }, [visibleQueue, current, loading])

  // 切 Tab：把卡索引重置到该 part 第一张
  const switchPart = useCallback((p: PartTab): void => {
    setActivePart(p)
    setCurrent(0)
  }, [])

  // 一级切换（全部题库 ↔ 今日复习）：router.replace 同步 ?mode=due / 清除（深链刷新保持、不压历史栈）；
  // dueMode 变化触发上方 effect 重拉队列并重置卡索引（due 进入时重新快照 now）。activePart 跨模式保留（组合筛选）。
  const switchMode = useCallback((due: boolean): void => {
    if (due === dueMode) return
    router.replace(due ? '/anki/review?mode=due' : '/anki/review')
  }, [dueMode, router])

  const handleGrade = useCallback((remembered: boolean): void => {
    const card = visibleQueue[current]
    if (!card) return
    // 匿名与注册【共用同一评级 UI、体验一样顺】；差别只在持久化：
    //   注册 → 落库 SRS + 没记住排队尾本轮再练；匿名 → 只前进到下一张（不落库、不排队尾、绝不弹注册）。
    if (!isAnonymous) {
      void gradeAnkiCard(card.questionId, remembered).catch(() => {}) // 静默失败，不打断复习
      if (!remembered) setQueue((q) => [...q, card]) // 没记住：排到队尾本轮再练（同 part 的卡 filter 后仍落该 tab 队尾）
    }
    setCurrent((c) => c + 1)
  }, [visibleQueue, current, isAnonymous])
  const [gradeOne] = useAsyncAction(handleGrade)

  // 逐点编辑（已下线、仅兼容仍传入的宿主 prop）：按 questionId 定位当前可见卡回写覆盖，避免 index 落在完整 queue 上错位
  const handleEditPoint = useCallback(async (idx: number, en: string): Promise<void> => {
    const card = visibleQueue[current]
    if (!card) return
    await patchAnkiPoint(card.questionId, idx, en)
    const merged = applyEditOverride(parseEditOverrides(card.editedAnswer), idx, en)
    const next = serializeEditOverrides(merged)
    setQueue((q) => q.map((c) => (c.questionId === card.questionId ? { ...c, editedAnswer: next === '' ? null : next } : c)))
  }, [visibleQueue, current])

  // 空点态邀请「分享你的想法」：注册用户 → /write?qid=（雅思文本输入页，读题做上下文、可切语音、提交后走
  // restructure→analysis→practice 绑该题，下游现成）；匿名用户 → 弹注册引导（写作/存题卡链路需注册）。
  const handleSupplement = useCallback((questionId: string): void => {
    if (isAnonymous) { setRegisterGate(true); return }
    navigate(`/write?qid=${questionId}`)
  }, [isAnonymous, navigate])

  const close = (): void => router.back()
  const done = !loading && !error && visibleQueue.length > 0 && current >= visibleQueue.length

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
      {/* 顶栏：关闭 + 进度 */}
      <div className="relative z-10 lg:max-w-[760px] lg:w-full lg:mx-auto">
        <div className="flex items-center justify-between h-[52px] px-5">
          <button onClick={close} aria-label="关闭复习" className="w-[30px] h-[30px] rounded-full bg-white shadow-sm flex items-center justify-center">
            <X size={15} className="text-v2-text-muted" />
          </button>
          {!loading && !error && visibleQueue.length > 0 && current < visibleQueue.length && (
            <span className="text-[13px] text-v2-text-muted">{current + 1} / {visibleQueue.length}</span>
          )}
        </div>
        {!loading && !error && visibleQueue.length > 0 && current < visibleQueue.length && (
          <div className="px-5">
            <div className="mt-1 h-1 rounded-full bg-bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-brand-primary transition-[width] duration-300"
                style={{ width: `${(current / visibleQueue.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 lg:px-8 py-6 relative z-10 flex flex-col lg:max-w-[760px] lg:w-full lg:mx-auto">
        {loading ? (
          <div className="flex-1 flex items-center justify-center"><EmptyState title="加载中…" orbSize={100} /></div>
        ) : authRequired ? (
          // 401（会话过期/被吊销）：注册引导态，不是「加载失败」。CTA → /login。
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              title="登录后查看你的题卡"
              subtitle="题卡会按你的目标分帮你复习，登录 / 注册后就能看到你存过的题。"
              ctaLabel="注册 / 登录"
              onCta={() => router.push('/login')}
            />
          </div>
        ) : error ? (
          // 500 / 网络：加载失败 + 重试（重新拉取，不是「返回」把用户踢走）。
          <div className="flex-1 flex items-center justify-center">
            <EmptyState title="加载失败" subtitle={error} ctaLabel="重试" onCta={() => setReloadKey((k) => k + 1)} alert />
          </div>
        ) : (
          <>
            {/* 一级分段（全部题库 / 今日复习 N）：mode 页内切换，分段 Tab 范式（bg-bg-muted 外层 + 选中 bg-white
                font-semibold shadow）；二级 Part 筛选已降级为 Chip 胶囊，一级 Tab / 二级 Chip 视觉分主次。
                匿名隐藏——匿名无 SRS、到期恒空，不给一个只通向空态的入口（匿名深链 ?mode=due 仍自然落下方
                due 空态兜底）。 */}
            {!isAnonymous && (
              <div className="flex justify-center pb-2.5">
                <div className="flex gap-[3px] p-[3px] bg-bg-muted rounded-[10px] w-fit">
                  {MODE_TABS.map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      onClick={() => switchMode(t.due)}
                      aria-pressed={dueMode === t.due}
                      className={`flex items-center gap-1.5 text-[13px] px-[18px] py-[7px] rounded-[8px] whitespace-nowrap transition-colors ${dueMode === t.due ? 'bg-white text-v2-text-primary font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-v2-text-muted font-medium'}`}
                    >
                      {t.label}
                      {/* 到期数角标（范式同 LibraryDesktop Tab 计数）：一眼知道今天有几张 */}
                      {t.due && <span className="text-[12px] text-v2-text-muted">{dueBadge}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {queue.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                {dueMode ? (
                  // due 入场空态：CTA 用 replace 跳全部题卡（防「返回」又落回空态）。普通空列表不传 alert。
                  <EmptyState
                    title="今天没有要复习的题卡"
                    subtitle="刷过的题卡到期后会出现在这里，先去题库速览混个眼熟吧"
                    ctaLabel="去刷题卡"
                    onCta={() => router.replace('/anki/review')}
                  />
                ) : (
                  <EmptyState title="当季没有题卡" subtitle="去题库把想练的题「存对子」，就会出现在这里" ctaLabel="返回" onCta={close} />
                )}
              </div>
            ) : (
              <>
                {/* 二级筛选（全部 / Part 1 / Part 2）：Chip 胶囊，与题库页 Part 筛选同款（QuestionListTabMobile
                    ghost + active，md 默认尺寸、不覆盖字号/内边距）——视觉降一级与一级分段 Tab 分主次。
                    after: 伪元素把命中区纵向扩到约 44px（Chip 本体约 26px 高），可视尺寸不变。
                    默认「全部」与 Hero 计数一致。两种模式下都显示，与一级组合生效（due 快照队列同样按 part 过滤）。 */}
                <div className="flex justify-center gap-2 pb-5" role="group" aria-label="按 Part 筛选">
                  {PART_TABS.map((t) => (
                    <Chip
                      key={String(t.id)}
                      variant="ghost"
                      active={activePart === t.id}
                      ariaPressed={activePart === t.id}
                      onClick={() => switchPart(t.id)}
                      className="relative after:absolute after:-inset-y-[9px] after:-inset-x-[2px] after:content-['']"
                    >
                      {t.label}
                    </Chip>
                  ))}
                </div>

                {visibleQueue.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    {dueMode ? (
                      // due + part 组合筛选后为空（如 Part 2 无到期卡）：同款空态、文案按 due 口径
                      <EmptyState title="这个分类下今天没有要复习的题卡" subtitle="切到另一个 Part 看看，或回全部题库随便刷几张" orbSize={100} />
                    ) : (
                      <EmptyState title="这个 Part 暂无题卡" subtitle="切到另一个 Part 看看，或去题库把想练的题「存对子」" orbSize={100} />
                    )}
                  </div>
                ) : done ? (
                  <div className="flex-1 flex items-center justify-center">
                    {dueMode ? (
                      // 完成语按进入时快照的当前段计数（totals[activePart]），不含「没记住」追加到队尾的重练卡
                      <EmptyState
                        title="今日复习完成 🎉"
                        subtitle={`这轮过了 ${totals[activePart]} 张，到期的卡明天会再来找你`}
                        ctaLabel="去刷全部题卡"
                        onCta={() => router.replace('/anki/review')}
                      />
                    ) : (
                      <EmptyState title="复习完成 🎉" subtitle={`这轮过了 ${totals[activePart]} 张卡片`} ctaLabel="完成" onCta={close} />
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    {(() => {
                      // 注入懒加载来的 analysis（列表下发的恒 null，见 mapRow ⚠️）：已拉到 → 覆盖进 card；
                      // 未拉到（键不在 map）→ analysisPending，卡背显「加载中」而非空态。
                      const qid = visibleQueue[current].questionId
                      const fetched = qid in analysisMap
                      const card = fetched ? { ...visibleQueue[current], analysis: analysisMap[qid] } : visibleQueue[current]
                      return (
                        <QuestionFlashCard
                          key={`${qid}-${activePart}-${current}`}
                          card={card}
                          onGrade={(r) => void gradeOne(r)}
                          onEditPoint={handleEditPoint}
                          onSupplement={handleSupplement}
                          anonymous={isAnonymous}
                          analysisPending={!fetched}
                        />
                      )
                    })()}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* 匿名用户点空点态「分享你的想法」→ 注册引导（写作链路需注册）；关闭回本页、复习状态不丢。 */}
      {registerGate && <AnkiRegisterGate onClose={() => setRegisterGate(false)} />}
    </div>
  )
}
