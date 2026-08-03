/**
 * @module   matching/phase
 * @desc     匹配页页面形态的【唯一真源】—— 把「取数状态 + 结果内容」压成一个 MatchPhase 枚举，
 *           两端（MatchingDesktop / MatchingMobile）只认这一个值决定各槽位填什么，不再各自重复判定。
 *
 *   为什么必须是纯函数单独成文件：本次 bug 的成因就是「同一套判定在两个视图里各写一遍、且门控条件写错」。
 *   产品方实测那次低相关匹配跑了约 50 秒，期间 streamDone=false、totalVisible 恒为 0，
 *   旧代码落进正常分支 → 大标题「匹配到 0 道当季真题」+ 完全空白的左栏，50 秒后整页跳变成低相关视图。
 *   本模块把那条路钉成 waiting（见 __tests__/phase.test.ts 的回归用例），并用单测挡住它复发。
 *
 *   ⚠️ 本模块【只做呈现层判定】：不碰 SCORE_MID / SCORE_HIGH 阈值，不改 lowShown 派生，不回填占位分。
 *     入参全是上游已算好的标量，刻意不接 FunnelResult —— 免得日后有人在这里顺手加分数逻辑。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */

/** 匹配页的八种页面形态。桌面/移动各自只有一种骨架，同一 phase 在两端说同样的话、给同样的出口。 */
export type MatchPhase =
  /** 还没有任何可展示的题（首次加载 / 流式中途 totalVisible=0） */
  | 'waiting'
  /** 流式未完成，但已有可展示的题 */
  | 'streaming'
  /** 定稿，有可展示题 */
  | 'result'
  /** 定稿，无可展示题，但 lowShown 非空（低分题作为「确实翻遍了」的佐证列出） */
  | 'lowMatch'
  /** 定稿，一道题都没召回（三层漏斗全空） */
  | 'noMatch'
  /** 定稿，重排没产出（含「无可见题且无低分可列」这一等价组合） */
  | 'degraded'
  /** 请求失败 */
  | 'error'
  /** 当日匹配次数用尽（服务端 429） */
  | 'limit'

/** deriveMatchPhase 的入参：全是上游已算好的标量，本模块不做任何分数计算 */
export interface MatchPhaseInput {
  /** 服务端 429（当日上限）。优先级最高：它连「有没有结果」都不必看 */
  dailyLimitHit: boolean
  /** 取数失败的错误信息；null = 没出错 */
  error: string | null
  /** 是否已拿到 result 对象（含流式中间态骨架） */
  hasResult: boolean
  /** SSE 收到 done 帧（结果定稿）。【waiting 的门是它，不是 loading】，见下方注释 */
  streamDone: boolean
  /** 三层漏斗全空 */
  noMatch: boolean
  /** 机制①重排整体降级：候选存在但一分没产出 */
  rankingDegraded: boolean
  /** 跨所有 Part 的可见题数（≥ SCORE_MID，未打分不计） */
  totalVisible: number
  /** 低相关兜底切片的条数（全部 < SCORE_MID） */
  lowShownCount: number
}

/**
 * 由取数状态与结果内容推导页面形态。
 *
 * 判定顺序即优先级：
 * `limit → error → (!streamDone ? (totalVisible > 0 ? streaming : waiting)) → noMatch → degraded → lowMatch → result`
 *
 * 【关键】未定稿分支的门是 `streamDone` 而不是 `loading`：`loading` 在第一个 question 帧就变 false，
 * 而低相关场景 `totalVisible` 恒为 0 —— 两者相乘正是「匹配到 0 道 + 空白左栏」持续 50 秒的成因。
 *
 * @param i 取数状态与结果内容的标量快照
 * @returns 该时刻页面应当呈现的形态
 */
export function deriveMatchPhase(i: MatchPhaseInput): MatchPhase {
  // 429 不给重试（重试只会再撞一次 429），故必须排在 error 之前独立成一态
  if (i.dailyLimitHit) return 'limit'
  if (i.error) return 'error'
  // 未定稿：题还在陆续到达。有可展示题就是 streaming，没有就是 waiting —— 两者共用同一套骨架与进度条，
  // 差别只在列表区是骨架卡还是真卡，绝不允许在此期间判任何空态。
  if (!i.streamDone) return i.totalVisible > 0 ? 'streaming' : 'waiting'
  // 定稿了却没有 result 对象：不存在的组合（applyFinal 同时置两者），保守按 waiting 处理，
  // 绝不落进 result 让页面渲染一个空壳「匹配到 0 道」。
  if (!i.hasResult) return 'waiting'
  if (i.noMatch) return 'noMatch'
  // 降级【优先于】lowMatch，并兜住「无可见题且无低分可列」这一等价于降级的组合：
  // 那种情况下既没有可展示的题、也没有可作为佐证的低分题，只能给重试，不能给一张零卡片的空说明。
  if (i.rankingDegraded || (i.totalVisible === 0 && i.lowShownCount === 0)) return 'degraded'
  // 走到这里 lowShownCount > 0 必然成立
  if (i.totalVisible === 0) return 'lowMatch'
  return 'result'
}
