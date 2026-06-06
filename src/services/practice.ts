/**
 * @module   practice
 * @desc     练习对话服务 — 千问 qwen-plus 当对话教练，顺侧重点引导、自然融入 Part 3
 * @author   LingoBridge
 * @created  2026-06-03
 */
import 'server-only'
import { env } from '@/lib/env'
import { getQuestionById, getQuestionsByParent } from '@/lib/db/questions'
import { generateAnalysis } from '@/services/analysis'
import { callLLMJson } from '@/lib/llm'
import { MODEL_PRACTICE } from '@/lib/constants'
import type { PracticeScaffold, PracticeMessage, PolishResult } from '@/lib/types'

/** 构建对话脚手架（一次性：取题 + 侧重点 + 真实 Part 3） */
export async function buildScaffold(questionId: string): Promise<PracticeScaffold> {
  const q = await getQuestionById(questionId)
  if (!q) throw new Error('题目不存在')

  const part3 = q.part === 2 ? await getQuestionsByParent(q.id) : []
  const analysis = await generateAnalysis({ part: q.part, en: q.question_text, zh: q.question_text_zh })

  return {
    part: q.part,
    questionForAI: q.question_text,
    displayEn: q.part === 2 ? (q.cue_card_title ?? q.question_text) : q.question_text,
    displayZh: q.part === 2 ? (q.cue_card_title_zh ?? '') : (q.question_text_zh ?? ''),
    focusPoints: analysis.focusPoints.map((f) => f.title),
    part3Questions: part3.map((p) => p.question_text),
  }
}

/** 教练系统提示（英文，强化英文输出 + 教练人设） */
function buildSystemPrompt(s: PracticeScaffold): string {
  const beats = s.focusPoints.map((f) => `- ${f}`).join('\n')
  const angles = s.part3Questions.length
    ? s.part3Questions.map((q) => `- ${q}`).join('\n')
    : '(No extension angles for this question — just explore it naturally.)'

  return `You are a warm, curious English conversation coach helping a Chinese IELTS candidate practise speaking. This is NOT an exam and you are NOT an examiner — you are a friendly conversation partner. Keep it low-pressure, encouraging and natural.

# The question being practised
Part ${s.part}: ${s.questionForAI}

# Discussion beats (a soft scaffold — follow the spirit, NEVER recite them, NEVER announce them)
${beats}

# Angles you may weave in naturally (these come from real follow-up questions; blend them into natural follow-ups — NEVER say "now Part 3" or announce a topic switch)
${angles}

# How to talk
- Speak ENGLISH only, with a friendly, casual, spoken tone (short natural sentences, not written/formal language).
- Ask ONE question at a time. Build directly on what the user just said; don't jump around.
- When the user answers, give a brief warm acknowledgement (a few words) then continue — no long evaluations.
- Do NOT correct grammar and do NOT give scores or band estimates.
- Keep every reply to 1–2 short sentences.
- Gently help the user flesh out their material for this question, loosely following the beats.

# Opening
If this is the start (the user just says they want to begin), open with one warm line and naturally invite them to start talking about this question.`
}

/** 生成教练的下一句回复 */
export async function coachReply(
  scaffold: PracticeScaffold,
  messages: PracticeMessage[],
): Promise<string> {
  if (!env.dashscopeApiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .env.local 中设置')
  }

  // 前置 seed user 消息，确保对话序列以 user 起手（千问同 Claude 要求首条非系统消息为 user）
  const seed = { role: 'user' as const, content: "Hi, I'd like to practise this question. Could you start us off?" }
  const apiMessages = [
    { role: 'system' as const, content: buildSystemPrompt(scaffold) },
    seed,
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ]

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  const startedAt = Date.now()

  try {
    const res = await fetch(`${env.dashscopeBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.dashscopeApiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_PRACTICE,
        max_tokens: 256,
        messages: apiMessages,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text()
      throw new Error(`千问对话失败（${res.status}）：${detail}`)
    }

    const data = (await res.json()) as {
      choices: { message?: { content?: string } }[]
      usage?: { prompt_tokens: number; completion_tokens: number }
    }
    const reply = data.choices[0]?.message?.content?.trim() ?? ''
    if (!reply) throw new Error('千问对话返回为空')

    console.log('[Practice] reply', {
      ms: Date.now() - startedAt,
      turns: messages.length,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
    })
    return reply
  } finally {
    clearTimeout(timeout)
  }
}

const POLISH_SYSTEM = `你是英语口语表达优化助手。用户在练习雅思口语，会给你一句他刚说的英文（可能来自语音转写、可能有小错或不够地道）。
任务：给一个更自然、更地道的版本（适合雅思 6-7 分水平，别太花哨、别太长，长度与原句相当），并用一句中文说明最关键的改进点。

输出严格 JSON（不要 markdown，不要解释）：
{ "optimized": "改进后的英文句子", "note": "一句中文说明哪里更好" }

规则：
- optimized 保持原意，只是更自然/更准确/更地道；不要堆砌高级词
- note 只点出最关键的 1 个改进（地道搭配、时态、连接更顺等），一句话，别长篇
- 若原句已不错，optimized 只做小润色，note 说明它已不错 + 微调点

【JSON 格式硬约束】
你只能输出合法 JSON，前后不得有任何说明文字或 markdown 代码块（不要 \`\`\`json）。
字符串值内部禁止出现英文双引号 " ——如需引用或强调，一律改用中文引号「」。
  错误示例："tip":"别只说"I was scared""   ← 裸双引号会破坏 JSON
  正确示例："tip":"别只说「I was scared」"`

/**
 * 对用户刚说的一句英文做地道度优化
 * @param sentence    用户原句（可能来自语音转写）
 * @param aiQuestion  上下文：教练刚问的问题（可选）
 * @returns           优化后的句子 + 一句中文改进说明
 */
export async function polishSentence(sentence: string, aiQuestion?: string): Promise<PolishResult> {
  if (!env.dashscopeApiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .env.local 中设置')
  }
  const userMsg = `${aiQuestion ? `(教练问的:) ${aiQuestion}\n` : ''}(我说的:) ${sentence}`
  return callLLMJson<PolishResult>({
    label: '[Polish]',
    call: {
      provider: 'dashscope',
      endpoint: `${env.dashscopeBaseUrl}/chat/completions`,
      apiKey: env.dashscopeApiKey,
      model: MODEL_PRACTICE,
      messages: [
        { role: 'system', content: POLISH_SYSTEM },
        { role: 'user', content: userMsg },
      ],
    },
    validate: (v): v is PolishResult =>
      typeof v === 'object' && v !== null &&
      typeof (v as { optimized?: unknown }).optimized === 'string' &&
      (v as { optimized: string }).optimized.length > 0,
  })
}
