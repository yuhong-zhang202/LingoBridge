/**
 * @module   match-level.test
 * @desc     事故守卫①（【行为】测试）：levelForScore 对「没有分数」的处置。
 *
 *           守的是哪次事故：40da791（2026-07-16）之前，这里写的是 `const s = score ?? 100`。
 *           重排整体降级（模型调用超时/失败，rankQuestions 静默 `catch { return [] }`）或模型漏题时，
 *           候选的 relevanceScore 是 undefined —— `?? 100` 把「我们不知道它贴不贴合」直接兑换成 100 分，
 *           于是【整批候选】以 match_level='high' 写进 corpus_question_matches，而且这张表是反查表，
 *           下游任何读它的功能都继承这个谎（当时同一轮事故里有 6 个故事是整体降级的，候选数最多 35 道）。
 *           修法是产品不变式 2：没有分数 → 不落档、不落库。
 *
 *           为什么值得单独一条守卫：2026-08-06 架构审计把本函数改回 `score === undefined → 'high'`，
 *           全量测试 790 条一条不红 —— 这条判定此前完全在真空里。
 *
 *           边界（诚实标注）：本文件只钉纯函数的返回值。「写进库的那行真的没有 high」由同批的
 *           src/app/api/matching/__tests__/persist-match-level.test.ts 从写库口再钉一次。
 * @author   LingoBridge
 * @created  2026-08-08
 */
import { levelForScore } from '@/lib/match-level'
import { SCORE_HIGH, SCORE_MID } from '@/lib/constants'

describe('levelForScore【行为】没有分数 = 不知道，绝不当成高匹配', () => {
  it('undefined（重排降级 / 模型漏题）→ null，即不落库；历史 bug 是在这里返回 high', () => {
    expect(levelForScore(undefined)).toBeNull()
  })

  it('一整批候选全没分数（重排整体降级的真实形态）→ 一条都不落库', () => {
    const batch = [undefined, undefined, undefined, undefined]
    expect(batch.map(levelForScore)).toEqual([null, null, null, null])
    // 写成「没有任何一档非 null」而不是逐个比对，是为了让将来新增档位时这条仍然成立
    expect(batch.map(levelForScore).filter((l) => l !== null)).toHaveLength(0)
  })
})

describe('levelForScore【行为】有分数时按两条线分档（85 / 60，只有两条线）', () => {
  it('≥ SCORE_HIGH → high', () => {
    expect(levelForScore(SCORE_HIGH)).toBe('high')
    expect(levelForScore(100)).toBe('high')
  })

  it('[SCORE_MID, SCORE_HIGH) → mid', () => {
    expect(levelForScore(SCORE_MID)).toBe('mid')
    expect(levelForScore(SCORE_HIGH - 1)).toBe('mid')
  })

  it('< SCORE_MID → null（低档已于 2026-07-16 取消，不展示也不入库）', () => {
    expect(levelForScore(SCORE_MID - 1)).toBeNull()
    expect(levelForScore(0)).toBeNull()
  })

  it('两条线的临界点各自归属明确（断言写成常量表达式：改阈值不必改本文件，改错分档才会红）', () => {
    expect(levelForScore(SCORE_HIGH - 0.5)).toBe('mid')
    expect(levelForScore(SCORE_MID - 0.5)).toBeNull()
  })
})
