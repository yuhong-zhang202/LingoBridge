/**
 * @module   dashboard-verdict
 * @desc     看板「今日结论条」的判定纯逻辑 —— 从看板返回体算出「今天有哪几件事要处理」。
 *           四个判定源（方案 §二，全部今日东八区口径、复用现有字段，不新造口径）：
 *             ① 计费失败  todayFailuresTotal > 0（红，系统故障级）
 *             ② 新反馈    feedback.unhandledCount > 0（品牌深色——反馈是要处理、不是坏了，不用红）
 *             ③ 成本      沿用 Hero 卡既有 costWarn 判定（超日预算 或 超近 7 日均 2 倍，黄）
 *             ④ 速度      todayStatus.slowestPhase.p90 > latencyWarnMs（黄）
 *           🔴 flow_events 的「该我们修」桶刻意不进结论条：它是区间口径，与「今日」混用是误报温床
 *           （ux 三轮评审最重要的口径决定之一），它只在「出事了吗」区展示。
 *           抽成纯函数：判定逻辑可单测（四源各自触发/不触发），组件只管渲染与锚点跳转。
 * @author   LingoBridge
 * @created  2026-08-04
 */
import { formatCny } from '@/lib/format-cost'

// ── 锚点 id（结论条 chip 的跳转落点，由 dashboard/page.tsx 挂在对应区块的包裹元素上）──
/** ①区失败明细表 */
export const ANCHOR_FAILURE_DETAIL = 'anchor-failure-detail'
/** 「有新反馈吗」区 */
export const ANCHOR_FEEDBACK = 'anchor-feedback'
/** 「钱花在哪」区 */
export const ANCHOR_COST = 'anchor-cost'
/** ①区「各环节耗时」面板 */
export const ANCHOR_LATENCY = 'anchor-latency'

/** 结论条里的一件「要处理的事」 */
export type VerdictItem = {
  key: 'failure' | 'feedback' | 'cost' | 'latency'
  /** chip 主文案（不含「查看」尾缀，组件统一追加） */
  text: string
  /** 色调：error=红（仅系统故障）/ brand=品牌深色（反馈）/ warn=黄（成本、变慢） */
  tone: 'error' | 'brand' | 'warn'
  /** 锚点落点元素 id */
  anchorId: string
}

/** 判定所需的看板字段子集（全部为 /api/dashboard 既有字段，无新口径） */
export type VerdictInput = {
  /** 今日系统故障次数（今日东八区口径） */
  todayFailuresTotal: number
  /** 今日失败最多的环节中文名（todayFailuresByPhase[0]，可空） */
  topFailurePhase: string | null
  /** 未处理反馈条数（feedback.unhandledCount；加载失败时调用方传 0，不虚报） */
  unhandledFeedback: number
  todayCost: number
  avgDailyCost7: number
  dailyBudget: number
  /** 区间内 P90 最慢环节（todayStatus.slowestPhase，可空） */
  slowestPhase: { name: string; p90: number } | null
  latencyWarnMs: number
}

/**
 * 成本告警判定：超日预算参照线（绝对过高）或超近 7 日均值 2 倍（突增）。
 * 与原 Hero 成本卡的 costWarn 完全同式（复用现有判定，勿改）。
 * @param todayCost      今日花费
 * @param avgDailyCost7  近 7 日日均花费
 * @param dailyBudget    日预算参照线
 * @returns              是否告警
 */
export function isCostWarn(todayCost: number, avgDailyCost7: number, dailyBudget: number): boolean {
  return todayCost > dailyBudget || (avgDailyCost7 > 0 && todayCost > avgDailyCost7 * 2)
}

/**
 * 算出结论条要点名的全部事项（顺序即展示顺序：失败 → 反馈 → 成本 → 速度）。
 * @param input  看板字段子集（见 VerdictInput）
 * @returns      要处理的事项列表；全绿时为空数组
 */
export function computeVerdict(input: VerdictInput): VerdictItem[] {
  const items: VerdictItem[] = []
  if (input.todayFailuresTotal > 0) {
    items.push({
      key: 'failure',
      text: `计费失败 ${input.todayFailuresTotal} 次，卡在${input.topFailurePhase ?? '未知环节'}`,
      tone: 'error',
      anchorId: ANCHOR_FAILURE_DETAIL,
    })
  }
  if (input.unhandledFeedback > 0) {
    items.push({
      key: 'feedback',
      text: `反馈 ${input.unhandledFeedback} 条未处理`,
      tone: 'brand',
      anchorId: ANCHOR_FEEDBACK,
    })
  }
  if (isCostWarn(input.todayCost, input.avgDailyCost7, input.dailyBudget)) {
    // 两种触发原因给不同措辞：突增说「超 7 日均 2 倍」，仅超预算说「超日预算」，别拿一句话冒充另一种原因
    const surge = input.avgDailyCost7 > 0 && input.todayCost > input.avgDailyCost7 * 2
    items.push({
      key: 'cost',
      text: surge
        ? `今日 ${formatCny(input.todayCost)} · 超 7 日均 2 倍`
        : `今日 ${formatCny(input.todayCost)} · 超日预算 ¥${input.dailyBudget}`,
      tone: 'warn',
      anchorId: ANCHOR_COST,
    })
  }
  if (input.slowestPhase && input.slowestPhase.p90 > input.latencyWarnMs) {
    items.push({
      key: 'latency',
      text: `${input.slowestPhase.name}变慢 P90 ${(input.slowestPhase.p90 / 1000).toFixed(1)}s`,
      tone: 'warn',
      anchorId: ANCHOR_LATENCY,
    })
  }
  return items
}

/**
 * 全绿态的一行结论（方案 §二钉死的措辞结构：不用处理 · 无失败 · 成本正常 ¥x · 无新反馈）。
 * @param todayCost  今日花费（展示「成本正常 ¥x」）
 * @returns          全绿一句话
 */
export function allClearText(todayCost: number): string {
  return `今天不用处理什么 · 无失败 · 成本正常 ${formatCny(todayCost)} · 无新反馈`
}
