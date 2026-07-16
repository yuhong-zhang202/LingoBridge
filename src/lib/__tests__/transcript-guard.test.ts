/**
 * @module   transcript-guard.test
 * @desc     checkTranscriptUsable 单元测试（ENGINEERING.md §8）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { checkTranscriptUsable } from '../transcript-guard'

describe('checkTranscriptUsable', () => {
  it('正常文本 → usable: true', () => {
    expect(checkTranscriptUsable('我今天去超市买了一些菜')).toEqual({ usable: true })
  })

  it('空字符串 → usable: false, reason: empty', () => {
    expect(checkTranscriptUsable('')).toEqual({ usable: false, reason: 'empty' })
  })

  it('纯空白 → usable: false, reason: empty', () => {
    expect(checkTranscriptUsable('   ')).toEqual({ usable: false, reason: 'empty' })
  })

  it('纯标点与空格 → usable: false, reason: too_short', () => {
    expect(checkTranscriptUsable('。。。 ，，')).toEqual({ usable: false, reason: 'too_short' })
  })

  it('2 个有效字符（极短）→ usable: false, reason: too_short', () => {
    expect(checkTranscriptUsable('好的')).toEqual({ usable: false, reason: 'too_short' })
  })

  it('3 个有效字符（边界值）→ usable: true', () => {
    expect(checkTranscriptUsable('好的啊')).toEqual({ usable: true })
  })

  it('命中注入的临时黑名单 → usable: false, reason: blacklist', () => {
    expect(checkTranscriptUsable('测试测试', ['测试测试'])).toEqual({
      usable: false,
      reason: 'blacklist',
    })
  })

  it('未命中黑名单的正常文本 → usable: true', () => {
    expect(checkTranscriptUsable('我喜欢吃苹果', ['测试测试'])).toEqual({ usable: true })
  })
})
