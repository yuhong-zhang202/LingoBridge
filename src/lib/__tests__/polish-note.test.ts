/**
 * @module   polish-note.test
 * @desc     parseNote 单测 —— 覆盖两段契约、语法段类型冒号切分、无箭头 raw 兜底、
 *           老格式/空串回退单段（返回 null）。抽公用逻辑后守住三处调用方
 *           （练习页「换个说法」弹窗 + 反馈卡 + 素材库收藏卡）共用的解析行为不回退。
 * @author   LingoBridge
 * @created  2026-07-31
 */
import { parseNote } from '@/lib/polish-note'

describe('parseNote', () => {
  it('解析「语法 + 词组」两段契约', () => {
    const note = ['语法', '时态：I go → I went', '词组', 'very happy → over the moon'].join('\n')
    const sections = parseNote(note)
    expect(sections).not.toBeNull()
    expect(sections).toHaveLength(2)
    expect(sections![0].kind).toBe('grammar')
    expect(sections![0].items[0]).toEqual({ type: '时态', from: 'I go', to: 'I went' })
    expect(sections![1].kind).toBe('phrase')
    expect(sections![1].items[0]).toEqual({ from: 'very happy', to: 'over the moon' })
  })

  it('段头容错：全角/半角冒号 + 长名「词组表达优化」，支持 -> 箭头', () => {
    const note = ['语法：', 'a -> b', '词组表达优化', 'c → d'].join('\n')
    const sections = parseNote(note)
    expect(sections).toHaveLength(2)
    expect(sections![0].items[0]).toEqual({ from: 'a', to: 'b' })
    expect(sections![1].items[0]).toEqual({ from: 'c', to: 'd' })
  })

  it('无箭头行 → raw 整行兜底', () => {
    const note = ['词组', '这一行没有箭头'].join('\n')
    const sections = parseNote(note)
    expect(sections).toHaveLength(1)
    expect(sections![0].items[0]).toEqual({ from: '', to: '', raw: '这一行没有箭头' })
  })

  it('老格式（无任何段头） → 返回 null，宿主回退单段 <p>', () => {
    expect(parseNote('这是一句没有段头的老 note')).toBeNull()
  })

  it('空串 → 返回 null（宿主层另需拦空，避免渲染空 <p>）', () => {
    expect(parseNote('')).toBeNull()
  })

  it('只有段头、无有效条目 → 返回 null', () => {
    expect(parseNote(['语法', '词组'].join('\n'))).toBeNull()
  })
})
