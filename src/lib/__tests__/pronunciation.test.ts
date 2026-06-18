/**
 * @module   pronunciation.test
 * @desc     applyPronunciationFixes 整词替换 — 正常 / 边界（大小写、子串、空、多条）/ 异常（正则元字符）
 * @author   LingoBridge
 * @created  2026-06-18
 */
import { applyPronunciationFixes } from '@/lib/pronunciation'

describe('applyPronunciationFixes', () => {
  it('整词替换听成的词', () => {
    expect(applyPronunciationFixes('He used my drink card', [{ heard: 'drink', intended: 'gym' }]))
      .toBe('He used my gym card')
  })
  it('大小写不敏感', () => {
    expect(applyPronunciationFixes('My Drink is cold', [{ heard: 'drink', intended: 'gym' }]))
      .toBe('My gym is cold')
  })
  it('只替换整词，不动子串（drinks 不变）', () => {
    expect(applyPronunciationFixes('I like drinks and drink', [{ heard: 'drink', intended: 'gym' }]))
      .toBe('I like drinks and gym')
  })
  it('无纠错时原样返回', () => {
    expect(applyPronunciationFixes('nothing changes', [])).toBe('nothing changes')
  })
  it('多条纠错依次应用', () => {
    expect(applyPronunciationFixes('a then b', [
      { heard: 'a', intended: 'x' },
      { heard: 'b', intended: 'y' },
    ])).toBe('x then y')
  })
  it('heard 含正则元字符不报错且不误伤', () => {
    expect(applyPronunciationFixes('say c++ now', [{ heard: 'c++', intended: 'cpp' }]))
      .toBe('say cpp now')
  })
})
