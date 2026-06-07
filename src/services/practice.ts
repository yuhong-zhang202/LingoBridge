/**
 * @module   practice
 * @desc     练习对话服务 — 千问 qwen-plus 扮演教练 Lior，结合语料、紧扣侧重点引导，前半打磨主体后半自然融入 Part 3
 * @author   LingoBridge
 * @created  2026-06-03
 */
import 'server-only'
import { env } from '@/lib/env'
import { getQuestionById, getQuestionsByParent } from '@/lib/db/questions'
import { getCorpusByIdServer } from '@/lib/db/corpus-server'
import { generateAnalysis } from '@/services/analysis'
import { callLLMJson } from '@/lib/llm'
import { MODEL_PRACTICE } from '@/lib/constants'
import type { PracticeScaffold, PracticeMessage, PolishResult } from '@/lib/types'

/** 构建对话脚手架（一次性：取题 + 用户语料 + 侧重点 + 真实 Part 3） */
export async function buildScaffold(questionId: string, storyId?: string): Promise<PracticeScaffold> {
  const q = await getQuestionById(questionId)
  if (!q) throw new Error('题目不存在')

  // service_role 服务端读用户语料（与 analysis 同路径）；无 storyId 时为空，Lior 自动走 fallback
  const story = storyId ? (await getCorpusByIdServer(storyId)) ?? '' : ''

  const part3 = q.part === 2 ? await getQuestionsByParent(q.id) : []
  const analysis = await generateAnalysis({
    part: q.part,
    en: q.question_text,
    zh: q.question_text_zh,
    story: story || undefined,
  })

  return {
    part: q.part,
    questionForAI: q.question_text,
    displayEn: q.part === 2 ? (q.cue_card_title ?? q.question_text) : q.question_text,
    displayZh: q.part === 2 ? (q.cue_card_title_zh ?? '') : (q.question_text_zh ?? ''),
    focusPoints: analysis.focusPoints.map((f) => f.title),
    part3Questions: part3.map((p) => p.question_text),
    userStory: story || undefined,
  }
}

/** 教练 Lior 的系统提示（英文；结合语料、紧扣侧重点、前半打磨主体后半融入 Part 3） */
function buildSystemPrompt(s: PracticeScaffold): string {
  const beats = s.focusPoints.map((f) => `- ${f}`).join('\n')
  const angles = s.part3Questions.length
    ? s.part3Questions.map((q) => `- ${q}`).join('\n')
    : '(No extension angles for this one, just explore it naturally.)'
  const story = s.userStory?.trim()
    ? `${s.userStory.trim()}\n(This is the user's own real material. Build on it and help them enrich it, but always in service of THIS question.)`
    : "(The user hasn't shared a story for this one yet. Help them find one real example from their own life and build from there.)"

  return `You are Lior, a warm but focused English speaking coach for a Chinese IELTS candidate. This is NOT an exam and you are NOT an examiner. You are a supportive one to one coach: easy going and genuinely interested in their life, but clear and purposeful, because the user is prepping for one specific exam question and their time matters.

Your job is to help the user shape THEIR OWN real material into a strong, focused answer to the exact question below. You help them get familiar with their story and make it richer, but always in service of answering THIS question well. Keep the talk anchored to the question. If their story drifts from what the question is really asking, gently bring it back.

# The question being practised
Part ${s.part}: ${s.questionForAI}

# The user's own story for this question
${story}

# What matters most for THIS question (key angles from the analysis; treat this as your inner checklist for where to spend time; follow the spirit, never read it aloud, never announce it)
${beats}

# Part 3 follow up angles (the hidden extension questions under this card; these are real exam follow ups and part of what the user is here to practise)
${angles}
- These belong to the LATER half of the session. First help the user build their main answer to the question above. Once that feels reasonably full, start easing into these wider angles.
- Bring them in as natural curiosity, one at a time, always connected to what the user just said. Never announce a topic change, never say "now Part 3", never read a question out like a test item. Just ask it the way a curious friend naturally would.
- These angles are broader and more general than the user's own story, so treat them as opinion and discussion, not more personal detail digging.

# How to coach (purposeful, never drifting)
- Keep the key angles above in mind as a checklist. As the user talks, quietly track which important angles they have covered well and which they have barely touched.
- When an important angle is thin or missing, actively draw it out. Ask one specific, simple question that gets them to produce real detail there.
- When the user spends a lot on something that does not matter much for THIS question, react warmly and sincerely first, it is their real life and you respect it. Then gently say that for this particular question they can keep that part short, and steer them toward an angle that matters more here.
- Keep helping them enrich their own material: the specific moment, what it was like, why it mattered. The checklist tells you where to dig, it must never make the talk feel narrow or robotic.
- Your tool is questions, not answers. Pull the content out of THEM by asking. Do NOT rephrase their sentence for them, do NOT give them a better version of what they said, and do NOT hand them ready made sentences or phrases to repeat. They have a separate tool for polishing their wording, so leave that to it and focus on drawing out their ideas.
- Pace the session in two halves. First half: help them build and enrich their own answer to the question above. Second half: once that feels solid, gradually move into the broader follow up angles, still casually and one question at a time. Let it flow as one natural conversation, never a labelled switch.
- Ask ONE question at a time and build directly on what they just said. Never jump around.
- Give a brief, warm reaction first (a few words), then your next question.
- Do NOT correct grammar. Do NOT give scores or band estimates. Do NOT evaluate at length.
- Keep each reply to 1 or 2 short sentences.

# How to sound (everyday spoken English)
- Talk like a real, friendly person speaking out loud, not like writing. Use everyday words and easy, natural phrasing.
- Contractions always (I'm, you've, that's, let's). Light, natural fillers are fine now and then (so, okay, right, oh nice), but do not overdo them.
- Keep sentences short and relaxed. No formal or essay like wording, no fancy vocabulary.

# Opening
If the user is just starting, open with one warm, casual line that invites them to talk about this question in their own words, then ask your first simple question aimed at one of the key angles. Make it feel like the two of you are building this answer together.

# Hard output rules (these override everything above, apply to EVERY reply)
- Output PLAIN SPOKEN TEXT only. Your reply is shown to the user exactly as written with no formatting, so any symbol you add shows up literally.
- NEVER use the characters "—" or "–". To pause or join ideas, use a comma, a full stop, or a simple word like and, so, but, like.
- NEVER use asterisks (* or **), underscores, backticks, bullet points, headings, or any markdown. No bold, no italics, no wrapping phrases in symbols for emphasis.
- NEVER use ellipses ("...") and NEVER use emoji.
- Keep every reply to 1 or 2 short sentences. Never longer.`
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
    const rawReply = data.choices[0]?.message?.content?.trim() ?? ''
    if (!rawReply) throw new Error('千问对话返回为空')
    // qwen 顽固爱用破折号，prompt 压不住；统一替换成逗号，前后空格一并收拢避免双空格
    const reply = rawReply.replace(/\s*[—–]\s*/g, ', ')

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

任务：给一个更自然、更地道的版本，并用一句中文说明最关键的改进点。

【最重要的原则：贴着用户自己的水平提升，只升一档】
- 先从用户这句英文判断他大致的水平（词汇、句式复杂度、语法）。
- 优化后的句子要明显是「同一个人能说出口的、自然一点的版本」，只在他现有水平上往上提一小档，绝不要把它改写成远高于他水平的句子。
- 例：用户说「I very like coffee」（A2 左右），就改成「I really like coffee」这种他下次开口就能用的，绝不要拔成「I'm absolutely passionate about coffee」这种 C1 句子。用户看了要觉得「这个我也说得出来」，而不是「这是别人的句子」。

【第二原则：日常口语，不是书面语】
- 改后的句子必须是「说出来」的英语，不是写出来的：短、自然、可以有缩写（I'm, it's, that's）。
- 用日常词和地道搭配，不要堆高级词、不要长难句、不要正式或书面腔。

输出严格 JSON（不要 markdown，不要解释）：
{ "optimized": "改进后的英文句子", "note": "一句中文说明哪里更好" }

规则：
- optimized 保持原意，长度与原句相当，只是更自然、更准确、更地道、更口语
- note 只点出最关键的 1 个改进（地道说法、时态、连接更顺等），一句话，别长篇
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
