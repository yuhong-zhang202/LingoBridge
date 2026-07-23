/**
 * @module   ai/part3-example-prompt.test
 * @desc     part3 例句 prompt 的【同源漂移守卫】：读探针 example-probe.mjs 原文抽出其 SYSTEM_PART3 常量，
 *           断言与生产 PART3_EXAMPLE_SYSTEM 逐字相等（改一处漏改另一处即红）；以及 user 模板结构基本一致。
 * @author   LingoBridge
 * @created  2026-07-24
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PART3_EXAMPLE_SYSTEM, part3ExampleUserPrompt } from '@/lib/ai/part3-example-prompt'

describe('同源漂移守卫：生产 part3 例句 SYSTEM 与探针 example-probe.mjs 逐字一致', () => {
  it('PART3_EXAMPLE_SYSTEM === example-probe.mjs 的 SYSTEM_PART3 常量', () => {
    const mjs = readFileSync(join(process.cwd(), 'scripts/anki-probe/example-probe.mjs'), 'utf8')
    // 抽出 `const SYSTEM_PART3 = \`...\`` 的模板字面量正文（到紧接着的 userStoried 注释前）。
    const start = mjs.indexOf('const SYSTEM_PART3 = `')
    expect(start).toBeGreaterThanOrEqual(0)
    const bodyStart = start + 'const SYSTEM_PART3 = `'.length
    const end = mjs.indexOf('`\n\n// ⚠️ userStoried', bodyStart)
    expect(end).toBeGreaterThan(bodyStart)
    const probeSystem = mjs.slice(bodyStart, end)
    expect(PART3_EXAMPLE_SYSTEM).toBe(probeSystem)
  })
})

describe('part3ExampleUserPrompt 结构', () => {
  it('含题面 + 0-based 论点列表', () => {
    const out = part3ExampleUserPrompt('Do you think people apologize enough?', [
      { title: '表明立场', desc: '先给出你的观点' },
      { title: '讲清理由', desc: '用一个理由支撑' },
    ])
    expect(out).toContain('Do you think people apologize enough?')
    expect(out).toContain('0. 表明立场')
    expect(out).toContain('1. 讲清理由')
  })
})
