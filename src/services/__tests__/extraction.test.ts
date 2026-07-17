/**
 * @module   extraction.test
 * @desc     extractCorpus 的 taxonomy 白名单校验测试 —— 模型自创 pointCode（如 EMO_99）必须被
 *           拦下并重试，重试仍非法则抛错，绝不放行到下游去捏造维度。同时锁死白名单本身
 *           （49 个 code，从 SYSTEM_PROMPT 解析）不因 prompt 改版而悄悄漂移。LLM 调用全部 mock。
 * @author   LingoBridge
 * @created  2026-07-16
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/env-server', () => ({
  env: {
    dashscopeApiKey: 'test-key',
    dashscopeBaseUrl: 'https://example.invalid/v1',
    rawLogEnabled: false,
  },
}))
jest.mock('@/lib/llm')

import { extractCorpus, TAXONOMY_CODES } from '@/services/extraction'
import { callLLMJson, type CallLLMJsonOptions } from '@/lib/llm'

const mockCall = callLLMJson as jest.MockedFunction<typeof callLLMJson>

const STORY = '一有压力我就开始整理房间，越焦虑收拾得越狠。'

/**
 * 用若干份「模型原始输出」驱动被 mock 的 callLLMJson，复刻其真实契约：
 * 逐份 parse → validate；全都不过且无 fallback（extraction 正是如此）则抛错。
 * @param raws  依次为首发、重试的模型输出
 */
function driveWith(raws: unknown[]): { retryInstruction: () => string | undefined } {
  let instruction: string | undefined
  mockCall.mockImplementation(async (opts: CallLLMJsonOptions<unknown>) => {
    instruction = opts.retryInstruction
    for (const raw of raws) {
      if (opts.validate(raw)) return raw
    }
    if (opts.fallback) return opts.fallback('', '')
    throw new Error('[Extraction] JSON 解析失败（已重试）')
  })
  return { retryInstruction: () => instruction }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  jest.restoreAllMocks()
})

describe('TAXONOMY_CODES · 白名单本身', () => {
  test('1. 恰好 49 个 code，且从 SYSTEM_PROMPT 现场解析（prompt 改格式会立刻报警）', () => {
    expect(TAXONOMY_CODES.size).toBe(49)
  })

  test('2. 六个维度的代表 code 都在', () => {
    for (const c of ['EMO_01', 'EMO_13', 'REL_12', 'SPA_08', 'SPI_06', 'GRO_07', 'VAL_03']) {
      expect(TAXONOMY_CODES.has(c)).toBe(true)
    }
  })

  test('3. 不收正文里「归 VAL_01」这类行内提及带来的噪音，也不含自创 code', () => {
    for (const c of ['EMO_99', 'ZZZ_42', 'VAL_04', 'EMO_14', 'SPA_09']) {
      expect(TAXONOMY_CODES.has(c)).toBe(false)
    }
  })
})

describe('extractCorpus · 非法 pointCode 必须被拦', () => {
  test('4. primary 自创 code：validate 拒收 → 重试；重试合法则正常返回', async () => {
    const bad = { primary: { pointCode: 'EMO_99', reason: '编的' }, secondary: null }
    const good = { primary: { pointCode: 'EMO_07', reason: '压力应对模式' }, secondary: null }
    driveWith([bad, good])

    await expect(extractCorpus(STORY)).resolves.toEqual(good)
    expect(console.error).toHaveBeenCalledWith(
      '[Extraction] primary 观察点非法（不在 49 个 taxonomy code 内）',
      { got: 'EMO_99' },
    )
  })

  test('5. 重试仍自创：抛错，绝不返回非法 code（不静默、不捏造维度）', async () => {
    const bad = { primary: { pointCode: 'EMO_99', reason: '编的' }, secondary: null }
    driveWith([bad])

    await expect(extractCorpus(STORY)).rejects.toThrow('[Extraction] JSON 解析失败（已重试）')
  })

  test('6. secondary 自创 code 同样被拦（漏掉它等于留半扇门）', async () => {
    const bad = {
      primary:   { pointCode: 'EMO_07', reason: 'ok' },
      secondary: { pointCode: 'SPA_99', reason: '编的' },
    }
    driveWith([bad])

    await expect(extractCorpus(STORY)).rejects.toThrow()
    expect(console.error).toHaveBeenCalledWith(
      '[Extraction] secondary 观察点非法（不在 49 个 taxonomy code 内）',
      { got: 'SPA_99' },
    )
  })

  test('7. 大小写/空格变体不放行（EMO_07 才算，emo_07 不算）', async () => {
    driveWith([{ primary: { pointCode: 'emo_07', reason: 'x' }, secondary: null }])
    await expect(extractCorpus(STORY)).rejects.toThrow()

    driveWith([{ primary: { pointCode: ' EMO_07', reason: 'x' }, secondary: null }])
    await expect(extractCorpus(STORY)).rejects.toThrow()
  })

  test('8. 退回模型的整改要求同时覆盖「自创 code」与「JSON 坏了」两类因', async () => {
    const probe = driveWith([{ primary: { pointCode: 'EMO_07', reason: 'ok' }, secondary: null }])
    await extractCorpus(STORY)

    const ins = probe.retryInstruction()
    expect(ins).toContain('49 个观察点 code')
    expect(ins).toContain('英文双引号')  // 原 JSON 纠错指引未被削弱
  })
})

describe('extractCorpus · 合法路径不受影响', () => {
  test('9. 合法 primary + 合法 secondary：原样返回，无 error', async () => {
    const good = {
      primary:   { pointCode: 'VAL_01', reason: '被不公平对待' },
      secondary: { pointCode: 'REL_11', reason: '摊牌冲突' },
    }
    driveWith([good])

    await expect(extractCorpus(STORY)).resolves.toEqual(good)
    expect(console.error).not.toHaveBeenCalled()
  })

  test('10. secondary 为 null：合法（大量故事只有主维度）', async () => {
    const good = { primary: { pointCode: 'EMO_03', reason: '独处' }, secondary: null }
    driveWith([good])
    await expect(extractCorpus(STORY)).resolves.toEqual(good)
  })

  test('11. secondary 键缺失：视同 null 放行，不为少个键浪费一次重试', async () => {
    const good = { primary: { pointCode: 'EMO_03', reason: '独处' } }
    driveWith([good])
    await expect(extractCorpus(STORY)).resolves.toEqual(good)
    expect(console.error).not.toHaveBeenCalled()
  })

  test('12. 全部 49 个合法 code 都能通过校验（白名单没有误杀）', async () => {
    for (const code of TAXONOMY_CODES) {
      driveWith([{ primary: { pointCode: code, reason: 'r' }, secondary: null }])
      await expect(extractCorpus(STORY)).resolves.toMatchObject({ primary: { pointCode: code } })
    }
  })
})
