/**
 * @module   restructure
 * @desc     把口语化的原始语料整理成通顺的中文短文（服务端调千问，仅去口语化、保留原意细节）
 * @author   LingoBridge
 * @created  2026-06-02
 */
import 'server-only'
import { env } from '@/lib/env-server'
import { callLLMJson, type LLMUsage } from '@/lib/llm'
import { MODEL_RESTRUCTURE } from '@/lib/constants'

const SYSTEM_PROMPT = `你是一个中文文本整理助手。用户会给你一段口语化的、可能来自语音转写的中文叙述。
你的任务：去掉口头禅、语气词、重复和明显的转写错误，让它读起来通顺、像一段书面短文。
但必须严格保留原意和所有具体细节（人名、地点、时间、事件、情绪、数字等）。
不要总结、不要发挥、不要增删事实、不要改变人称和叙述视角。

同时判断 usable 字段：
- usable=true：内容包含可展开的个人经历、观点、感受或具体事件
- usable=false：明显跑题或测试性质（背课文、念诗、报数、"测试测试"等），或极度空泛无任何可展开个人信息的单句寒暄（如仅"今天天气不错"）
- 重要：有真实个人经历但内容简单（如"我妈做的红烧肉很好吃"）必须判 usable=true。单薄不等于无意义，拿不准时一律判 true。

同时产出 summary 字段（一句话概括）：
- 用一句话说清「这条语料讲的啥」，供用户日后一眼认出是哪段经历。
- 不超过 20 个汉字，只留核心的「跟谁/什么事」，不要形容词堆砌、不要标点结尾、不要以「这段话/作者/我」开头。
- 示例：叙述"上周和室友因为宿舍谁打扫吵了一架、后来我主动道歉" → summary 填"跟室友因宿舍卫生分工道歉"。
- summary 只概括、不改动 cleanedText，两者独立产出，不要因为要写 summary 而删减 cleanedText 的细节。
- usable=false 时 summary 可留空字符串。

只输出如下 JSON，不要 markdown 代码块，不要任何前后缀文字：
{"usable": true或false, "cleanedText": "整理后的中文短文", "summary": "一句话概括"}

【JSON 格式硬约束】
你只能输出合法 JSON，前后不得有任何说明文字或 markdown 代码块（不要 \`\`\`json）。
字符串值内部禁止出现英文双引号 " ——如需引用或强调，一律改用中文引号「」。
  错误示例："tip":"别只说"I was scared""   ← 裸双引号会破坏 JSON
  正确示例："tip":"别只说「I was scared」"`

/**
 * 整理一段口语原文为通顺短文，并顺手产出 usable 判定与一句话概括 summary。
 * @param  rawText  用户原始（可能来自语音转写的）中文叙述
 * @param  onUsage  LLM token 用量回调（供计费），在返回前同步触发
 * @returns         { cleanedText, usable, summary }；summary 缺失/非字符串时回退空串（不阻断链路，由前端按空降级）
 * @sideEffect      调用第三方 LLM（dashscope qwen-flash）
 */
export async function restructureText(
  rawText: string,
  onUsage?: (usage: LLMUsage) => void,
): Promise<{ cleanedText: string; usable: boolean; summary: string }> {
  if (!env.dashscopeApiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .env.local 中设置')
  }
  return callLLMJson<{ cleanedText: string; usable: boolean; summary: string }>({
    label: '[Restructure]',
    onUsage,
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
    // summary 非硬约束：模型漏给或给了非字符串时归一化为空串，绝不因缺 summary 判整段无效
    // （usable/cleanedText 仍是主契约）。空串在前端按「无概括」降级、整行不渲染。
    validate: (v): v is { cleanedText: string; usable: boolean; summary: string } => {
      if (typeof v !== 'object' || v === null) return false
      const o = v as { cleanedText?: unknown; usable?: unknown; summary?: unknown }
      if (typeof o.cleanedText !== 'string' || typeof o.usable !== 'boolean') return false
      if (o.summary === undefined) o.summary = ''
      return typeof o.summary === 'string'
    },
    fallback: (raw, jsonText) => ({ cleanedText: (jsonText || raw).trim(), usable: true, summary: '' }),
  })
}
