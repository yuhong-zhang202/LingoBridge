/**
 * @module   analysis.test
 * @desc     generateAnalysisStreaming 的单元测试：mock streamDashScopeText 吐分块，断言
 *           onSection 段序正确、最终返回 === 对同一全文缓冲解析的结果（权威返回走同口径最终校验）、
 *           usage 透传、畸形全文一律 throw。LLM 调用全部 mock，不发真实请求。
 * @author   LingoBridge
 * @created  2026-08-01
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

import { generateAnalysisStreaming } from '@/services/analysis'
import { streamDashScopeText, type StreamDashScopeConfig, type LLMUsage } from '@/lib/llm'
import type { AnalysisStreamSection } from '@/lib/analysis-stream-parse'

const mockStreamText = streamDashScopeText as jest.MockedFunction<typeof streamDashScopeText>

/** 让被 mock 的 streamDashScopeText 吐出给定分块，并在收尾调用 onUsage（若给） */
function driveStream(chunks: string[], usage?: LLMUsage): void {
  mockStreamText.mockImplementation((cfg: StreamDashScopeConfig) => {
    async function* gen(): AsyncGenerator<string, void, unknown> {
      for (const c of chunks) yield c
      if (usage) cfg.onUsage?.(usage)
    }
    return gen()
  })
}

const INPUT = { part: 2 as const, en: 'Describe a time you helped someone.', zh: '描述你帮助别人的一次经历。' }

const SAMPLE = {
  structureLabel: '交代背景 · 讲清重点 · 补得更完整',
  focusPoints: [
    { title: '交代背景', desc: '一句话带过时间、谁、什么事。' },
    { title: '讲清重点', desc: '把你怎么帮的那段讲到位。' },
    { title: '补得更完整', desc: '补上对方和你的感受。' },
  ],
  phrases: [
    { group: '经过', items: [{ text: 'gave them a hand', meaning: '搭把手', scene: '帮忙时' }] },
    { group: '感受', items: [{ text: 'felt good about it', meaning: '感觉挺好', scene: '做了好事后' }] },
  ],
}

/** 把整段 JSON 硬切成若干块 */
function fixedChunks(s: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
  return out
}

describe('generateAnalysisStreaming', () => {
  beforeEach(() => {
    mockStreamText.mockReset()
  })

  test('段序正确：structureLabel → focusPoint×3 → phraseGroup×2', async () => {
    const full = JSON.stringify(SAMPLE)
    driveStream(fixedChunks(full, 9))
    const sections: AnalysisStreamSection[] = []
    await generateAnalysisStreaming(INPUT, (s) => sections.push(s))
    expect(sections.map((s) => s.kind)).toEqual([
      'structureLabel', 'focusPoint', 'focusPoint', 'focusPoint', 'phraseGroup', 'phraseGroup',
    ])
    expect(sections.filter((s) => s.kind === 'focusPoint').map((s) => s.value)).toEqual(SAMPLE.focusPoints)
    expect(sections.filter((s) => s.kind === 'phraseGroup').map((s) => s.value)).toEqual(SAMPLE.phrases)
  })

  test('权威返回 === 对同一全文缓冲解析的结果（与 buffered 字节一致）', async () => {
    const full = JSON.stringify(SAMPLE)
    driveStream(fixedChunks(full, 5))
    const result = await generateAnalysisStreaming(INPUT)
    // buffered 口径：extractJson（花括号切片）+ JSON.parse
    const bufferedExpected = JSON.parse(full)
    expect(result).toEqual(bufferedExpected)
  })

  test('前后有围栏/废话时，权威返回仍走花括号切片，与 buffered 一致', async () => {
    const full = '```json\n' + JSON.stringify(SAMPLE) + '\n```'
    driveStream(fixedChunks(full, 11))
    const result = await generateAnalysisStreaming(INPUT)
    expect(result).toEqual(SAMPLE)
  })

  test('usage 透传：从流的 usage 帧取，触发 onUsage 一次', async () => {
    const full = JSON.stringify(SAMPLE)
    driveStream([full], { promptTokens: 123, completionTokens: 456 })
    const onUsage = jest.fn()
    await generateAnalysisStreaming(INPUT, undefined, onUsage)
    expect(onUsage).toHaveBeenCalledTimes(1)
    expect(onUsage).toHaveBeenCalledWith({ promptTokens: 123, completionTokens: 456 })
  })

  test('畸形全文（非法 JSON）→ throw', async () => {
    driveStream(['{ this is not ', 'valid json at all '])
    await expect(generateAnalysisStreaming(INPUT)).rejects.toThrow()
  })

  test('结构不符（focusPoints 缺失）→ throw（validate 失败）', async () => {
    driveStream([JSON.stringify({ structureLabel: 'x', phrases: [] })])
    await expect(generateAnalysisStreaming(INPUT)).rejects.toThrow()
  })
})
