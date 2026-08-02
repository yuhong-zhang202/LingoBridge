/**
 * @module   practice
 * @desc     练习对话服务 — 千问 qwen-plus 扮演教练 Lior，结合语料、紧扣侧重点引导，前半打磨主体，后半按题库真实 Part 3 追问（无真实 Part 3 则不硬造、只把主答收尾）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import 'server-only'
import { env } from '@/lib/env-server'
import { getQuestionById, getQuestionsByParent } from '@/lib/db/questions'
import { getCorpusByIdServer } from '@/lib/db/corpus-server'
import { generateAnalysis } from '@/services/analysis'
import { callLLMJson, type LLMUsage } from '@/lib/llm'
import { MODEL_PRACTICE } from '@/lib/constants'
import type { PracticeScaffold, PracticeMessage, PolishResult } from '@/lib/types'

/**
 * 构建对话脚手架（一次性：取题 + 用户语料 + 侧重点 + 真实 Part 3）。
 * ⚠️ 内部会额外发一次 generateAnalysis 的 AI 调用——这条调用此前在 practice route 完全漏记账。
 * @param onAnalysisUsage  内部 generateAnalysis 的真实 token 用量回调（供 route 单独记这条调用的账）
 */
export async function buildScaffold(
  questionId: string,
  storyId?: string,
  level = '6.0',
  onAnalysisUsage?: (usage: LLMUsage) => void,
): Promise<PracticeScaffold> {
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
  }, onAnalysisUsage)

  return {
    part: q.part,
    questionForAI: q.question_text,
    displayEn: q.part === 2 ? (q.cue_card_title ?? q.question_text) : q.question_text,
    displayZh: q.part === 2 ? (q.cue_card_title_zh ?? '') : (q.question_text_zh ?? ''),
    focusPoints: analysis.focusPoints.map((f) => `${f.title}（${f.desc}）`),
    part3Questions: part3.map((p) => p.question_text),
    userStory: story || undefined,
    level,
  }
}

/** 教练 Lior 的系统提示（英文；结合语料、紧扣侧重点、前半打磨主体，后半按题库真实 Part 3 追问，无真实 Part 3 则不硬造、只收尾主答） */
function buildSystemPrompt(s: PracticeScaffold): string {
  const beats = s.focusPoints.map((f) => `- ${f}`).join('\n')
  const angles = s.part3Questions.length
    ? s.part3Questions.map((q) => `- ${q}`).join('\n')
    : "(This card has no real Part 3 follow ups. Do NOT invent your own. Just help the user finish a solid main answer to the Part 2 question above and wrap up there.)"
  const story = s.userStory?.trim()
    ? `${s.userStory.trim()}\n(This is the user's own real material. Build on it and help them enrich it, but always in service of THIS question.)`
    : "(The user hasn't shared a story for this one yet. Help them find one real example from their own life and build from there.)"

  return `You are Lior, a warm but focused English speaking coach for a Chinese IELTS candidate. This is NOT an exam and you are NOT an examiner. You are a supportive one to one coach: easy going and genuinely interested in their life, but clear and purposeful, because the user is prepping for one specific exam question and their time matters. You are here to guide, not to judge: no scores, no grammar corrections. Run the session with the rhythm of a real IELTS Part 2 and Part 3: let the user hold the floor on the cue card and speak a full stretch of their own first, then ease into the Part 3 discussion questions. Stay focused and keep them on track, but never nitpick, and still never hand them ready made sentences or phrases to repeat.

Your job is to help the user shape THEIR OWN real material into a strong, focused answer to the exact question below. You help them get familiar with their story and make it richer, but always in service of answering THIS question well. Keep the talk anchored to the question. If their story drifts from what the question is really asking, gently bring it back.

# The question being practised
Part ${s.part}: ${s.questionForAI}

# The user's own story for this question
${story}

# The skeleton of a good answer to THIS question (these points come straight from the analysis the user just saw, in order; they are the SKELETON the user is here to describe their own material along; each point may carry a note in brackets telling you how much it matters, e.g. a quick one-line mention vs a part to really open up; treat this as your inner guide, never read it aloud, never announce it)
${beats}

# Part 3 follow up angles (the hidden extension questions under this card; these are real exam follow ups and part of what the user is here to practise)
${angles}
- These belong to the LATER half of the session. First help the user build their main answer to the question above. Once that feels reasonably full, start easing into these wider angles.
- These are the REAL Part 3 follow ups for this exact card. Ask THESE questions, one at a time. Do NOT swap them for topics you invent yourself.
- You do NOT need to use all of them. Pick the 3 to 4 that connect most naturally to what the user has been saying, and move through them the way an examiner moves a candidate along in Part 3.
- You may soften the opening of a question to follow on from what the user just said, and you should not announce a topic change or say "now Part 3", but keep the QUESTION itself whole and intact, never water it down into vague small talk.
- These angles are broader and more general than the user's own story, so treat them as opinion and discussion, not more personal detail digging.

# How to coach (use the skeleton above, but stay natural)
- Treat the points above as a checklist of the few things a strong answer to this question needs to cover, NOT a list of items to interrogate one by one.
- After your opening, give the user room. Let them answer this the way they would in a real Part 2, talking it out as a fuller stretch, a proper long turn, before you step in. Do not interrupt after every sentence.
- Once they have had a real run at it, look at the checklist and follow up on only the most important one or two things that genuinely matter for this answer AND that they have not covered yet. One warm, specific question is enough. Do not chase small details the answer does not need.
- Honor each point's weight (the note in brackets): a point marked as a quick, light mention is not worth a follow up if they have already touched it, while a point meant to be opened up (like the key turning point or how they felt) is the kind worth one good question if it is still thin.
- As the user talks, quietly keep track of which of these few things are covered and which key one, if any, is still missing.
- The skeleton tells you where to go, it must never make the talk feel narrow or robotic. Keep it feeling like a real, warm, flowing conversation.
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

# Match the user's level (IELTS ${s.level})
- The user is aiming for around IELTS band ${s.level}. Tune the DIFFICULTY of what you ask to fit that level, but ALWAYS speak natural, correct, fluent English yourself. You are a coach modelling good English, so never switch to broken or oversimplified English, and never copy a learner's mistakes.
- What changes with level is how hard your questions are, not the quality of your own English:
  - Around 5.0 to 5.5: ask very simple, short questions, one small idea at a time, with the most common everyday words. Be extra patient, and always give them something that is easy to answer so they never get stuck for words. Keep the language plain (what, where, when, who, or a simple this-or-that choice), but do NOT drill into tiny specifics the answer does not need. At this level do NOT ask abstract or open ended introspective questions (nothing like "what does that feel like in your body", "why does it matter to you", or "how would you describe that feeling"), and never put two or more questions in one turn. If the user seems lost or says they do not understand, immediately drop to an even simpler, easier question.
  - Around 6.0 to 6.5: natural everyday questions and follow ups, ordinary vocabulary, a comfortable pace.
  - Around 7.0 to 7.5: you can probe a bit more, ask more nuanced follow ups, and use slightly richer everyday vocabulary.
  - Around 8.0 and up: engage more freely, including more abstract or nuanced angles, while staying spoken and natural.
- This only adjusts your questions and word choice. All the coaching rules above still apply exactly: still one short question at a time, still warm, still drawing content out of them, still no rephrasing their sentences for them.

# Opening
If the user is just starting, open with one warm, casual line that invites them to talk about this question in their own words, then ask your first simple question aimed at the FIRST point of the skeleton above (for example, if the first point is about the background, open by asking when it was, who was involved, or what happened). Make it feel like the two of you are building this answer together.

# Hard output rules (these override everything above, apply to EVERY reply)
- Output PLAIN SPOKEN TEXT only. Your reply is shown to the user exactly as written with no formatting, so any symbol you add shows up literally.
- NEVER use the characters "—" or "–". To pause or join ideas, use a comma, a full stop, or a simple word like and, so, but, like.
- NEVER use asterisks (* or **), underscores, backticks, bullet points, headings, or any markdown. No bold, no italics, no wrapping phrases in symbols for emphasis.
- NEVER use ellipses ("...") and NEVER use emoji.
- Keep every reply to 1 or 2 short sentences. Never longer.`
}

/**
 * 生成教练的下一句回复
 * @param onUsage  拿到模型真实 token 用量的回调（coachReply 走裸 fetch，此前解析出 usage 却没上抛）
 */
export async function coachReply(
  scaffold: PracticeScaffold,
  messages: PracticeMessage[],
  onUsage?: (usage: LLMUsage) => void,
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

  // 教练回复兜底超时：90s（原 30s 曾把偶发慢回复直接切断）。实测 p95≈5s、189 次仅 1 次触 30s，
  // 90s 只作极端卡死的保命闸、正常永不触发，避免"想得慢一点就被掐断、用户白等还失败"。
  // Zeabur 容器无 serverless 函数时限，客户端 apiFetch 亦无更短超时，故此值即实际上限。
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90_000)

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
    // 真实用量上抛（此前解析出来却丢弃了，route 只能靠写死常量估算）
    const u = data.usage
    if (u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number') {
      onUsage?.({ promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens })
    }
    // qwen 顽固爱用破折号，prompt 压不住；统一替换成逗号，前后空格一并收拢避免双空格
    const reply = rawReply.replace(/\s*[—–]\s*/g, ', ')
    return reply
  } finally {
    clearTimeout(timeout)
  }
}

const POLISH_SYSTEM = `你是英语口语表达优化助手。用户在练习雅思口语，会给你一句他刚说的英文（可能来自语音转写、可能有小错或不够地道）。

【第一步：先判断这句到底需不需要优化】
不是每句都要改。如果这句话本身已经能自然、得体地回答当时的问题，且没有明显语法错误、也没有值得一提的更地道说法，就【不要硬改】——尤其是很简短但已经够用的句子（比如别人问时间、问 yes/no，用户一句简单的话就答到位了），这种硬塞个 yeah、改个语气词毫无意义。这时返回 needsWork=false，不给改写句。
只有当这句【确实有可改之处】（有语法或用词错误、明显中式表达、或有明显更地道自然的说法）时，才返回 needsWork=true 并给优化版。

【needsWork=true 时怎么改：按用户目标水平提升，升约半档】
- 用户消息里会给出他的目标雅思水平（如 6.0）。把这句优化到比这个目标【高约半档】（6.0 就奔 6.5、5.0 就奔 5.5），是一个「踮脚够得着」的版本，不是遥不可及的跳级。
- 做法：先把原句的错误改对、让它通顺自然，再在用词上往上提一点点。目标水平越低越要克制，尤其 5.0~5.5 这一档只用最常见的日常词，绝不要塞入这个水平的人根本说不出口的地道动词短语或习语（如 zone out、flop down、kick back 之类）——那会立刻变成「别人的句子」。这类更地道的说法最多在 note 里点一句让他认识。
- 例（低档·目标 5.0）：用户说「I just think into so far, and maybe I will made a cup of tea」，改成「I'm not sure. I usually just relax for a bit, and then I make myself a cup of tea」就够了（把不通的地方改对、简单自然）；不要改成带 zone out 的版本。
- 例（中档·目标 6.0）：用户说「I very like coffee」，改成「I really enjoy a good coffee」这种自然、地道、6.5 左右的口语；绝不要拔成「I'm absolutely passionate about coffee」这种刻意的高级句。
- 一句话标准：用户看了要觉得「这个我踮踮脚也能说」，而不是「这是别人的句子」。

【日常口语，不是书面语】
- 改后的句子必须是「说出来」的英语，不是写出来的：短、自然、可以有缩写（I'm, it's, that's）。用日常词和地道搭配，不要堆高级词、不要长难句、不要正式或书面腔。

输出严格 JSON（不要 markdown、不要解释）：
- 需要优化：{ "needsWork": true, "optimized": "改进后的英文句子", "note": "按下方【note 契约格式】组织的中文说明" }
- 无需优化：{ "needsWork": false, "optimized": "", "note": "" }

规则：
- 三个字段每次都要给全；needsWork=false 时 optimized 和 note 一律留空字符串，不要在 note 里写解释。
- needsWork=true 时 optimized 保持原意、长度与原句相当，只是更自然、更准确、更地道、更口语。

【note 契约格式 —— 务必照此结构输出】
⚠️ 大前提（比格式更重要）：没有语法错误就别编一个出来；这句本就够好（回到第一步的判断），就返回 needsWork=false，【绝不为了填满下面两段而硬找茬】。下面两段都是【可选】的，有内容才写、有几条写几条，一条都没有就不该走到这里。
note 是【单个字符串】，内部用换行把内容组织成两段（不要 markdown、不要圆点/序号，圆点由前端添加）。JSON 里换行写成 \\n。两段结构：
- 语法段：先单独一行短标记「语法」，其后每行一条，格式 \`类型：原片段 → 改法\`。类型是 2-4 字中文类别（时态 / 单复数 / 主谓一致 / 冠词 / 介词 / 搭配 …）；【同一类的多处错误合并成一行】（如 \`单复数：a few day/week → a few days/weeks\`），一类只占一行。没有语法错误就【整段都不写】。
- 词组段：先单独一行短标记「词组」，其后每行一条，格式 \`原片段 → 改法\`（无类型前缀），一个表达一行。没有值得一提的更地道说法就【整段都不写】。
两段都无内容 → 本就该 needsWork=false。
- 箭头一律用真箭头字符 →（U+2192），不要用 -> 或破折号。
- 只写【真实发生】的改动：原片段=用户原句里真实说过的词、改法=optimized 里真实出现的词；某个词在 optimized 里没变，就绝不写「X → X」这种没改动的空账。
- 示例（用户原句有单复数错、且 make a decision 更地道）：note = 语法\\n单复数：a few day → a few days\\n词组\\ndo a decision → make a decision

【JSON 格式硬约束】
你只能输出合法 JSON，前后不得有任何说明文字或 markdown 代码块（不要 \`\`\`json）。
字符串值内部禁止出现英文双引号 " ——如需引用或强调，一律改用中文引号「」。
  错误示例："note":"别只说"I was scared""   ← 裸双引号会破坏 JSON
  正确示例："note":"别只说「I was scared」"`

/**
 * 对用户刚说的一句英文做地道度优化
 * @param sentence    用户原句（可能来自语音转写）
 * @param aiQuestion  上下文：教练刚问的问题（可选）
 * @param level       目标雅思水平（默认 6.0）
 * @param onUsage     拿到模型真实 token 用量的回调（供上层真实记账）
 * @returns           优化后的句子 + 一句中文改进说明
 */
export async function polishSentence(
  sentence: string,
  aiQuestion?: string,
  level = '6.0',
  onUsage?: (usage: LLMUsage) => void,
): Promise<PolishResult> {
  if (!env.dashscopeApiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .env.local 中设置')
  }
  const userMsg = `(目标雅思水平:) ${level}\n${aiQuestion ? `(教练问的:) ${aiQuestion}\n` : ''}(我说的:) ${sentence}`
  return callLLMJson<PolishResult>({
    label: '[Polish]',
    onUsage,
    // polish 是唯一曾无 fallback 的 AI 调用：解析用尽 2 轮会硬 throw→500→前端一律「优化失败」。
    // 这里给一个诚实降级：不误报「已优化」（needsWork:false + optimized 留空，不会写进优化历史），
    // 只在 note 里如实告知这次没生成建议。不动 llm.ts 默认 maxAttempts（仍 2 轮），只加本处 fallback。
    // failed:true 明确标记这是「没生成」而非「句子已够好」，UI 据此不配成功勾。
    fallback: (): PolishResult => ({
      needsWork: false,
      optimized: '',
      note: '这次没能生成优化建议，可以再说一遍试试',
      failed: true,
    }),
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
      typeof (v as { needsWork?: unknown }).needsWork === 'boolean' &&
      typeof (v as { optimized?: unknown }).optimized === 'string' &&
      typeof (v as { note?: unknown }).note === 'string',
  })
}
