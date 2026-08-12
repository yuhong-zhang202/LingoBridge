/**
 * @module   QuotaReached
 * @desc     月额度用完态 — 故事 / 雅思复练两个变体。额度弹层【同时列出两个维度】（故事额度 + 题目练习额度），
 *           各自显示真实 used/limit（limit 读常量、used 挂载时实拉，绝不写死 10/10），触发侧文字加重，
 *           让用户一眼看清是哪个满了、另一个还剩多少。CTA 只保留「另一侧还有额度」的那一个（故事用完→练习
 *           雅思题；雅思用完→讲个故事），两侧都满则不给 CTA、只留微信引导。取数失败退回不带数字的中性文案（不谎报）。
 *           视觉规格沿用 EmptyState（Orb size=120 + 标题/副文 v2 token + 渐变描边胶囊 CTA），额度行照 profile QuotaCard。
 *           asOverlay 模式为真模态：role="dialog" + aria-modal + 焦点移入/陷阱 + Esc 关闭，
 *           保证键盘与读屏用户不会被遮罩困住（此前遮罩仅鼠标可达）。
 *
 *   埋点（P2 额度转化）：挂载报 quota.reached（一次显示只报一次，ref 守卫），层内每个出口报 quota.cta
 *   （含点遮罩/Esc 的 close）—— 两者相除即「额度弹层把多少人吓走了 / 多少人因此去注册」。
 *   一律 fire-and-forget，且 CTA 必须【先报再执行动作】：跳转/关闭会立刻卸载本组件。
 * @author   LingoBridge
 * @created  2026-06-18
 */
'use client'
import { type JSX, useEffect, useRef, useState } from 'react'
import { useNav } from '@/components/NavProgress'
import Orb from '@/components/Orb'
import Skeleton from '@/components/Skeleton'
import GradientButton from '@/components/GradientButton'
import { cn } from '@/lib/utils'
import { nextMonthFirstLabel } from '@/lib/date'
import { ANON_CORPUS_LIMIT } from '@/lib/constants'
import { countCorpusThisMonth, STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import { countReviewPracticeThisMonth, IELTS_MONTHLY_LIMIT } from '@/lib/db/practice-sessions'
import { track } from '@/lib/client-events'
import { FOCUSABLE_SELECTOR } from '@/lib/focus-trap'
import type { QuotaCta, QuotaSurface } from '@/lib/event-schema'

interface QuotaLineProps {
  label: string
  /** 当月已用量；null=尚未取回（显示骨架） */
  used: number | null
  limit: number
  fillClass: string
  loading: boolean
  /** 是否触发侧（就是它满了）→ 文字加重提示 */
  highlight: boolean
}

/** 额度弹层内单维度用量行（行样式照 profile QuotaCard，复用同一视觉语言）。 */
function QuotaLine({ label, used, limit, fillClass, loading, highlight }: QuotaLineProps): JSX.Element {
  const capped = used !== null ? Math.min(used, limit) : 0
  const pct = limit > 0 ? Math.min(100, (capped / limit) * 100) : 0
  return (
    <div className="mt-3 text-left first:mt-0">
      <div className="flex items-baseline justify-between">
        <span className={cn('text-[0.8125rem]', highlight ? 'text-v2-text-primary font-medium' : 'text-v2-text-secondary')}>
          {label}
        </span>
        {loading ? (
          <Skeleton className="w-12 h-3.5" />
        ) : (
          <span className="text-[0.8125rem] text-v2-text-secondary">
            <span className="font-semibold">{capped}</span>{' / '}{limit}
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-1.5 w-full h-1.5 rounded-full" />
      ) : (
        <div className="mt-1.5 h-1.5 rounded-full bg-bg-muted overflow-hidden">
          <div className={`h-full rounded-full ${fillClass}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

interface Props {
  /** story：故事月额度用完；ielts：雅思复练月额度用完；trial：匿名试用结束（引导注册，非月额度）。 */
  variant: 'story' | 'ielts' | 'trial'
  /**
   * 本弹层出现在哪个界面 —— 只用于埋点分面（quota.reached / 转化率按界面拆开看），不影响任何渲染。
   * ⚠️ 语义上【每个调用点都该传】；类型上刻意留可选，是因为 matching/page.tsx 那个调用点
   * 在本次改动窗口里被另一条改动线占用、不能碰。未传 = 该事件的 surface 字段缺失，
   * 会在看板「额度弹层界面」一栏计入「(未上报)」—— 可见、不静默。补 matching 时删掉本段说明。
   */
  surface?: QuotaSurface
  /** 浮层模式（盖在当前页之上时使用）。inline 时不传，直接铺在父容器里。 */
  asOverlay?: boolean
  /** asOverlay 时点遮罩/关闭逻辑（如取消触发的复练操作） */
  onClose?: () => void
  className?: string
}

export default function QuotaReached({ variant, surface, asOverlay, onClose, className }: Props) {
  const { navigate } = useNav() // 额度弹层内的 CTA 跳页走 navigate → 点击即亮顶部进度条
  // 两个维度的真实当月用量（null=尚未取回）；quotaFailed=取数失败 → 退回不带数字的中性文案（不谎报）。
  const [storyUsed, setStoryUsed]   = useState<number | null>(null)
  const [reviewUsed, setReviewUsed] = useState<number | null>(null)
  const [quotaFailed, setQuotaFailed] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  /** 「本次显示已报过 quota.reached」守卫：effect 因重渲染重跑时不许重复计数（照首页 textCaptureStartedRef 范式） */
  const reachedReportedRef = useRef(false)

  // 触发侧一定已满（服务端就是因它超额才 402）；对侧由实拉用量判定。用量未回/失败时按 variant 兜底。
  const storyDone  = storyUsed  !== null ? storyUsed  >= STORY_MONTHLY_LIMIT : variant === 'story'
  const reviewDone = reviewUsed !== null ? reviewUsed >= IELTS_MONTHLY_LIMIT : variant === 'ielts'
  const loadingUsage = storyUsed === null || reviewUsed === null

  /** 取面板内当前可聚焦元素（CTA 按钮随额度状态增减，故每次实时查询而非缓存） */
  const focusables = (): HTMLElement[] => {
    const root = panelRef.current
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  }

  // 挂载即报「额度弹层显示了」= 转化漏斗里「被拦住的人数」那一格（分母）。
  // ref 守卫：一次显示只报一次，重渲染导致 effect 重跑不再计数（否则分母虚高、转化率被低估）。
  // fire-and-forget：不 await、不进任何条件、不影响渲染。
  useEffect(() => {
    if (reachedReportedRef.current) return
    reachedReportedRef.current = true
    track('quota.reached', { variant, surface })
  }, [variant, surface])

  /**
   * 报一次弹层内的点击出口。【必须在实际动作之前调用】——跳转/关闭会立刻卸载本组件。
   * @param cta 点了哪个出口
   * @sideEffect 上报 quota.cta（fire-and-forget，失败静默）
   */
  const reportCta = (cta: QuotaCta): void => {
    track('quota.cta', { variant, cta })
  }

  /** 关闭弹层：先报 close（「被吓走」那一格），再执行调用方的关闭动作。 */
  const handleClose = (): void => {
    reportCta('close')
    onClose?.()
  }

  // 浮层打开时把焦点移入首个 CTA：键盘/读屏用户否则仍停在被遮罩的背景页上。
  useEffect(() => {
    if (!asOverlay) return
    focusables()[0]?.focus()
  }, [asOverlay])

  // 挂载时并拉两个维度的真实当月用量：弹层要同时列出故事 + 题目练习各自 used/limit（决定 CTA 也靠它）。
  // 仅月额度变体需要；trial 试用变体（匿名）无月额度，跳过、绝不显示月额度谎报。
  useEffect(() => {
    if (variant !== 'story' && variant !== 'ielts') return
    let cancelled = false
    void (async () => {
      try {
        const [s, r] = await Promise.all([countCorpusThisMonth(), countReviewPracticeThisMonth()])
        if (cancelled) return
        setStoryUsed(s)
        setReviewUsed(r)
      } catch {
        if (!cancelled) setQuotaFailed(true)   // 取数失败 → 退回中性文案（不带数字），绝不谎报
      }
    })()
    return () => { cancelled = true }
  }, [variant])

  // 「练雅思题」跳题库题目列表，让用户自选题目；复练拦截/计数由列表里"练习"按钮负责
  const handlePracticeIelts = () => { reportCta('practice_ielts'); navigate('/question-bank') }

  // trial：匿名试用结束态，面向注册转化，文案讲清「试用总量 ↔ 注册后每月额度」两套口径，绝不显示月额度谎报。
  const trialBody = (
    <div className={cn('flex flex-col items-center text-center px-6 py-10', className)}>
      <Orb size={120} pulse={false} />
      <h2 id="quota-title" className="text-[0.9375rem] font-medium text-v2-text-primary mt-5">试用已完成</h2>
      {/* 双口径在同一句讲清：匿名试用总量（ANON_CORPUS_LIMIT）↔ 注册后每月额度（STORY_MONTHLY_LIMIT），
          均读常量、绝不写死数字（口径调整文案自动跟随）。绝不给匿名显示「/10」或「10/10」月额度谎报。 */}
      <p className="text-[0.8125rem] text-v2-text-secondary mt-2 max-w-[260px] leading-relaxed">
        免费试用的 {ANON_CORPUS_LIMIT} 次已用完，注册后每月可练 {STORY_MONTHLY_LIMIT} 次。
      </p>
      <div className="flex flex-col items-center gap-2.5 mt-5">
        <GradientButton
          onClick={() => { reportCta('register'); navigate('/login') }}
          className="px-6 py-3 rounded-full text-[0.875rem] font-medium"
        >
          注册 / 登录
        </GradientButton>
      </div>
    </div>
  )

  // 触发维度的标题文案（story/ielts 分维度）。副文与底部入口对所有月额度变体一致。
  const quotaTitle = variant === 'story' ? '本月故事额度已用完' : '本月题目练习额度已用完'

  // CTA 只给「还有额度的那一侧」：故事用完 → 练习雅思题；雅思用完 → 讲个故事；两侧都满则只留微信引导。
  const quotaCtas = (
    <div className="flex flex-col items-center gap-2.5 mt-5">
      {!reviewDone && (
        <GradientButton onClick={handlePracticeIelts} className="px-6 py-3 rounded-full text-[0.875rem] font-medium">
          练习雅思题
        </GradientButton>
      )}
      {!storyDone && (
        <GradientButton onClick={() => { reportCta('new_story'); navigate('/') }} className="px-6 py-3 rounded-full text-[0.875rem] font-medium">
          讲个故事
        </GradientButton>
      )}
    </div>
  )

  // 底部入口：指向「我的 › 本月额度」看完整明细 + 微信引导。
  const quotaFooter = (
    <>
      <button
        onClick={() => { reportCta('profile'); navigate('/profile') }}
        className="text-[0.8125rem] text-v2-text-secondary underline underline-offset-2 mt-6 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40 focus-visible:ring-offset-1"
      >
        额度明细可在「我的 › 本月额度」查看
      </button>
      <p className="text-[0.8125rem] text-v2-text-muted mt-4">
        需要更多额度？添加开发者微信 <span className="text-v2-text-secondary font-medium">zyh202x</span>
      </p>
    </>
  )

  // 双维度弹层：同时列出故事额度 + 题目练习额度，各自真实 used/limit（触发侧加重），用户一眼看清是哪个满了。
  const dualQuotaBody = (
    <div className={cn('flex flex-col items-center text-center px-6 py-10', className)}>
      <Orb size={120} pulse={false} />
      <h2 id="quota-title" className="text-[0.9375rem] font-medium text-v2-text-primary mt-5">{quotaTitle}</h2>
      <p className="text-[0.8125rem] text-v2-text-secondary mt-2 max-w-[260px] leading-relaxed">
        {nextMonthFirstLabel()} 自动恢复 · 先去别处逛逛？
      </p>

      <div className="w-full max-w-[280px] mt-5">
        <QuotaLine label="本月故事额度"     used={storyUsed}  limit={STORY_MONTHLY_LIMIT} fillClass="bg-brand-primary-light" loading={loadingUsage} highlight={variant === 'story'} />
        <QuotaLine label="本月题目练习额度" used={reviewUsed} limit={IELTS_MONTHLY_LIMIT} fillClass="bg-brand-accent-light"  loading={loadingUsage} highlight={variant === 'ielts'} />
      </div>

      {quotaCtas}
      {quotaFooter}
    </div>
  )

  // 取数失败兜底：拿不到真实 used 时退回不带数字的中性文案（绝不硬凑「上限/上限」谎报），
  // 真实用量引导去「我的 › 本月额度」看。此即本组件改动前的稳定态。
  const neutralQuotaBody = (
    <div className={cn('flex flex-col items-center text-center px-6 py-10', className)}>
      <Orb size={120} pulse={false} />
      <h2 id="quota-title" className="text-[0.9375rem] font-medium text-v2-text-primary mt-5">{quotaTitle}</h2>
      <p className="text-[0.8125rem] text-v2-text-secondary mt-2 max-w-[260px] leading-relaxed">
        {nextMonthFirstLabel()} 自动恢复 · 先去别处逛逛？
      </p>
      {quotaCtas}
      {quotaFooter}
    </div>
  )

  const body = variant === 'trial' ? trialBody : quotaFailed ? neutralQuotaBody : dualQuotaBody

  if (!asOverlay) return body

  // Esc 关闭 + Tab 焦点陷阱：模态期间焦点不得逃逸到被遮罩的背景页。
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); handleClose(); return }
    if (e.key !== 'Tab') return
    const items = focusables()
    if (items.length === 0) return
    const first = items[0]
    const last  = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
      e.preventDefault(); last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault(); first.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={handleClose}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quota-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[360px] bg-bg-surface rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] animate-fade-up"
      >
        {body}
      </div>
    </div>
  )
}
