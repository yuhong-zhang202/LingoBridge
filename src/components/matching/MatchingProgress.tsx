/**
 * @module   MatchingProgress
 * @desc     匹配等待期的分阶段进度提示（桌面 + 移动共用）—— 一句随时间推进的文案 + 一条进度条，
 *           外加「已评估 N / M 道候选」真实计数与 75 秒后的逃生出口。匹配是一次真实模型调用
 *           （萃取 + 重排），此前这段时间里界面上只有一块不动的灰色骨架，用户无从判断是在跑还是卡死。
 *           纯前端计时，不依赖后端返回任何进度信号；文案/百分比的计算在 lib/matching-progress。
 *
 *   🔴【本组件必须在 waiting 与 streaming 两个 phase 处于同一 JSX 位置、同一父链、不带变化的 key】。
 *     计时器以【挂载时刻】为起点：一旦换位置，React 会卸载重建，进度条从 85% 掉回 0，
 *     用户会认定「又从头开始了」。这正是它被放进「恒在的状态说明卡」而不是各自分支里的原因。
 *
 *   🔴【不写时长承诺】。核过的真实数据：服务端单次调用近 14 天 247 次，p50=5.5s、p95=30.6s、最慢 56.4s；
 *     用户端到端是萃取 + 重排串联，客户端埋点里出现过 134 秒。任何具体数字都会被这类样本当场证伪，
 *     而承诺被证伪比不承诺更伤。预期管理交给进度条 + 真实计数。
 *
 * @author   LingoBridge
 * @created  2026-07-20
 */
'use client'
import { type JSX, useEffect, useState } from 'react'
import { BRAND_GRADIENT } from '@/lib/constants'
import { progressPct, stageText } from '@/lib/matching-progress'

/** 刷新节拍：文案与进度条都靠它推进；配合 CSS transition 视觉上是连续的 */
const TICK_MS = 250

/** 超时兜底出现的时刻：超过它仍未定稿，给一条「还在算」的说明 + 一个重新匹配的出口 */
const SLOW_HINT_MS = 75_000

interface Props {
  className?: string
  /** 已到达并评估完的题数（= result.questions.length）。与 candidateCount 同时有值才渲染计数行 */
  arrivedCount?: number
  /** 本次候选总数（SSE meta 帧）。?stream=0 降级路没有 meta 帧，此时为 null，计数行整行不渲染，不显示假分母 */
  candidateCount?: number | null
  /** 强制显示超时兜底行（只认 true）。默认由内部计时（> 75 秒）判定；mock 演示用它免去真等 75 秒 */
  slowHint?: boolean
  /** 超时兜底的「重新匹配」出口。注意重试会真的再跑一次模型（多一次 AI 费用 + 多计一次当日配额），
   *  故做成低强度文本按钮放在说明卡里，不做显眼 CTA */
  onRetry?: () => void
}

/**
 * 匹配等待进度：一句分阶段文案 + 一条渐近进度条 +（可选）真实计数与超时出口。
 * 挂载即开始计时，卸载清理 interval。
 * @param arrivedCount    已到达题数
 * @param candidateCount  候选总数（null = 无此信号，不渲染计数行）
 * @param slowHint        强制显示超时兜底行（不传则按内部计时判定）
 * @param onRetry         超时兜底的重新匹配回调
 * @returns               进度提示区块
 */
export default function MatchingProgress({
  className = '',
  arrivedCount,
  candidateCount,
  slowHint,
  onRetry,
}: Props): JSX.Element {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    // 用起始时刻做差而非累加计数：标签页被切到后台时 interval 会被节流，累加会越走越慢。
    const startedAt = Date.now()
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  const pct = progressPct(elapsedMs)
  // 计数行与进度条【并行】，绝不拿计数驱动进度条：候选数在 meta 帧后才知道，
  // 用它反推百分比会让进度条在半路倒退。
  const showCount = arrivedCount != null && arrivedCount >= 1 && candidateCount != null && candidateCount > 0
  // slowHint 是【强制开启】而非覆盖：传 false 时仍由计时器自行判定，
  // 否则「生产恒传 false」会把这条唯一的逃生口永久关掉。
  const showSlow = slowHint === true || elapsedMs > SLOW_HINT_MS

  return (
    <div className={className}>
      {/* aria-live 由外层状态说明卡统一承担（role=status + aria-live=polite）：
          两个嵌套 live region 会让读屏把同一句话播报两遍。 */}
      <p className="text-[0.8125rem] text-v2-text-secondary">{stageText(elapsedMs)}</p>
      <div
        className="mt-2.5 h-1 w-full rounded-full bg-black/[0.06] overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label="匹配进度"
      >
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-linear motion-reduce:transition-none"
          style={{ width: `${pct}%`, backgroundImage: BRAND_GRADIENT }}
        />
      </div>
      {/* 计数行随每个 question 帧变化，必须 aria-hidden：否则读屏会被逐条刷屏 */}
      {showCount && (
        <p className="mt-2 text-[0.75rem] text-v2-text-muted" aria-hidden="true">
          已评估 {arrivedCount} / {candidateCount} 道候选
        </p>
      )}
      {showSlow && onRetry && (
        <p className="mt-2 text-[0.75rem] text-v2-text-muted leading-relaxed">
          比平时久了一些，还在算。可以再等等，也可以重新匹配一次。
          <button
            onClick={onRetry}
            className="ml-1.5 min-h-[44px] inline-flex items-center text-[0.75rem] font-medium text-v2-text-secondary underline underline-offset-2 active:opacity-60"
          >
            重新匹配
          </button>
        </p>
      )}
    </div>
  )
}
