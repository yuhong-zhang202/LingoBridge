/**
 * @module   restructure
 * @desc     把口语化的原始语料整理成通顺的中文短文（服务端调千问，仅去口语化、保留原意细节）
 * @author   LingoBridge
 * @created  2026-06-02
 */
import 'server-only'
import { env } from '@/lib/env'
import { callLLMJson } from '@/lib/llm'
import { MODEL_RESTRUCTURE } from '@/lib/constants'

const SYSTEM_PROMPT = `你是一个中文文本整理助手。用户会给你一段口语化的、可能来自语音转写的中文叙述。
你的任务：去掉口头禅、语气词、重复和明显的转写错误，让它读起来通顺、像一段书面短文。
但必须严格保留原意和所有具体细节（人名、地点、时间、事件、情绪、数字等）。
不要总结、不要发挥、不要增删事实、不要改变人称和叙述视角。

同时判断 usable 字段：
- usable=true：内容包含可展开的个人经历、观点、感受或具体事件
- usable=false：明显跑题或测试性质（背课文、念诗、报数、"测试测试"等），或极度空泛无任何可展开个人信息的单句寒暄（如仅"今天天气不错"）
- 重要：有真实个人经历但内容简单（如"我妈做的红烧肉很好吃"）必须判 usable=true。单薄不等于无意义，拿不准时一律判 true。

只输出如下 JSON，不要 markdown 代码块，不要任何前后缀文字：
{"usable": true或false, "cleanedText": "整理后的中文短文"}

【JSON 格式硬约束】
你只能输出合法 JSON，前后不得有任何说明文字或 markdown 代码块（不要 \`\`\`json）。
字符串值内部禁止出现英文双引号 " ——如需引用或强调，一律改用中文引号「」。
  错误示例："tip":"别只说"I was scared""   ← 裸双引号会破坏 JSON
  正确示例："tip":"别只说「I was scared」"`

export async function restructureText(rawText: string): Promise<{ cleanedText: string; usable: boolean }> {
  if (!env.dashscopeApiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .env.local 中设置')
  }
  return callLLMJson<{ cleanedText: string; usable: boolean }>({
    label: '[Restructure]',
    call: {
      provider: 'dashscope',
      endpoint: `${env.dashscopeBaseUrl}/chat/completions`,
      apiKey: env.dashscopeApiKey,
      model: MODEL_RESTRUCTURE,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: rawText },
      ],
      temperature: 0.3,
    },
    validate: (v): v is { cleanedText: string; usable: boolean } =>
      typeof v === 'object' && v !== null &&
      typeof (v as { cleanedText?: unknown }).cleanedText === 'string' &&
      typeof (v as { usable?: unknown }).usable === 'boolean',
    fallback: (raw, jsonText) => ({ cleanedText: (jsonText || raw).trim(), usable: true }),
  })
}
