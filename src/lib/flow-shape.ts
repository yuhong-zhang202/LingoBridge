/**
 * @module   flow-shape
 * @desc     核心链路的「步骤定义」+「本次链路形态标识」+「步骤序列派生」的唯一真源。
 *
 *   【为什么需要形态标识（2026-08-27）】整理确认页改为按输入方式分流后，同一个 `/analysis`
 *   页面可能来自四条形态不同的链路（语音/文字 × 故事流/雅思流），它们实际经过的步数不一样
 *   （3～5 步）。而 `/practice`、`/feedback` 这两页**从自身参数完全判不出自己在哪条流上**
 *   （practice 的 URL 只有 questionId/storyId/level/review/rank，feedback 连参数都没有）。
 *
 *   🔴 **绝不能用 `rank` 反推流向**：analysis 页注释写着「仅故事流有 rank」，但匹配页同时写着
 *   「rank<1 不拼」，从题库/素材库进的故事流也没有 rank —— 用它判流会误判。
 *
 *   【为什么用 sessionStorage 而不是 URL】项目有未决的隐私问题（`/matching` 的 URL 已经携带
 *   故事全文，见 Project_State.md §7），不该再往 URL 加东西。而步骤条是**纯展示**
 *   （aria-hidden、不可点，见 StepBar / FlowShellDesktop），读不到就降级回 5 步，不影响任何功能。
 *   项目已有惯例：putHandoff / startPracticeSession 都用 sessionStorage。
 *
 *   【它只喂步骤条，别拿去做别的】本模块的读值**不许参与任何业务分支**（跳转目的地、语料 source、
 *   额度判定……）：sessionStorage 可能被清、可能是上一条链路的残留，一旦接进业务就是静默错数据。
 *   语料的 source 由 URL 上的 `mode` 参数显式带（见 restructure/page.tsx），不走这里。
 *
 * @author   LingoBridge
 * @created  2026-08-27
 */

/** 核心链路的步骤 key（顺序即流程顺序） */
export type StepKey = 'story' | 'restructure' | 'matching' | 'analysis' | 'practice'

/** 步骤条上的一个点 */
export interface FlowStep {
  key: StepKey
  label: string
}

/**
 * 全量 5 步（顺序即流程顺序）。
 * **同时是「读不到形态标识」时的安全降级序列** —— 与本次改动之前的行为逐点一致。
 */
export const STEPS: FlowStep[] = [
  { key: 'story',       label: '故事' },
  { key: 'restructure', label: '整理' },
  { key: 'matching',    label: '题目' },
  { key: 'analysis',    label: '分析' },
  { key: 'practice',    label: '练习' },
]

/** 输入方式：语音（/recording）/ 文字（/write、首页文本面板） */
export type FlowMode = 'voice' | 'text'
/** 链路：故事流（无 qid，要经过题目匹配）/ 雅思流（带 qid，直达分析） */
export type FlowKind = 'story' | 'ielts'

/** 本次链路的形态 = 输入方式 × 链路 */
export interface FlowShape {
  mode: FlowMode
  flow: FlowKind
}

const FLOW_SHAPE_KEY = 'lingobridge:flow_shape'

/**
 * 四种形态各自**实际会经过**的步骤序列。
 * 差异只来自两件事：文字路径跳过「整理」（2026-08-27 起）、雅思流跳过「题目」（一直如此）。
 * 后者顺带修掉一个今天就有的 bug：雅思流从不经过匹配页，用户却在 /analysis 上看到「题目」是橙色已完成。
 */
const SEQUENCES: Record<FlowMode, Record<FlowKind, StepKey[]>> = {
  voice: {
    story: ['story', 'restructure', 'matching', 'analysis', 'practice'],
    ielts: ['story', 'restructure', 'analysis', 'practice'],
  },
  text: {
    story: ['story', 'matching', 'analysis', 'practice'],
    ielts: ['story', 'analysis', 'practice'],
  },
}

/**
 * 记下本次链路形态（两个提交 hook 在放行跳转那一刻各调一次）。
 * @param  shape  { mode, flow }
 * @sideEffect    写 sessionStorage；存储不可用（无痕模式/配额）时静默失败 —— 消费方会降级回 5 步
 */
export function setFlowShape(shape: FlowShape): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(FLOW_SHAPE_KEY, JSON.stringify(shape))
  } catch {
    /* 存储不可用：步骤条降级回 5 步，纯展示、无功能影响 */
  }
}

/**
 * 抹掉形态标识（走「兜底回整理页」这条窄路时调）。
 *
 * 【为什么兜底路径是「清掉」而不是「改写」】那条路上的用户确实经过了整理页，
 * 可他的输入方式又是文字 —— 四种形态里没有一种能如实描述它。宁可让消费方降级回现状的 5 步
 * （里面含「整理」，对他成立），也不写一个骗人的标识。
 * @sideEffect  删 sessionStorage 的形态键；存储不可用时静默（读侧解析失败同样返回 null）
 */
export function clearFlowShape(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(FLOW_SHAPE_KEY)
  } catch {
    /* 存储不可用：读也读不出来，等同已清 */
  }
}

/**
 * 读本次链路形态。
 * @returns  合法形态；无标识 / 解析失败 / 字段非法一律 null（调用方据此降级回 5 步）
 */
export function readFlowShape(): FlowShape | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(FLOW_SHAPE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as { mode?: unknown; flow?: unknown }
    const mode = parsed?.mode
    const flow = parsed?.flow
    if ((mode !== 'voice' && mode !== 'text') || (flow !== 'story' && flow !== 'ielts')) return null
    return { mode, flow }
  } catch {
    return null
  }
}

/**
 * 按本次链路形态派生步骤序列。
 *
 * 🔴【必须钉死的边界】**序列里没有当前步时一律降级回全量 5 步**。少了这一行就一定 ship 成 bug：
 *   STEPS.findIndex 会返回 -1 → 桌面步骤名空白、所有点显示「未到达」，移动端整条变灰。
 *   最典型的一条真实路径：文字路径整理失败回落 `/restructure`（形态是 text 但人确实站在「整理」这一步）。
 *   把它写成通用不变式（而不是只给 restructure 开特例），任何形态/页面对不上都能安全兜住。
 *
 * @param  shape        本次链路形态；null = 读不到标识
 * @param  currentStep  当前页所处的步骤
 * @returns             该链路的步骤序列（读不到标识 / 当前步不在序列里 → 全量 5 步）
 */
export function deriveSteps(shape: FlowShape | null, currentStep: StepKey): FlowStep[] {
  if (shape === null) return STEPS
  const keys = SEQUENCES[shape.mode][shape.flow]
  if (!keys.includes(currentStep)) return STEPS
  return STEPS.filter((s) => keys.includes(s.key))
}
