/**
 * @module   ielts-corpus-binding
 * @desc     雅思流「语料落库那一刻」的自动绑定动作 —— 两条路径共用的【唯一一份】：
 *             · 文字路径：useStorySubmit 建完语料后直接调（2026-08-27 起文字路径跳过整理确认页）；
 *             · 语音路径：restructure 页点「开始分析」落库后调（语音仍走整理页）。
 *
 *   【它做两件下游依赖的事，一件都不能丢】
 *     1. upsertMatch(storyId, qid, 'chosen') —— 让答过的语料出现在该题的「练习题目」页；
 *     2. saveAnkiPair(qid, storyId) —— **台账 179（2026-08-18 产品方拍板）的修复本体**。
 *        不自动结对会让 47/49 条语料在素材库显示成「还没绑题目」（素材库的 bound 判据数的是 Anki 卡、
 *        不是 corpus_question_matches），用户于是对本来有题的语料再跑一整条 AI 匹配，
 *        其中 2 条还混进了「匹配失败」的分析样本、当成供给缺口的证据。
 *
 *   🔴【任何结局都不出声、不阻断跳转】——包括「这道题你之前用别的语料存过卡」这种 409 冲突。
 *     用户此刻点的是「开始分析 / 提交故事」，脑子里想的是「我要分析这段话」，他没在想 Anki 卡。
 *     在这里弹一个换语料对比框，正是 2026-08-18 那次改动想消灭的「拿我们的便利打断他的正事」。
 *     ⇒ 冲突【推迟到分析页点「开始练习」时再问】（产品方 2026-08-18 定），那一步才和
 *       「这张卡的背面是哪段语料」真正相关。见 lib/anki/start-practice.ts。
 *     ⇒ 那边会重发一次 saveAnkiPair 拿到同样的 409，本次失败不留任何状态，无需跨页传递。
 *
 *   ⚠️【别和 lib/anki/start-practice 的 startPracticeWithPairCheck 搞混】：那个是「进练习前的结对确认」，
 *     撞 409 要弹换语料对比框；这里是「语料落库时的静默自动结对」，两者语义不同，故是两个函数。
 *
 *   【为什么必须抽成共享函数】同一组动作写成两份已经付过一次学费（见 lib/restructure-gate.ts 顶注
 *   引的 commit 28d5e95）：分叉之后两条路径的行为会各自漂移，而漂移的表现是数据上的差异、
 *   会被当成产品结论读。
 *
 * @author   LingoBridge
 * @created  2026-08-27
 */
'use client'
import { upsertMatch } from '@/lib/db/matches'
import { saveAnkiPair, autoPairOutcome } from '@/lib/anki/cards-client'

/**
 * 雅思流语料落库后的自动绑定（配对 + 存题卡），静默执行。
 * @param  questionId  题目 id（雅思流的 qid）
 * @param  storyId     刚落库的语料 id
 * @returns            结对结局：'saved' 已存上 / 'conflict' 该题已绑别的语料 / 'skip' 其余（匿名、限流、网络失败）
 * @sideEffect         upsert corpus_question_matches 一行 + POST /api/anki/cards；
 *                     两者的失败都被吞掉（只 console.error 配对失败），绝不抛、绝不阻断调用方跳转
 */
export async function bindIeltsCorpus(questionId: string, storyId: string): Promise<'saved' | 'conflict' | 'skip'> {
  // 写库失败不阻断（upsertMatch 本幂等，下次进来会自然补上）
  await upsertMatch(storyId, questionId, 'chosen').catch((e) => console.error('[ielts-binding] upsertMatch failed', e))
  const pair = await saveAnkiPair(questionId, storyId).catch(() => null)
  return autoPairOutcome(pair)
}
