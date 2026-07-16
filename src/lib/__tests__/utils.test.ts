/**
 * @module   utils.test
 * @desc     纯工具函数 isGarbageInput / formatRelativeTime 快测
 * @author   LingoBridge
 * @created  2026-06-17
 */
import { isGarbageInput, formatRelativeTime } from '@/lib/utils'

describe('isGarbageInput', () => {
  test('空串 / 纯空白 → true', () => {
    expect(isGarbageInput('')).toBe(true)
    expect(isGarbageInput('   ')).toBe(true)
    expect(isGarbageInput('\n\t  ')).toBe(true)
  })
  test('整段 URL → true', () => {
    expect(isGarbageInput('https://example.com/foo/bar')).toBe(true)
    expect(isGarbageInput('http://a.b')).toBe(true)
  })
  test('极短（trim 后 < 5）→ true', () => {
    expect(isGarbageInput('ab')).toBe(true)
    expect(isGarbageInput('1234')).toBe(true)
    expect(isGarbageInput('   x  ')).toBe(true)
  })
  test('正常中文小故事 → false', () => {
    expect(isGarbageInput('上周末我去公园散步，待了很久就放松下来了。')).toBe(false)
  })
  test('边界：刚好 5 字符 → false（放行交 LLM）', () => {
    expect(isGarbageInput('12345')).toBe(false)
  })
})

describe('formatRelativeTime', () => {
  const NOW = new Date('2026-06-17T12:00:00Z').getTime()
  beforeAll(() => { jest.useFakeTimers().setSystemTime(NOW) })
  afterAll(() => { jest.useRealTimers() })

  test('< 1 分钟 → 刚刚', () => {
    expect(formatRelativeTime(new Date(NOW - 30_000).toISOString())).toBe('刚刚')
  })
  test('分钟 / 小时 / 昨天 / 天 / 月 / 年 各档', () => {
    expect(formatRelativeTime(new Date(NOW - 5 * 60_000).toISOString())).toBe('5 分钟前')
    expect(formatRelativeTime(new Date(NOW - 3 * 3600_000).toISOString())).toBe('3 小时前')
    expect(formatRelativeTime(new Date(NOW - 25 * 3600_000).toISOString())).toBe('昨天')
    expect(formatRelativeTime(new Date(NOW - 5 * 86_400_000).toISOString())).toBe('5 天前')
    expect(formatRelativeTime(new Date(NOW - 60 * 86_400_000).toISOString())).toBe('2 个月前')
    expect(formatRelativeTime(new Date(NOW - 400 * 86_400_000).toISOString())).toBe('1 年前')
  })
})
