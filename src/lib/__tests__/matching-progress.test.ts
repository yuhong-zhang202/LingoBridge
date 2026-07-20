/**
 * @module   matching-progress.test
 * @desc     匹配等待进度的纯函数单测 —— 守住两条产品约束：
 *           1) 进度条【永远不到 100%】（走满了还在转 = 明着告诉用户这个数字是编的）；
 *           2) 分阶段文案的切换时点与产品方定稿一致（0–5s / 5–10s / 10s+）。
 *           这两条靠手工验要干等好几分钟，必须由测试钉死。
 * @author   LingoBridge
 * @created  2026-07-20
 */
import { progressPct, stageText } from '@/lib/matching-progress'

describe('progressPct · 进度永不到顶', () => {
  test('单调递增，且在任何时刻都 < 100', () => {
    let prev = -1
    // 一路跑到 10 分钟：远超最坏情况（重排两轮全超时约 72s）
    for (let ms = 0; ms <= 600_000; ms += 500) {
      const p = progressPct(ms)
      expect(p).toBeGreaterThanOrEqual(prev)
      expect(p).toBeLessThan(100)
      prev = p
    }
  })

  test('20 秒基准处走到 85%，之后放慢但继续推进（不停死、也不到顶）', () => {
    expect(progressPct(0)).toBe(0)
    expect(progressPct(10_000)).toBeCloseTo(42.5, 5)
    expect(progressPct(20_000)).toBeCloseTo(85, 5)
    // 超过基准后仍在动——「卡住不动」和「走满不停」一样伤信任
    expect(progressPct(40_000)).toBeGreaterThan(progressPct(20_000))
    expect(progressPct(40_000)).toBeLessThan(99)
  })
})

describe('stageText · 分阶段文案（措辞为产品方定稿，改动需产品方确认）', () => {
  test('按 0–5s / 5–10s / 10s+ 三档切换', () => {
    expect(stageText(0)).toBe('正在读你的故事…')
    expect(stageText(4_999)).toBe('正在读你的故事…')
    expect(stageText(5_000)).toBe('已找到你的表达特质，正在筛选题目…')
    expect(stageText(9_999)).toBe('已找到你的表达特质，正在筛选题目…')
    expect(stageText(10_000)).toBe('正在逐题评估贴合度…')
    expect(stageText(120_000)).toBe('正在逐题评估贴合度…')
  })
})
