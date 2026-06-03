/**
 * @module   restructure
 * @desc     把口语化的原始语料整理成通顺的中文短文（服务端调千问，仅去口语化、保留原意细节）
 * @author   LingoBridge
 * @created  2026-06-02
 */
import 'server-only'
import { env } from '@/lib/env'

// 便宜快，足够做去口语化；若质量不够再换成 'qwen-plus'
const RESTRUCTURE_MODEL = 'qwen-flash'

const SYSTEM_PROMPT = `你是一个中文文本整理助手。用户会给你一段口语化的、可能来自语音转写的中文叙述。
你的任务：去掉口头禅、语气词、重复和明显的转写错误，让它读起来通顺、像一段书面短文。
但必须严格保留原意和所有具体细节（人名、地点、时间、事件、情绪、数字等）。
不要总结、不要发挥、不要增删事实、不要改变人称和叙述视角。
直接输出整理后的中文短文，不要任何解释、前言或标注。`

/**
 * 整理一段语料
 * @param rawText  原始（口语化）文字
 * @returns        整理后的通顺中文短文
 */
export async function restructureText(rawText: string): Promise<string> {
  if (!env.dashscopeApiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .env.local 中设置')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000) // ENGINEERING.md：AI 调用 30s 超时
  const startedAt = Date.now()

  try {
    const res = await fetch(`${env.dashscopeBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.dashscopeApiKey}`,
      },
      body: JSON.stringify({
        model: RESTRUCTURE_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: rawText },
        ],
        temperature: 0.3,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text()
      throw new Error(`千问整理失败（${res.status}）：${detail}`)
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[]
      usage?: { prompt_tokens: number; completion_tokens: number }
    }
    const cleaned = data.choices[0]?.message?.content?.trim()
    if (!cleaned) throw new Error('千问整理返回为空')

    // ENGINEERING.md §6：AI 调用记录耗时与 token 用量
    console.log('[Restructure] done', {
      ms: Date.now() - startedAt,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
    })

    return cleaned
  } finally {
    clearTimeout(timeout)
  }
}
