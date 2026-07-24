/**
 * @module   ai/anki-answer.test
 * @desc     分点式卡背生成器单测：生成器契约（mock callAnkiLLMJson 不真调 DashScope）——传对 SYSTEM /
 *           maxTokens / temperature，按 idx 升序对齐、清洗破折号、留空点 en=null 原样保留、回填 usage、
 *           validate 守卫接受合法点数组 / 拒非法；以及【同源漂移守卫】——读探针 example-probe.mjs 原文
 *           抽出其 SYSTEM_STORIED，断言与生产 ANKI_ANSWER_SYSTEM 逐字相等（改一处漏改另一处即红）。
 * @author   LingoBridge
 * @created  2026-07-23
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/env-server', () => ({
  env: { dashscopeApiKey: 'test-key', dashscopeBaseUrl: 'https://example.invalid/v1' },
}))
jest.mock('@/lib/ai/anki-json', () => ({ callAnkiLLMJson: jest.fn() }))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { callAnkiLLMJson } from '@/lib/ai/anki-json'
import {
  generateAnkiAnswer,
  cleanEn,
  ANKI_MAX_TOKENS,
  ANKI_TEMPERATURE,
  type AnkiAnswerPoint,
  type AnkiAnswerInput,
} from '@/lib/ai/anki-answer'
import { ANKI_ANSWER_SYSTEM } from '@/lib/ai/anki-answer-prompt'

/** 被生成器传给 callAnkiLLMJson 的 opts 里，本测关心的形状。 */
interface CapturedOpts {
  call: {
    model: string
    temperature?: number
    maxTokens?: number
    messages: { role: string; content: string }[]
  }
  onUsage?: (u: { promptTokens: number; completionTokens: number }) => void
  validate: (v: unknown) => boolean
}

const mockCall = callAnkiLLMJson as unknown as jest.Mock

const baseInput: AnkiAnswerInput = {
  part: 2,
  questionText: 'Describe a place you like to go to relax.',
  focusPoints: [
    { title: '交代背景', desc: '是什么地方、多久去一次' },
    { title: '讲清重点', desc: '凭什么能让你放松' },
    { title: '补得更完整', desc: '和别处的不同' },
  ],
  corpus: '我喜欢去家附近的小公园，每天傍晚去走走。',
}

/** 让 mock 返回给定 points，并可选地触发 onUsage；返回捕获到的 opts 供断言。 */
function armMock(points: AnkiAnswerPoint[], usage?: { promptTokens: number; completionTokens: number }): () => CapturedOpts | null {
  let captured: CapturedOpts | null = null
  mockCall.mockImplementation((opts: CapturedOpts) => {
    captured = opts
    if (usage) opts.onUsage?.(usage)
    return Promise.resolve({ points })
  })
  return () => captured
}

beforeEach(() => {
  mockCall.mockReset()
})

describe('generateAnkiAnswer（mock callAnkiLLMJson，不真调 DashScope）', () => {
  it('传对 SYSTEM / maxTokens / temperature / model', async () => {
    const getOpts = armMock([{ idx: 0, en: 'ok one', noMaterial: false }])
    await generateAnkiAnswer(baseInput)
    const opts = getOpts()!
    expect(opts.call.messages[0]).toEqual({ role: 'system', content: ANKI_ANSWER_SYSTEM })
    expect(opts.call.messages[1].role).toBe('user')
    expect(opts.call.messages[1].content).toContain('Describe a place you like to go to relax.')
    // user 里侧重点按 0-based 呈现，与 SYSTEM 输出契约一致
    expect(opts.call.messages[1].content).toContain('0. 交代背景')
    expect(opts.call.maxTokens).toBe(ANKI_MAX_TOKENS[2])
    expect(opts.call.temperature).toBe(ANKI_TEMPERATURE)
  })

  it('part1 用短 maxTokens', async () => {
    const getOpts = armMock([{ idx: 0, en: 'hi there friend', noMaterial: false }])
    await generateAnkiAnswer({ ...baseInput, part: 1 })
    expect(getOpts()!.call.maxTokens).toBe(ANKI_MAX_TOKENS[1])
    expect(ANKI_MAX_TOKENS[1]).toBeLessThan(ANKI_MAX_TOKENS[2])
  })

  it('按 idx 升序对齐、清洗破折号、留空点 en=null 原样保留', async () => {
    armMock([
      { idx: 2, en: null, noMaterial: true },
      { idx: 0, en: 'I go to a small park — near my place.', noMaterial: false },
      { idx: 1, en: 'It just helps me unwind.', noMaterial: false },
    ])
    const out = await generateAnkiAnswer(baseInput)
    expect(out.map((p) => p.idx)).toEqual([0, 1, 2])
    // 破折号被替换成逗号，无残留 em/en dash
    expect(out[0].en).toBe('I go to a small park, near my place.')
    expect(out[0].noMaterial).toBe(false)
    // 留空点：en 保持 null、noMaterial true
    expect(out[2].en).toBeNull()
    expect(out[2].noMaterial).toBe(true)
  })

  it('回填模型真实 usage', async () => {
    armMock([{ idx: 0, en: 'a fine short line', noMaterial: false }], { promptTokens: 120, completionTokens: 30 })
    let reported: { promptTokens: number; completionTokens: number } | null = null
    await generateAnkiAnswer(baseInput, (u) => { reported = u })
    expect(reported).toEqual({ promptTokens: 120, completionTokens: 30 })
  })

  it('validate 守卫：接受形状合法的点数组，拒形状非法', async () => {
    // baseInput 有 3 个 focusPoints → expectedCount=3；下面合法用例都给满 3 点覆盖 idx 0/1/2。
    const getOpts = armMock([{ idx: 0, en: 'ok', noMaterial: false }])
    await generateAnkiAnswer(baseInput)
    const { validate } = getOpts()!
    const full = [
      { idx: 0, en: 'hi', noMaterial: false },
      { idx: 1, en: null, noMaterial: true },
      { idx: 2, en: 'there', noMaterial: false },
    ]
    expect(validate({ points: full })).toBe(true)
    expect(validate({ points: [{ idx: 0, en: 'hi' }, { idx: 1, en: 'a', noMaterial: false }, { idx: 2, en: 'b', noMaterial: false }] })).toBe(false) // 缺 noMaterial
    expect(validate({ points: [{ idx: '0', en: 'hi', noMaterial: false }, { idx: 1, en: 'a', noMaterial: false }, { idx: 2, en: 'b', noMaterial: false }] })).toBe(false) // idx 非数字
    expect(validate({ points: [{ idx: 0, en: 5, noMaterial: false }, { idx: 1, en: 'a', noMaterial: false }, { idx: 2, en: 'b', noMaterial: false }] })).toBe(false) // en 非字符串/非 null
    expect(validate({})).toBe(false)                                          // 无 points
    expect(validate(null)).toBe(false)
  })

  it('validate 守卫（洞2）：点数组必须恰好覆盖 0..expectedCount-1 每个 idx，缺/多/重/越界皆拒', async () => {
    // baseInput = part2 / 3 个 focusPoints → expectedCount=3。
    const getOpts = armMock([{ idx: 0, en: 'ok', noMaterial: false }])
    await generateAnkiAnswer(baseInput)
    const { validate } = getOpts()!
    const pt = (idx: number) => ({ idx, en: 'x', noMaterial: false })
    expect(validate({ points: [pt(0), pt(1), pt(2)] })).toBe(true)   // 恰好全覆盖
    expect(validate({ points: [pt(0), pt(1)] })).toBe(false)         // 少一点（模型静默漏吐）
    expect(validate({ points: [] })).toBe(false)                     // 整条缺席
    expect(validate({ points: [pt(0), pt(1), pt(1)] })).toBe(false)  // idx 重复（漏了 2、重了 1）
    expect(validate({ points: [pt(0), pt(1), pt(2), pt(3)] })).toBe(false) // 多一点/越界
    expect(validate({ points: [pt(0), pt(1), pt(3)] })).toBe(false)  // idx 越界（3 超出 0..2）
  })

  it('validate 守卫（洞2）：part1 expectedCount=2', async () => {
    const getOpts = armMock([{ idx: 0, en: 'hi there friend', noMaterial: false }])
    await generateAnkiAnswer({ ...baseInput, part: 1, focusPoints: baseInput.focusPoints.slice(0, 2) })
    const { validate } = getOpts()!
    const pt = (idx: number) => ({ idx, en: 'x', noMaterial: false })
    expect(validate({ points: [pt(0), pt(1)] })).toBe(true)
    expect(validate({ points: [pt(0)] })).toBe(false)               // 少一点
    expect(validate({ points: [pt(0), pt(1), pt(2)] })).toBe(false) // 多一点
  })
})

describe('cleanEn（导出·唯一真相源，part3 例句 pregen 复用同一函数）', () => {
  it('破折号（em/en dash）替换成逗号并 trim；无破折号则仅 trim', () => {
    expect(cleanEn('I go to a park — near my place.')).toBe('I go to a park, near my place.')
    expect(cleanEn('before – after')).toBe('before, after')
    expect(cleanEn('  plain text  ')).toBe('plain text')
    expect(cleanEn('a — b – c')).toBe('a, b, c')
  })
})

describe('同源漂移守卫：生产 SYSTEM 与探针 example-probe.mjs 逐字一致', () => {
  it('ANKI_ANSWER_SYSTEM === example-probe.mjs 的 SYSTEM_STORIED 常量', () => {
    const mjs = readFileSync(join(process.cwd(), 'scripts/anki-probe/example-probe.mjs'), 'utf8')
    // 抽出 `const SYSTEM_STORIED = \`...\`` 的模板字面量正文（到紧接着的 part3 注释前）。
    const start = mjs.indexOf('const SYSTEM_STORIED = `')
    expect(start).toBeGreaterThanOrEqual(0)
    const bodyStart = start + 'const SYSTEM_STORIED = `'.length
    const end = mjs.indexOf('`\n\n// ── part3', bodyStart)
    expect(end).toBeGreaterThan(bodyStart)
    const probeSystem = mjs.slice(bodyStart, end)
    expect(ANKI_ANSWER_SYSTEM).toBe(probeSystem)
  })
})
