/**
 * @module   sample-weight.test
 * @desc     隐藏区抽样权重（Horvitz-Thompson 冻结表）回归测试 —— 台账 036。
 *           旧实现用 `scale = hiddenTotal / n` 每轮实测重算，两处错：
 *           (1) 权重应是历史入选概率的倒数（常数），不是本轮实测；
 *           (2) π 逐故事不同（1.0~0.2），全局常数把确定性观测当成 3.46 条用。
 *           本文件把「权重是常数、且逐故事」这件事钉死。
 * @author   LingoBridge
 * @created  2026-07-17
 */
import {
  sampleWeight,
  HIDDEN_FRAME,
  FRAME_HIDDEN_TOTAL,
  FRAME_HIDDEN_SAMPLED,
} from '../hidden-sample-weight'

describe('抽样权重 · 冻结表结构', () => {
  test('1. visible 区权重恒为 1（全量标注，入选概率 1）', () => {
    expect(sampleWeight('visible', 'S016')).toBe(1)
    expect(sampleWeight('visible', 'S061')).toBe(1)
    // 连不在表里的故事，visible 也必须是 1 —— 不查表、不告警
    expect(sampleWeight('visible', 'S999')).toBe(1)
  })

  test('2. 冻结表覆盖建金标时的全部 40 个故事', () => {
    expect(Object.keys(HIDDEN_FRAME)).toHaveLength(40)
  })

  test('3. 权重全部落在 [1, 5] —— π=ceil(n/5)/n 的值域', () => {
    for (const [sid, { n, k }] of Object.entries(HIDDEN_FRAME)) {
      const w = n / k
      expect(w).toBeGreaterThanOrEqual(1)
      expect(w).toBeLessThanOrEqual(5)
      expect(k).toBe(Math.ceil(n / 5))   // 抽样规则本身：per-story i%5，故 k=ceil(n/5)
      expect(sid).toMatch(/^S\d{3}$/)
    }
  })
})

describe('抽样权重 · 逐故事口径（本次修复的核心）', () => {
  test('4. π=1 的故事权重必须为 1：隐藏区只有 1 条，那条是【必被抽中】的确定性观测', () => {
    // S061/S063 历史隐藏区各只有 1 条 → i%5===0 必取 → π=1
    // 旧的全局常数 204/59=3.458 会把这一条确定性观测当成 3.46 条用
    expect(sampleWeight('hidden_sampled', 'S061')).toBe(1)
    expect(sampleWeight('hidden_sampled', 'S063')).toBe(1)
  })

  test('5. 隐藏区恰 5 条（整除）的故事权重为 5：抽 1 留 4，π=0.2', () => {
    expect(sampleWeight('hidden_sampled', 'S020')).toBe(5)
    expect(sampleWeight('hidden_sampled', 'S060')).toBe(5)
  })

  test('6. 权重逐故事不同 —— 不是一个全局常数（旧实现正是错在这）', () => {
    const distinct = new Set(Object.values(HIDDEN_FRAME).map((f) => f.n / f.k))
    expect(distinct.size).toBeGreaterThan(1)
    expect(sampleWeight('hidden_sampled', 'S061')).not.toBe(sampleWeight('hidden_sampled', 'S020'))
  })
})

describe('抽样权重 · 总量还原（HT 无偏性的算术前提）', () => {
  test('7. Σ(k_i × w_i) 还原出冻结框的隐藏区总量 204', () => {
    // 每个故事抽中 k_i = ceil(n_i/5) 条，每条权重 w_i = n_i/k_i
    // → 该故事贡献 k_i × (n_i/k_i) = n_i；全部加总 = Σ n_i = 204
    let total = 0
    for (const { n, k } of Object.values(HIDDEN_FRAME)) total += k * (n / k)
    expect(Math.round(total)).toBe(FRAME_HIDDEN_TOTAL)
  })

  test('8. 抽中总条数 = 59 = 金标里 hidden_sampled 的条数', () => {
    let k = 0
    for (const f of Object.values(HIDDEN_FRAME)) k += f.k
    expect(k).toBe(FRAME_HIDDEN_SAMPLED)
  })

  test('9. 声明的 hiddenSampleRate=0.2 与冻结框不符，且这是【正常】的', () => {
    // 每故事 ceil 向上取整 → 真实平均入选概率 59/204 = 28.9%，不是 20%
    const realRate = FRAME_HIDDEN_SAMPLED / FRAME_HIDDEN_TOTAL
    expect(realRate).toBeCloseTo(0.289, 3)
    expect(realRate).not.toBeCloseTo(0.2, 2)
  })
})

describe('抽样权重 · 未知故事的兜底', () => {
  test('10. 不在冻结表里的故事 → 权重 1 + console.error 留证，绝不静默', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(sampleWeight('hidden_sampled', 'S999')).toBe(1)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('不在冻结权重表内'),
      expect.objectContaining({ storyId: 'S999' }),
    )
    spy.mockRestore()
  })
})

