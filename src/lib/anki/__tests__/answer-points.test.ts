/**
 * @module   anki/answer-points.test
 * @desc     分点式卡背点数组纯逻辑单测：generated 解析、编辑覆盖增删/序列化、三层合并优先级、cue 拆分。
 * @author   LingoBridge
 * @created  2026-07-24
 */
import {
  parseGeneratedPoints,
  parseEditOverrides,
  applyEditOverride,
  serializeEditOverrides,
  deriveEffectivePoints,
  splitCueCard,
  type FocusPointLike,
} from '@/lib/anki/answer-points'

describe('parseGeneratedPoints', () => {
  it('解析点数组、只收非空 en，idx 为键', () => {
    const raw = JSON.stringify([
      { idx: 0, en: 'I love it', noMaterial: false },
      { idx: 1, en: null, noMaterial: true },
      { idx: 2, en: '  ', noMaterial: false },
    ])
    const m = parseGeneratedPoints(raw)
    expect(m.get(0)).toBe('I love it')
    expect(m.has(1)).toBe(false) // 留空点不入
    expect(m.has(2)).toBe(false) // 空白 en 不入
  })

  it('null / 非法 JSON / 非数组 / 旧整段文本 → 空 Map（保守回落）', () => {
    expect(parseGeneratedPoints(null).size).toBe(0)
    expect(parseGeneratedPoints('').size).toBe(0)
    expect(parseGeneratedPoints('不是 JSON 的旧整段答案').size).toBe(0)
    expect(parseGeneratedPoints('{"points":[]}').size).toBe(0)
  })
})

describe('编辑覆盖增删 / 序列化', () => {
  it('applyEditOverride：非空置/改、空串清、按 idx 升序', () => {
    let list = applyEditOverride([], 1, 'b')
    list = applyEditOverride(list, 0, 'a')
    expect(list).toEqual([{ idx: 0, en: 'a' }, { idx: 1, en: 'b' }])
    // 改同一 idx
    list = applyEditOverride(list, 0, 'A2')
    expect(list.find((o) => o.idx === 0)?.en).toBe('A2')
    // 空串清除该点
    list = applyEditOverride(list, 0, '   ')
    expect(list.some((o) => o.idx === 0)).toBe(false)
  })

  it('serializeEditOverrides：空数组 → 空串（令 backKind 回落）', () => {
    expect(serializeEditOverrides([])).toBe('')
    expect(serializeEditOverrides([{ idx: 0, en: 'x' }])).toBe('[{"idx":0,"en":"x"}]')
  })

  it('parseEditOverrides：往返一致、非法项跳过', () => {
    expect(parseEditOverrides('[{"idx":2,"en":"y"}]')).toEqual([{ idx: 2, en: 'y' }])
    expect(parseEditOverrides('garbage')).toEqual([])
    expect(parseEditOverrides('[{"idx":"x","en":1}]')).toEqual([])
  })
})

describe('deriveEffectivePoints · 三层优先级', () => {
  const fps: FocusPointLike[] = [
    { title: '立场', desc: 'd0', example: 'demo0' },
    { title: '理由', desc: 'd1' },
    { title: '延伸', desc: 'd2' },
  ]

  it('优先级 edited > generated > example；皆无 → 空点态', () => {
    const generated = JSON.stringify([
      { idx: 0, en: 'gen0', noMaterial: false },
      { idx: 1, en: null, noMaterial: true }, // 生成留空
    ])
    const edited = JSON.stringify([{ idx: 0, en: 'edit0' }])
    const pts = deriveEffectivePoints(fps, generated, edited)
    expect(pts[0]).toMatchObject({ en: 'edit0', noMaterial: false, edited: true }) // edited 盖过 generated
    expect(pts[1]).toMatchObject({ en: null, noMaterial: true, edited: false })    // 生成留空、无 example → 空点
    expect(pts[2].en).toBeNull() // idx2 无 edited/generated/example → 空点态
  })

  it('part3：无 generated、edited 覆盖叠在静态示范 example 上', () => {
    const pts = deriveEffectivePoints(fps, null, JSON.stringify([{ idx: 1, en: 'myEdit' }]))
    expect(pts[0]).toMatchObject({ en: 'demo0', edited: false }) // 回落 example
    expect(pts[1]).toMatchObject({ en: 'myEdit', edited: true })  // 覆盖
    expect(pts[2].en).toBeNull()
  })

  it('点数 = focusPoints 数（脊柱驱动），逐点对齐 idx', () => {
    const pts = deriveEffectivePoints(fps, null, null)
    expect(pts.map((p) => p.idx)).toEqual([0, 1, 2])
    expect(pts.map((p) => p.title)).toEqual(['立场', '理由', '延伸'])
  })
})

describe('splitCueCard', () => {
  it('按 You should say 切引导句 + 提示体（不再拆 bullet）', () => {
    const t = 'Describe your perfect job You should say: What it is Where you heard about it And explain why'
    const { intro, cue } = splitCueCard(t)
    expect(intro).toBe('Describe your perfect job')
    expect(cue).toBe('What it is Where you heard about it And explain why')
  })

  it('无 You should say 标记 → intro 为整题、cue 空', () => {
    const { intro, cue } = splitCueCard('Do you like music?')
    expect(intro).toBe('Do you like music?')
    expect(cue).toBe('')
  })
})
