/**
 * @module   phrase-chunk.test
 * @desc     chunkSentence 切块规则 + shuffleChunks 打乱行为的单元测试
 * @author   LingoBridge
 * @created  2026-07-01
 */
import { chunkSentence, shuffleChunks } from '@/lib/phrase-chunk'

describe('chunkSentence', () => {
  test('正常路径：含助动词/介词/冠词的中等句子按规则合并', () => {
    // have(助动词)+been、for(介词)+a(冠词) 各并成一块
    expect(chunkSentence('I have been looking for a new job')).toEqual([
      'I', 'have been', 'looking', 'for a', 'new', 'job',
    ])
  })

  test('正常路径：冠词/介词领起的块与后一词合并', () => {
    expect(chunkSentence('the cat sat on the mat')).toEqual([
      'the cat', 'sat', 'on the', 'mat',
    ])
  })

  test('边界：合并后不足 3 块 → 退回未合并切分', () => {
    // in+the、单独 house → 只有 2 块，退回按空格切分
    expect(chunkSentence('in the house')).toEqual(['in', 'the', 'house'])
  })

  test('边界：只有一个词', () => {
    expect(chunkSentence('Hello')).toEqual(['Hello'])
  })

  test('边界：结尾带标点，标点跟随前词不单独成块', () => {
    expect(chunkSentence('I love it.')).toEqual(['I', 'love', 'it.'])
  })

  test('边界：独立标点 token 并入前一词', () => {
    expect(chunkSentence('well done , everyone')).toEqual(['well', 'done,', 'everyone'])
  })

  test('边界：空串 / 纯空白 → 空数组', () => {
    expect(chunkSentence('')).toEqual([])
    expect(chunkSentence('   ')).toEqual([])
  })
})

describe('shuffleChunks', () => {
  test('多块时打乱结果与原顺序不同，且元素集合不变', () => {
    const original = ['a', 'b', 'c', 'd', 'e']
    const shuffled = shuffleChunks(original)
    expect(shuffled).not.toEqual(original)
    expect([...shuffled].sort()).toEqual([...original].sort())
  })

  test('不改变入参数组', () => {
    const original = ['one', 'two', 'three', 'four']
    const copy = [...original]
    shuffleChunks(original)
    expect(original).toEqual(copy)
  })

  test('只有 1 个块时原样返回（新数组）', () => {
    const original = ['only']
    const result = shuffleChunks(original)
    expect(result).toEqual(['only'])
    expect(result).not.toBe(original)
  })

  test('空数组返回空数组', () => {
    expect(shuffleChunks([])).toEqual([])
  })
})
