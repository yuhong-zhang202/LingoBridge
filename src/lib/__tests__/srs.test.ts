import { nextBox, nextDue, MAX_BOX } from '@/lib/srs'

describe('srs Leitner', () => {
  test('记住了升一格，封顶 MAX_BOX', () => {
    expect(nextBox(1, true)).toBe(2)
    expect(nextBox(MAX_BOX, true)).toBe(MAX_BOX)
  })
  test('没记住回第 1 格', () => {
    expect(nextBox(3, false)).toBe(1)
  })
  test('盒子越高，下次间隔越长', () => {
    const from = new Date('2026-06-12T00:00:00Z')
    expect(nextDue(5, from).getTime()).toBeGreaterThan(nextDue(1, from).getTime())
  })
})
