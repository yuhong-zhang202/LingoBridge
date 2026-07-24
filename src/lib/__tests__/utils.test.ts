/**
 * @module   utils.test
 * @desc     纯工具函数 isGarbageInput / countEffectiveCorpusChars / isTooShortForCorpus / formatRelativeTime 快测
 * @author   LingoBridge
 * @created  2026-06-17
 */
import {
  isGarbageInput,
  countEffectiveCorpusChars,
  isTooShortForCorpus,
  formatRelativeTime,
} from '@/lib/utils'
import { MIN_CORPUS_CHARS } from '@/lib/constants'

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

describe('countEffectiveCorpusChars', () => {
  test('剔标点 / 空格 / 换行，只数汉字 + 英文单词字符', () => {
    expect(countEffectiveCorpusChars('')).toBe(0)
    expect(countEffectiveCorpusChars('，。！？ \n\t  ')).toBe(0)      // 纯标点空白 → 0
    expect(countEffectiveCorpusChars('我去公园了')).toBe(5)          // 5 个汉字
    expect(countEffectiveCorpusChars('a b, c! d')).toBe(4)           // 4 个字母，标点空格不计
    expect(countEffectiveCorpusChars('去了 park 玩')).toBe(3 + 4)     // 汉字 3 + 英文 4
    expect(countEffectiveCorpusChars('123')).toBe(3)                 // 数字计入
  })
  test('伪长文本（大量标点空格灌水）有效字符不虚高', () => {
    const padded = '我去公园了' + '，'.repeat(200) + ' '.repeat(200)
    expect(countEffectiveCorpusChars(padded)).toBe(5)               // 仍只 5，长度门槛防不住、有效字符防得住
  })
})

describe('isTooShortForCorpus', () => {
  test(`有效字符 < ${MIN_CORPUS_CHARS} → true`, () => {
    expect(isTooShortForCorpus('')).toBe(true)
    expect(isTooShortForCorpus('我去公园散步很开心')).toBe(true)     // 远不足 40
    expect(isTooShortForCorpus('经历'.repeat(19) + '经')).toBe(true) // 恰 39 有效字符
  })
  test(`有效字符 ≥ ${MIN_CORPUS_CHARS} → false`, () => {
    expect(isTooShortForCorpus('经历'.repeat(20))).toBe(false)       // 恰 40 有效字符（边界放行）
    expect(isTooShortForCorpus('字'.repeat(60))).toBe(false)
  })
  test('伪长文本（标点空格灌水）仍判太少', () => {
    const padded = '我去公园散步' + '。'.repeat(500)
    expect(isTooShortForCorpus(padded)).toBe(true)
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
