/**
 * @module   match-early-hint
 * @desc     匹配等待期「前置提示」的纯判据 —— 把 SSE meta 帧（漏斗召回定案、重排开始【之前】就已下发）
 *           里的客观事实翻译成一句给用户看的话，让他在还要等约 11 秒重排的时候就知道题库这一季的短板。
 *
 *   🔴【只在客观已确定的信号上提示，绝不做预测】。判据只有两条，都是漏斗跑完就板上钉钉的事实：
 *     - candidateCount === 0  ⇒ 一道都没召回（等价于服务层的 noMatch，它在 meta 发出前已定案）
 *     - matchedViaNeighbor    ⇒ 主观察点召回不足、只能去相邻话题借题
 *     其余情况一律返回 null（保持现状，不多说一个字）。
 *     绝不许加「我猜这个故事不行」这类预测判据 —— 误伤率结构上为 0 是产品硬约束
 *     「只引导、不劝退」的技术保证，加了预测就等于把这条保证拆了。
 *
 *   🔴【说题库的短板，不说用户的短板】。文案不得出现「你讲得不好 / 重录 / 换个说法」这类指向用户的话：
 *     产品红线是保留「随心表达」、不做成雅思命题作文、绝不拦截打断。
 *
 *   ⚠️【绝不把观察点 code（REL_11 等）露给用户】：句子里的名字只能取 primary.pointName（中文名）。
 *
 * @author   LingoBridge
 * @created  2026-08-15
 */
import type { MatchedPoint } from '@/lib/types'

/**
 * 判据的输入：SSE meta 帧里【重排开始前就已确定】的那几个字段的子集。
 * 刻意不直接收 FunnelStreamMeta，避免 lib 反向依赖 app/ 或 services/；两处 meta 类型都结构兼容本类型。
 */
export interface MatchEarlySignal {
  /** 萃取出的主观察点（中文名从这里取）；null = 萃取没给出可用观察点 */
  primary: MatchedPoint | null
  /** 主观察点召回不足、走了邻居增援层（客观事实，非预测） */
  matchedViaNeighbor: boolean
  /** 本次漏斗召回的候选题总数；0 = 一道都没召回 */
  candidateCount: number
}

/**
 * 一句前置提示。拆成三段是为了把观察点中文名单独拿出来做强调渲染
 * （复用结果态说明卡里 `text-brand-primary-dark font-medium` 那套写法），而不必在组件里切字符串。
 */
export interface MatchEarlyHint {
  /** 触发判据：neighbor = 走了邻居增援；noRecall = 零召回 */
  kind: 'neighbor' | 'noRecall'
  /** 名字之前的句子片段 */
  before: string
  /** 需要强调的观察点中文名；null = 这次没有可展示的观察点名，句子里不出现名字 */
  pointName: string | null
  /** 名字之后的句子片段（pointName 为 null 时恒为空串） */
  after: string
}

/**
 * 由 meta 帧派生等待期前置提示。
 * @param signal meta 帧的字段子集；null = 本次没有 meta 帧（`?stream=0` 降级路）→ 一律不提示
 * @returns      该提示；不满足两条客观判据时返回 null（不提示，保持现状）
 */
export function matchEarlyHint(signal: MatchEarlySignal | null): MatchEarlyHint | null {
  if (!signal) return null
  const name = signal.primary?.pointName ?? null

  // 零召回优先于邻居：一道都没召回时邻居层实际也没借到题，两者不会同真，此处顺序只为语义清晰。
  if (signal.candidateCount === 0) {
    return name
      ? { kind: 'noRecall', before: '你讲的是 ', pointName: name, after: ' 这类经历——这一季的真题没有覆盖到这个方向。' }
      : { kind: 'noRecall', before: '这一季的真题没有覆盖到这段语料的方向。', pointName: null, after: '' }
  }

  if (signal.matchedViaNeighbor) {
    return name
      ? { kind: 'neighbor', before: '你讲的是 ', pointName: name, after: ' 这类经历——这一季的真题里没有直接问它的，正在从相近话题里找能借上力的题。' }
      : { kind: 'neighbor', before: '这一季的真题里没有直接问到这个方向的，正在从相近话题里找能借上力的题。', pointName: null, after: '' }
  }

  return null
}
