/**
 * @module   match-early-hint.test
 * @desc     等待期前置提示判据的单测 —— 守住四条产品硬约束：
 *           1) 只在【客观已确定】的两个信号上提示（走邻居 / 零召回），其余一律不提示（误伤率结构上为 0）；
 *           2) `?stream=0` 降级路没有 meta 帧 → 不提示且不崩；
 *           3) 文案说的是题库这一季的短板，绝不含「重录 / 换个说法 / 讲得不好」这类指向用户的劝退话；
 *           4) 绝不把观察点 code（REL_11 等）露给用户。
 * @author   LingoBridge
 * @created  2026-08-15
 */
import { matchEarlyHint, type MatchEarlySignal } from '@/lib/match-early-hint'
import type { MatchedPoint } from '@/lib/types'

const PRIMARY: MatchedPoint = {
  pointCode: 'REL_11',
  pointName: '一次关系摩擦或冲突',
  dimension: '人际羁绊',
  reason: '整段故事的重心在那次争执上',
}

/** 造一份 meta 帧子集。默认是「主观察点有题、没走邻居」的正常场景 */
function signal(over: Partial<MatchEarlySignal> = {}): MatchEarlySignal {
  return { primary: PRIMARY, matchedViaNeighbor: false, candidateCount: 8, ...over }
}

/** 把一条提示拼回完整句子，供文案层面的断言使用 */
function sentence(h: ReturnType<typeof matchEarlyHint>): string {
  return h ? `${h.before}${h.pointName ?? ''}${h.after}` : ''
}

describe('matchEarlyHint · 判据（只认客观事实，不做预测）', () => {
  test('走了邻居增援 → 提示，且带主观察点中文名', () => {
    const h = matchEarlyHint(signal({ matchedViaNeighbor: true }))
    expect(h).not.toBeNull()
    expect(h?.kind).toBe('neighbor')
    expect(h?.pointName).toBe('一次关系摩擦或冲突')
  })

  test('主观察点有题、没走邻居 → 一律不提示（保持现状）', () => {
    expect(matchEarlyHint(signal())).toBeNull()
    // 候选很少但没走邻居层，同样不提示：「候选少所以大概率是空的」属预测，不是客观事实
    expect(matchEarlyHint(signal({ candidateCount: 1 }))).toBeNull()
  })

  test('零召回（candidateCount=0）→ 提示', () => {
    const h = matchEarlyHint(signal({ candidateCount: 0 }))
    expect(h?.kind).toBe('noRecall')
    expect(h?.pointName).toBe('一次关系摩擦或冲突')
  })

  test('无 meta 帧（?stream=0 降级路）→ 不提示，且不抛', () => {
    expect(() => matchEarlyHint(null)).not.toThrow()
    expect(matchEarlyHint(null)).toBeNull()
  })

  test('萃取没给出主观察点 → 仍能出提示，只是句子里不带名字（不崩、不塞占位）', () => {
    const h = matchEarlyHint(signal({ primary: null, candidateCount: 0 }))
    expect(h).not.toBeNull()
    expect(h?.pointName).toBeNull()
    expect(h?.after).toBe('')
    expect(sentence(h).length).toBeGreaterThan(0)
  })
})

describe('matchEarlyHint · 文案红线', () => {
  const cases = [
    matchEarlyHint(signal({ matchedViaNeighbor: true })),
    matchEarlyHint(signal({ candidateCount: 0 })),
    matchEarlyHint(signal({ primary: null, matchedViaNeighbor: true })),
    matchEarlyHint(signal({ primary: null, candidateCount: 0 })),
  ]

  test('绝不出现观察点 code', () => {
    for (const h of cases) expect(sentence(h)).not.toContain('REL_11')
  })

  test('绝不出现劝退/打断用户表达的措辞', () => {
    // 「只引导、不劝退」：提示的落点是题库这一季没覆盖，不是用户这段讲得不行
    for (const word of ['重录', '重新讲', '换个说法', '讲得不好', '不合适', '建议你']) {
      for (const h of cases) expect(sentence(h)).not.toContain(word)
    }
  })

  test('两类提示都点明是「这一季的真题」没有，而不是语料有问题', () => {
    for (const h of cases) expect(sentence(h)).toContain('这一季的真题')
  })
})
