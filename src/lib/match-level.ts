/**
 * @module   match-level
 * @desc     相关性分数 → 落库档位的唯一判定（corpus_question_matches.match_level 的来源）。
 *           2026-08-08 从 src/app/api/matching/route.ts 原样抽出，逻辑一字未改，只为让这条
 *           判定能被单测直接钉住 —— 它此前是 route 里的模块私有函数，全量测试对它是真空，
 *           把 `score === undefined` 改回历史 bug 形态（返回 'high'）全套测试照样绿。
 *           抽成独立模块而不是 export 出 route：这是「写什么进库」的领域规则，与 HTTP 无关，
 *           挂在 route 上会让测它必须先把整条 Next 路由的依赖 mock 一遍（支点脆）。
 * @author   LingoBridge
 * @created  2026-08-08
 */
import { SCORE_HIGH, SCORE_MID } from '@/lib/constants'

/**
 * 相关性分数 → 匹配档位（< SCORE_MID 不展示亦不入库）。
 *
 * 无 score（重排降级或模型漏题）一律返回 null = 不落库。历史上这里是 `score ?? 100`，
 * 等于把「我们不知道它贴不贴合」永久写成 `match_level='high'`，且下游任何读这张表的
 * 功能都会继承这个谎。展示层可以选择乐观降级（那是产品决策），但落库层不行：
 * 写进库的必须是我们真的知道的事。
 *
 * 2026-07-16：'low' 档随产品方拍板取消（台账 042），< SCORE_MID 一律不入库——
 * 与展示层同一条线，不再有「库里有、界面没有」的档位。
 *
 * @param score  重排给出的相关性分数；未打分（降级/漏题）时为 undefined
 * @returns      'high' / 'mid' / null（null = 不落库）
 */
export function levelForScore(score: number | undefined): 'high' | 'mid' | null {
  if (score === undefined) return null
  if (score >= SCORE_HIGH) return 'high'
  if (score >= SCORE_MID) return 'mid'
  return null
}
