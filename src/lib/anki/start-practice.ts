/**
 * @module   anki/start-practice
 * @desc     进练习前的「结对确认」——分析页与匹配页共用的【唯一一份】。
 *
 *   【它不只是检查冲突】这次 saveAnkiPair 是故事流里【唯一的自动结对动作】：
 *   把 (questionId, storyId) 绑成题卡。漏掉它就是台账 179 复发 —— 实测 47/49 条语料在素材库
 *   被显示成「还没绑题目」，用户于是对本来有题的语料再跑一整条 AI 匹配，其中 2 条还混进了
 *   「匹配失败」的分析样本。所以这个函数【必须】在每条进 /practice 的故事流入口上跑一次。
 *
 *   【为什么抽成共享模块而不是两页各写一份】装在这里的不是逻辑，是**同一个接口的同一组分支**
 *   （无 id 直接放行 / 409 撞别的语料弹框 / 其余一律静默放行）。同类分叉本项目已经付过一次学费
 *   （见 lib/restructure-gate.ts 顶注引的 commit 28d5e95：同一接口两条路径各写一份，失败率口径分叉，
 *   而分叉的表现会被当成产品结论读）。2026-08-27 匹配页加「开始练习」直达入口时，这段分支
 *   就是第二个调用方，故就地收敛成一份。
 *
 *   【职责边界·刻意划死】本模块**只判定 + 发那一次结对请求，不动作**：
 *     · 不碰 React · 不 track · 不跳转 · 不拼 /practice 的 URL。
 *   跳转由调用方在 `go` 里自己做——`startPracticeSession()` 必须紧贴 `navigate('/practice?...')`
 *   且 URL 保持字面量，见 src/__tests__/practice-session-entry-rule.test.ts（静态扫描守卫，
 *   它的已知漏判正是「URL 不是字面量」和「开场与跳转隔太远」）。
 *
 * @author   LingoBridge
 * @created  2026-08-27
 */
'use client'
import { saveAnkiPair, type CorpusBrief } from '@/lib/anki/cards-client'

/** startPracticeWithPairCheck 的入参 */
export interface PairCheckArgs {
  /** 要练的题 id；空串 = 拿不到题（直接放行进练习，不做结对） */
  questionId: string
  /** 本次要绑上去的语料 id；空串同上 */
  storyId: string
  /**
   * 这道题的卡背绑着【别的】语料时回调（携当前已绑语料，供换语料对比框显示）。
   * 🔴 调用方的两条出路（换 / 保留）都必须接着进练习：用户点的是「开始练习」，
   *    换不换语料是这条路上的岔口，不该因为岔口的结果把他留在原页。
   */
  onConflict: (current: CorpusBrief) => void
  /** 真正进练习（调用方自己 startPracticeSession() + navigate） */
  go: () => void
}

/**
 * 进练习前确认这道题的题卡背面绑的是不是当前这段语料。
 *
 * 【为什么把这个问题放在「开始练习」这一步】2026-08-18 产品方定。雅思流已经在语料落库时自动存对子了
 * （见 restructure/page.tsx），但会撞上一种冲突：**这道题之前用别的语料存过卡**——
 * Anki 卡是 (user_id, question_id) 唯一，一道题只能有一个背面。近 60 天 317 组配对里 22 组撞这个。
 *
 * 冲突当时【刻意不在整理页问】：那时用户点的是「开始分析」，脑子里想的是「我要分析这段话」，
 * 弹一个换语料框是拿我们的便利打断他的正事。**而「开始练习」才是真正和"这张卡的背面是哪段语料"
 * 相关的动作** —— 练的就是那个答案，在这里问才有上下文。
 *
 * ⚠️ 不跨页传状态：这里重发一次 saveAnkiPair 就能拿到同样的 409，整理页那次失败不留任何痕迹。
 *   重发是廉价的——路由把冲突判定放在计次之前（`api/anki/cards/route.ts` 注释「不白扣额度」），
 *   已绑的情况下不计次、不调 AI。顺带还有个好处：整理页那次若因断网静默失败，这里会自动补上。
 * ⚠️ 同一段语料重发 → 也会 409（路由不比对 corpusId），故必须比 id：是自己就当已绑，直接走。
 * ⚠️ 除冲突外任何失败都【静默放行】，绝不因为一个副作用把用户挡在练习门外。
 *
 * @param  args  题/语料 id + 冲突回调 + 进练习回调（见 PairCheckArgs）
 * @returns      无（结局体现在 onConflict / go 两个回调上，恰好走其中一个）
 * @sideEffect   POST /api/anki/cards —— 故事流唯一的自动结对动作（见模块顶注）
 */
export async function startPracticeWithPairCheck(args: PairCheckArgs): Promise<void> {
  const { questionId, storyId, onConflict, go } = args
  if (!questionId || !storyId) { go(); return }
  const pair = await saveAnkiPair(questionId, storyId).catch(() => null)
  if (pair && !pair.ok && pair.kind === 'bound' && pair.currentCorpus.id !== storyId) {
    onConflict(pair.currentCorpus)   // 弹对比框，选完（换/保留）由 dialog 回调接着 go()
    return
  }
  go()
}
