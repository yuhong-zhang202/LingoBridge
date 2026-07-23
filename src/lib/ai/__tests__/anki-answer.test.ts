/**
 * @module   ai/anki-answer.test
 * @desc     卡背生成器单测：档位切点（bandToTier）、分析文本序列化、生成器契约（注入桩不真调 DashScope），
 *           以及【同源漂移守卫】——读探针 generate.mjs 原文抽出其 SYSTEM，断言与生产 ANKI_ANSWER_SYSTEM
 *           逐字相等。改一处漏改另一处，这条测试即红（不靠人记得，对齐同源硬约束）。
 * @author   LingoBridge
 * @created  2026-07-23
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/env-server', () => ({
  env: { dashscopeApiKey: 'test-key', dashscopeBaseUrl: 'https://example.invalid/v1' },
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  bandToTier,
  TIER_SPLIT,
  formatAnalysisText,
  generateAnkiAnswer,
  ANKI_MAX_TOKENS,
  type AnkiChatTransport,
} from '@/lib/ai/anki-answer'
import { ANKI_ANSWER_SYSTEM, ANKI_TIERS } from '@/lib/ai/anki-answer-prompt'

describe('bandToTier / TIER_SPLIT', () => {
  it('T ≤ 6.0 → A，T ≥ 6.5 → B（切点在两线之间）', () => {
    expect(bandToTier(5.0)).toBe('A')
    expect(bandToTier(6.0)).toBe('A')
    expect(bandToTier(6.5)).toBe('B')
    expect(bandToTier(7.5)).toBe('B')
  })
  it('切点是唯一常量 6.25，边界严格小于走 A', () => {
    expect(TIER_SPLIT).toBe(6.25)
    expect(bandToTier(TIER_SPLIT - 0.01)).toBe('A')
    expect(bandToTier(TIER_SPLIT)).toBe('B')
  })
})

describe('formatAnalysisText', () => {
  it('拼出「英文题面 → 答题结构 → 侧重点编号列表」', () => {
    const text = formatAnalysisText('Do you go to bed early?', {
      structureLabel: '先给习惯 · 再点细节',
      focusPoints: [
        { title: '怎么起手', desc: '开门见山说早睡还是晚睡' },
        { title: '收在哪', desc: '挑一个真实小细节' },
      ],
    })
    expect(text).toContain('英文题面：Do you go to bed early?')
    expect(text).toContain('答题结构：先给习惯 · 再点细节')
    expect(text).toContain('1) 怎么起手：开门见山说早睡还是晚睡')
    expect(text).toContain('2) 收在哪：挑一个真实小细节')
  })
})

describe('generateAnkiAnswer（注入桩，不真调 DashScope）', () => {
  it('传对 SYSTEM / 档位标签 / maxTokens，回填 usage，清洗破折号', async () => {
    let seen: { system: string; user: string; maxTokens: number } | null = null
    const transport: AnkiChatTransport = async (p) => {
      seen = p
      return { text: 'I usually go to bed late — I feel sharp at night.', usage: { promptTokens: 100, completionTokens: 40 } }
    }
    let reportedUsage: { promptTokens: number; completionTokens: number } | null = null
    const out = await generateAnkiAnswer(
      { part: 2, analysis: 'A', corpus: 'C', tier: 'B' },
      (u) => { reportedUsage = u },
      transport,
    )
    expect(seen).not.toBeNull()
    expect(seen!.system).toBe(ANKI_ANSWER_SYSTEM)
    expect(seen!.maxTokens).toBe(ANKI_MAX_TOKENS[2])
    expect(seen!.user).toContain(`目标难度档：${ANKI_TIERS.B}`)
    // 破折号被替换成逗号，无残留 em/en dash
    expect(out).not.toMatch(/[—–]/)
    expect(out).toContain('late, I feel sharp')
    expect(reportedUsage).toEqual({ promptTokens: 100, completionTokens: 40 })
  })

  it('part1 用短 maxTokens', async () => {
    let maxTokens = 0
    const transport: AnkiChatTransport = async (p) => { maxTokens = p.maxTokens; return { text: 'ok', usage: null } }
    await generateAnkiAnswer({ part: 1, analysis: 'A', corpus: 'C', tier: 'A' }, undefined, transport)
    expect(maxTokens).toBe(ANKI_MAX_TOKENS[1])
    expect(ANKI_MAX_TOKENS[1]).toBeLessThan(ANKI_MAX_TOKENS[2])
  })

  it('模型没吐 usage 时不触发 onUsage 回调', async () => {
    const transport: AnkiChatTransport = async () => ({ text: 'ok', usage: null })
    const onUsage = jest.fn()
    await generateAnkiAnswer({ part: 1, analysis: 'A', corpus: 'C', tier: 'A' }, onUsage, transport)
    expect(onUsage).not.toHaveBeenCalled()
  })

  it('返回为空抛错', async () => {
    const transport: AnkiChatTransport = async () => ({ text: '', usage: null })
    await expect(
      generateAnkiAnswer({ part: 1, analysis: 'A', corpus: 'C', tier: 'A' }, undefined, transport),
    ).rejects.toThrow('返回为空')
  })
})

describe('同源漂移守卫：生产 SYSTEM 与探针 generate.mjs 逐字一致', () => {
  it('ANKI_ANSWER_SYSTEM === generate.mjs 的 SYSTEM 常量', () => {
    const mjs = readFileSync(join(process.cwd(), 'scripts/anki-probe/generate.mjs'), 'utf8')
    // 抽出 `const SYSTEM = \`...\`` 的模板字面量正文（到紧接着的 `\n\nconst userPrompt` 前）。
    const start = mjs.indexOf('const SYSTEM = `')
    expect(start).toBeGreaterThanOrEqual(0)
    const bodyStart = start + 'const SYSTEM = `'.length
    const end = mjs.indexOf('`\n\nconst userPrompt', bodyStart)
    expect(end).toBeGreaterThan(bodyStart)
    const probeSystem = mjs.slice(bodyStart, end)
    expect(ANKI_ANSWER_SYSTEM).toBe(probeSystem)
  })
})
