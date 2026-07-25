/**
 * @module   AnkiReviewPage
 * @desc     Anki 题卡 SRS 复习宿主页 —— 套用 /review 骨架（顶栏关闭 + 进度条/点、翻卡、左右滑评级、Leitner 排下次）。
 *           拉当季题卡 → QuestionFlashCard 逐张翻面/滑动/逐点编辑。
 *   牌堆构成（S3）：并行拉当季 part1 + part2 两份列表，按 RPC 返回顺序 concat 成完整牌堆（part1 段在前、
 *     part2 段在后）；part3 子卡由 get_anki_cards 随其 part2 父卡成组、已排好序（见 0034/0039），前端【不重排】、
 *     直接沿用返回顺序渲染，保成组不被打散。part3 卡背走静态 analysis.example（CardBack 已支持）。
 *   分段 Tab（全部 / Part 1 / Part 2，默认「全部」）：从完整牌堆按 card.part 派生 visibleQueue —— 「全部」= 整副牌
 *     （与素材库 Hero 计数「当季 N 张」一致、所见即所得），Part 1 取 part===1，Part 2 取 part===2 或 3（part3 子卡
 *     跟随父 part2 一并展示、成组顺序不打散）。翻卡/评级只作用在 visibleQueue 上；切 Tab 把卡索引重置到该段第一张。
 *     scope（全部|已回答）仍固定默认（全部），待下批筛选接入后由查询参数驱动。
 * @author   LingoBridge
 * @created  2026-07-24
 */
'use client'
import { type JSX, useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useNav } from '@/components/NavProgress'
import { X } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import QuestionFlashCard from '@/components/anki/QuestionFlashCard'
import AnkiRegisterGate from '@/components/anki/AnkiRegisterGate'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useAccount } from '@/hooks/useAccount'
import { ensureSession } from '@/lib/supabase'
import { fetchAnkiCards, gradeAnkiCard, patchAnkiPoint, AnkiFetchError } from '@/lib/anki/cards-client'
import { parseEditOverrides, applyEditOverride, serializeEditOverrides } from '@/lib/anki/answer-points'
import type { AnkiCard } from '@/lib/anki/list'

// 外围导航未接前的临时默认（下批筛选接入后改由查询参数驱动）
const DEFAULT_SCOPE = 'all' as const

// 分段 Tab：全部 / Part 1 / Part 2（part3 子卡跟随 part2、不单列）；默认「全部」= 与 Hero 计数一致
type PartTab = 'all' | 1 | 2
const PART_TABS: readonly { id: PartTab; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 1, label: 'Part 1' },
  { id: 2, label: 'Part 2' },
]

export default function AnkiReviewPage(): JSX.Element {
  const router = useRouter()
  // 空点态指路跳 /question-bank 走 navigate 亮进度条；关闭复习走 router.back()（回退，非前进加载页）
  const { navigate } = useNav()
  const [queue, setQueue] = useState<AnkiCard[]>([])
  const [current, setCurrent] = useState(0)
  // 每个段的原始张数（完成语「这轮过了 N 张」按当前段计；不含没记住后追加到队尾的重练卡）
  const [totals, setTotals] = useState<{ all: number; 1: number; 2: number }>({ all: 0, 1: 0, 2: 0 })
  const [activePart, setActivePart] = useState<PartTab>('all')
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

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setAuthRequired(false)
    void (async () => {
      try {
        // 先确保有会话（无则匿名登录）：GET 已匿名放行，匿名 token 存在才能拿到当季全库默认卡；
        // 深链直达本页的首访者否则无 Authorization 头 → 401 误入注册引导态。
        await ensureSession()
        // part1 + part2 两副牌并行拉，按 RPC 返回顺序 concat（part1 在前、part2 在后）；
        // part3 子卡已随其 part2 父卡在 p2 内成组排好，不在前端重排、直接沿用顺序，保成组。
        const [p1, p2] = await Promise.all([
          fetchAnkiCards(1, DEFAULT_SCOPE),
          fetchAnkiCards(2, DEFAULT_SCOPE),
        ])
        if (cancelled) return
        const cards = [...p1, ...p2]
        setQueue(cards)
        // fetchAnkiCards(1) 只回 part1；fetchAnkiCards(2) 回 part2 + 其 part3 子卡（已成组）；「全部」= 整副牌
        setTotals({ all: cards.length, 1: p1.length, 2: p2.length })
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
  }, [reloadKey])

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

  // 切 Tab：把卡索引重置到该 part 第一张
  const switchPart = useCallback((p: PartTab): void => {
    setActivePart(p)
    setCurrent(0)
  }, [])

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
        ) : queue.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState title="当季没有题卡" subtitle="去题库把想练的题「存对子」，就会出现在这里" ctaLabel="返回" onCta={close} />
          </div>
        ) : (
          <>
            {/* 分段 Tab（全部 / Part 1 / Part 2）：复用 LibraryDesktop 四类 Tab 的分段范式（bg-bg-muted 外层 + 选中
                bg-white font-semibold shadow / 未选 text-v2-text-muted），居中、不挤占卡片。默认「全部」与 Hero 计数一致。 */}
            <div className="flex justify-center pb-5">
              <div className="flex gap-[3px] p-[3px] bg-bg-muted rounded-[10px] w-fit">
                {PART_TABS.map((t) => (
                  <button
                    key={String(t.id)}
                    type="button"
                    onClick={() => switchPart(t.id)}
                    aria-pressed={activePart === t.id}
                    className={`text-[13px] px-[18px] py-[7px] rounded-[8px] whitespace-nowrap transition-colors ${activePart === t.id ? 'bg-white text-v2-text-primary font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-v2-text-muted font-medium'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {visibleQueue.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <EmptyState title="这个 Part 暂无题卡" subtitle="切到另一个 Part 看看，或去题库把想练的题「存对子」" orbSize={100} />
              </div>
            ) : done ? (
              <div className="flex-1 flex items-center justify-center">
                <EmptyState title="复习完成 🎉" subtitle={`这轮过了 ${totals[activePart]} 张卡片`} ctaLabel="完成" onCta={close} />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <QuestionFlashCard
                  key={`${visibleQueue[current].questionId}-${activePart}-${current}`}
                  card={visibleQueue[current]}
                  onGrade={(r) => void gradeOne(r)}
                  onEditPoint={handleEditPoint}
                  onSupplement={handleSupplement}
                  anonymous={isAnonymous}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* 匿名用户点空点态「分享你的想法」→ 注册引导（写作链路需注册）；关闭回本页、复习状态不丢。 */}
      {registerGate && <AnkiRegisterGate onClose={() => setRegisterGate(false)} />}
    </div>
  )
}
