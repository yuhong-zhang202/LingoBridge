/**
 * @module   pronounce
 * @desc     发音正音服务 — 给「想说的词 / 被听成的词」生成音标 + 怎么念提示（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-11
 */
import 'server-only'
import { env } from '@/lib/env'
import { callLLMJson } from '@/lib/llm'
import { MODEL_PRONOUNCE } from '@/lib/constants'
import type { PronunciationTip } from '@/lib/types'

const PRONOUNCE_SYSTEM = `你是英语发音教练，面向中国雅思考生。用户会给你两个英文词：他真正想说的词(intended)、以及被语音识别听成的词(heard)，可能附上出处句。
你的任务：给出两个词的音标，并写一段「怎么念」的发音提示，帮他把 intended 念准、不再被听成 heard。

音标用国际音标(IPA)，美式发音，带斜杠，例如 /bæd/。

发音提示要求：
- 必须具体、能照着做。别只说抽象的「双唇闭合」之类，要给一个可操作的自检或练法（如送气音让他「手放嘴前感受气流」、元音让他「对着镜子看嘴张多大」）。
- 点出 intended 和 heard 在发音上的关键区别：差在哪个音、口型/舌位/送气/清浊/长短，以及重音落在哪。
- 用大白话中文，简洁，2 到 3 句，不要堆术语。

只输出合法 JSON，不要 markdown、不要任何解释或代码块（不要 \`\`\`json）。
字符串值内部禁止出现英文双引号 "，需要引用一律用中文引号「」。
格式：
{ "ipaIntended": "/.../", "ipaHeard": "/.../", "tip": "一段中文发音提示" }`

/** 给一对「想说/被听成」的词生成音标 + 怎么念提示 */
export async function generatePronunciationTip(
  intended: string,
  heard: string,
  context?: string,
): Promise<PronunciationTip> {
  if (!env.dashscopeApiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .env.local 中设置')
  }
  const userMsg = `(想说的词:) ${intended}\n(被听成的词:) ${heard}\n${context ? `(出处句:) ${context}\n` : ''}`
  return callLLMJson<PronunciationTip>({
    label: '[Pronounce]',
    call: {
      provider: 'dashscope',
      endpoint: `${env.dashscopeBaseUrl}/chat/completions`,
      apiKey: env.dashscopeApiKey,
      model: MODEL_PRONOUNCE,
      messages: [
        { role: 'system', content: PRONOUNCE_SYSTEM },
        { role: 'user', content: userMsg },
      ],
    },
    validate: (v): v is PronunciationTip =>
      typeof v === 'object' && v !== null &&
      typeof (v as { ipaIntended?: unknown }).ipaIntended === 'string' &&
      typeof (v as { ipaHeard?: unknown }).ipaHeard === 'string' &&
      typeof (v as { tip?: unknown }).tip === 'string',
  })
}
