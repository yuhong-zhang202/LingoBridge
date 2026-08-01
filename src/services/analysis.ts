/**
 * @module   analysis
 * @desc     题目侧重点分析生成 — 服务端调 qwen-plus，针对题目生成侧重点 + 句式框架
 * @author   LingoBridge
 * @created  2026-06-03
 */
import 'server-only'
import { env } from '@/lib/env-server'
import { callLLMJson, streamDashScopeText, type LLMUsage } from '@/lib/llm'
import { MODEL_ANALYSIS } from '@/lib/constants'
import type { QuestionAnalysis, AnalysisPhraseGroup } from '@/lib/types'
import { AnalysisStreamParser, type AnalysisStreamSection } from '@/lib/analysis-stream-parse'

/**
 * 超时预算 = BASE + PER_INPUT_CHAR × 输入字符数，与输入规模挂钩，绝不吃 llm.ts 的 30s 默认值。
 *
 * 为什么必须显式给（2026-07-16 实测）：
 * · [Analysis] 11.8s / [Phrases] 10.1s，30s 默认只剩 2.5×~3.0× 余量；
 * · 作为参照，ranking 35 道候选实测 20s（1.5× 余量）就是 6 个故事全挂的那条线，这里离它只差一步；
 * · maxTokens 2560/2048 允许输出比实测再翻约 2 倍 → 外推 ~24s，余量基本归零；
 * · 上面那次实测用的故事仅约 130 字符，真实用户的整理后语料要长得多——所以预算必须随输入涨，
 *   拍一个固定值等于赌用户不讲长故事。
 * 宁可给宽：本环节【没有 fallback、没有截断抢救】，超时 = 用户直接看到报错页。
 * 标定：约 130 字符输入 → 60s（实测 11.8s 的 5×）；每多 1 字符 +40ms（约 1000 字符的长语料 → 95s）。
 */
const TIMEOUT_BASE_MS = 55_000
const TIMEOUT_PER_INPUT_CHAR_MS = 40

/**
 * 按输入规模算超时预算
 * @param userMsg  送给模型的 user 消息（含题目与用户故事，是输出长度的主要驱动）
 * @returns        本次调用的超时毫秒数
 */
function timeoutFor(userMsg: string): number {
  return TIMEOUT_BASE_MS + TIMEOUT_PER_INPUT_CHAR_MS * userMsg.length
}

const SYSTEM_PROMPT = `你是 LingoBridge 的雅思口语备考助手。给定一道雅思口语题（可能附用户的真实故事），为中国考生生成「答题侧重点」和「可用词组」。本页只会出现 Part 1 和 Part 2 的题（Part 3 不会走到这里，不用考虑）。

# 怎么分析（每次都按这三样来想）
1) 题目结构：先拆这道题真正在问什么——是问「多久一次」（频率）、「某一次具体经历」（单次事件）、某个「特定场景」（如放假、户外、某地），还是「日常习惯或偏好」？structureLabel 和侧重点都要扣住这个真实问法，不要套通用模板。structureLabel 的段数和 focusPoints 的点数对应：Part 1 两段，Part 2 三段，每段扣住对应那一点。
2) 语料内容：扣用户这条故事的真实细节（人物、场景、动作、感受），指出哪一块正好能答这道题。如果故事和这道题对不太上，就平和地说清楚缺口（例：你讲的是下班后，这题问放假，可能要换个场景或换条故事），不要硬套。
3) 口语评分标准：你内部要依据真实的雅思口语评分标准来判断「什么样的回答能拿分」——即 流利与连贯（Fluency and Coherence）、词汇资源（Lexical Resource）、语法多样与准确（Grammatical Range and Accuracy）、发音（Pronunciation）。据此判断这道题最该展开、讲透哪一块，把考生往真正拿分的方向引（内容讲充分、自然连贯、表达地道、Part 2 把重点和感受展开）。不要把注意力引到不得分的细节上（如时间精确到某天、用 my 还是 a）。
   · 【重要】输出给用户时，绝不出现 fluency、lexical resource、grammar、band、评分 这类术语，一律用大白话，比如「内容要讲充分」「这块要重点展开」「说得自然连贯就好」。

# 输出：严格 JSON（不要 markdown 代码块，不要任何解释）
{
  "structureLabel": "答题结构标签，用 · 分隔，扣住这道题的实际答法",
  "focusPoints": [{ "title": "4 到 8 字短名词小标题", "desc": "中文说明 1 到 2 句，具体、可操作" }],
  "phrases": [{ "group": "简洁名词标签，如「时间」「人物」「原因」「经过」「感受」「行为」", "items": [{ "text": "纯英文短词块", "meaning": "中文释义", "scene": "中文，真实英语里什么场合会用到它" }] }]
}

# focusPoints 规则（帮用户「对准这道题」，不是教他怎么说话）
- focusPoints 只对准这道题本身，与用户的目标雅思水平无关；任何目标分下，同一道题的 focusPoints 都应一样。
- title 是 4 到 8 字的短名词小标题，具体、说人话、一眼能懂。好标题像：「说清具体时间」「点明人物关系」「讲清关键冲突」「交代背景」「补上感受变化」。【绝不能是一句话或带逗号的句子】（例如「一两句直接答，别铺垫」这种不行；「贴真实节奏」这种太虚也不行）。具体说明放进 desc。
- title 和 desc 用中文写。可以为了说明题目而引用题干里的英文词（如 usually、days off、when it was），但【不要】给用户答案该用的英文（不写答案的英文句子、词组或单词）；答案的英文一律放进 phrases 让他自己挑。
- 语气是平和的提示和建议，不是命令或纠正，不要「别这样、别那样」这种说教腔；用户怎么表达完全由他自己决定。
- 点数固定，按 Part 给：
  · Part 1（共 2 点）：
    点 1 = 怎么起手：提醒一两句、简洁直接就行，不用铺垫或解释一堆原因；点一下开头思路（开门见山先说你做的事，比如把故事里最真实的那个动作放最前面），只说思路，不替他写具体英文句子。
    点 2 = 收在哪：提醒挑一个真实小细节点一下就够，别展开讲道理、别越答越长。
  · Part 2（共 3 点，固定下面这套分析框架，按这道题套，不要写死成某个题）：
    点 1 = 交代背景：用一句话快速带过时间、谁、什么事就行，别在时间精确度、人物修饰上停留。
    点 2 = 讲清重点：先想清楚这道题真正在考什么、口语上什么样的回答能拿分，然后告诉用户这道题最该展开、讲透的是哪一块，让他把这块讲清楚讲到位。结合用户的故事，点出他哪一段正好是这个核心。（举例：道歉类的题，核心是「为什么会道歉」那段冲突或起因；喜欢某地的题，核心是「为什么喜欢、它哪里特别」。）
    点 3 = 补得更完整：提示再补上哪个角度能让回答更完整、更出彩。叙事类的题通常是把你的感受、心情的变化、事情的结果或后续讲出来，这是 Part 2 最能拉开分数的地方。
- 没有用户故事时，focusPoints 给这道题通用的对题思路，不绑定具体细节。

# phrases 规则（替代句式框架，目标：让用户少思考、直接取用）
- 每个词组是一个对象，含三个字段：text（英文词组本身）、meaning（中文释义）、scene（中文，适用场景）。
- text 是「短词块」，能直接塞进自己话里说出来（一般 2 到 5 个词）。【不要写成完整句子，尤其别给「I / we / it + 动词 + …」这种一整句陈述】；短的动词短语、名词短语、形容词都可以。感受这一组也照此办，给短词块、不给整句。
  · 反例（不要）：I felt relieved once we talked it out
  · 正例（要）：relieved、kind of surprised、more honest now
- 【text 必须是纯英文，绝不能夹中文字】，哪怕一个中文词都不行；遇到中文概念（如「分工」「健身房卡」）必须翻成英文。
  · 反例（不要）：I showed him the分工 record
  · 正例（要）：showed him the records、the breakdown of who did what
- meaning：一句简短中文释义，说清这个词组什么意思，不超过 15 字。
- scene：一句中文，说明这个词组在【真实英语世界里】什么场合、什么语境下会用到，要脱离用户这条具体故事来讲（讲通用用法，不是「在你的故事里」）。例如 take all the credit 的 scene 可写「别人把团队或他人的功劳算到自己头上时，用来描述这种行为」。
- 分组标签用简洁名词（如 时间、人物、地点、原因、经过、感受、行为），不要用「谁」「为什么道歉」「什么时候」「什么感受」这类口语化或带疑问词的长标签。
- 分组：通常分 3 组左右。问日常、习惯、休息类的 Part 1，固定分「行为 / 时间 / 感受」三组，三组都要给。其它类型的题（如某次经历）按它自己的自然分段来分组，用上面那种简洁名词标签，组数不限。
- 每组 3 到 5 个；挑最有用、最地道、最贴这个故事的。
- 词组按用户的目标雅思水平出（用户消息里会给出「目标雅思水平」，5.0 到 8.0）。【这条水平只作用于本段 phrases，只调词组的表达难度；它不改变上面 structureLabel 和 focusPoints 的任何判断——题目结构、对题侧重点只由这道题本身和用户故事决定，与用户想考几分无关。】关键：水平只调「表达性」的词，也就是感受、动作经过、评价这类能体现词汇功力的部分。像时间、人物（谁）、地点这种只是交代事实的锚点（如 last autumn、an old friend、by myself、the plateau），任何档都可以简单、可以和低档一样，不要为了拔高硬换成花哨说法，那样反而假、反而像炫技。
  表达性词按下面调难度，但永远是「能说出口的口语」，不是书面词：
  · 5.0 到 5.5：最常见、最基础的日常词，简单直接，宁可朴素也别难。
  · 6.0 到 6.5：自然的日常口语，朴素为主。感受、描述这类不要用流利的整句、也不要生动习语，普通说清楚就行（默认水平）。
  · 7.0 到 7.5：感受和动作这类明显更地道，用 less common 的搭配、phrasal verb、习惯说法，开始有点个性，别停在 6 分那种最普通的搭配上。
  · 8.0：感受和动作有 native 感的地道表达（idiomatic chunks、natural collocations、灵活的 particle 用法），但依然是口语，不是长难句或炫技。
  整体必须是「说出来」的口语（自然、日常、可缩写），不要书面腔、不要长难句、不要堆高级词。
- text 尽量贴用户故事里的真实内容（动作、场景、感受），但绝不替用户编造他没说过的事实；scene 则讲通用用法、不绑定故事。
- 没有用户故事时，给这道题通用、好用的纯英文短词块，三字段照常给。

# 全局
- 全部紧扣这道具体题目。
- 【不要使用破折号】：输出里任何地方都不要出现「—」或「–」，需要停顿或连接就用逗号、句号，或 and、so、but、like 这类词。

【JSON 格式硬约束】
你只能输出合法 JSON，前后不得有任何说明文字或 markdown 代码块（不要 \`\`\`json）。
字符串值内部禁止出现英文双引号 " ，如需引用或强调，一律改用中文引号「」。
  错误示例："tip":"别只说"I was scared""   ← 裸双引号会破坏 JSON
  正确示例："tip":"别只说「I was scared」"`

export async function generateAnalysis(input: {
  part: 1 | 2 | 3
  en: string
  zh: string | null
  story?: string
  /** 目标雅思水平（只调 phrases 词组表达难度，见 SYSTEM_PROMPT phrases 规则）。缺省 '6.0'——匿名/脚手架不传时行为不变。 */
  level?: string
}, onUsage?: (usage: LLMUsage) => void): Promise<QuestionAnalysis> {
  if (!env.dashscopeApiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .env.local 中设置')
  }
  // default 落函数内、不靠调用方：确保与 generateAnalysisStreaming 对同一 input 的 userMsg 字节一致。
  const level = input.level ?? '6.0'
  const storySection = input.story ? `\n\n用户的真实故事：${input.story}` : ''
  const userMsg = `目标雅思水平：${level}\nPart ${input.part}\n英文题目：${input.en}\n中文：${input.zh ?? ''}${storySection}`
  return callLLMJson<QuestionAnalysis>({
    label: '[Analysis]',
    onUsage,
    call: {
      provider: 'dashscope',
      endpoint: `${env.dashscopeBaseUrl}/chat/completions`,
      apiKey: env.dashscopeApiKey,
      model: MODEL_ANALYSIS,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMsg },
      ],
      maxTokens: 2560,
    },
    timeoutMs: timeoutFor(userMsg),
    validate: (v): v is QuestionAnalysis =>
      typeof v === 'object' && v !== null &&
      Array.isArray((v as { focusPoints?: unknown }).focusPoints) &&
      Array.isArray((v as { phrases?: unknown }).phrases),
  })
}

/**
 * 花括号切片：与 llm.ts 内 callLLMJson 私有的 extractJson 同口径（取第一个 `{` 到最后一个 `}`），
 * 对前后任意废话/markdown 健壮。此处复刻两行逻辑，是为让流式路的「权威最终校验」与缓冲路字节一致，
 * 又不破坏 llm.ts「本阶段只增不改」的约束（那份是私有闭包，不导出）。
 * @param raw  累积的完整原始文本
 * @returns    花括号内切片；无有效花括号返回空串
 */
function extractJsonSlice(raw: string): string {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  return start >= 0 && end > start ? raw.slice(start, end + 1) : ''
}

/**
 * QuestionAnalysis 的类型守卫 + schema 校验。
 * ⚠️ 必须与 generateAnalysis 里内联的 validate 完全同规则（focusPoints/phrases 是数组），
 * 二者对同一次调用的全文必须给出一致判定——这是「流式返回与缓冲返回字节一致」的一环。
 * generateAnalysis 按红线保持不动，故此处独立复刻，改动其一务必同步另一。
 * @param v  待校验的已 parse 值
 * @returns  是否为合法 QuestionAnalysis
 */
function isQuestionAnalysis(v: unknown): v is QuestionAnalysis {
  return (
    typeof v === 'object' && v !== null &&
    Array.isArray((v as { focusPoints?: unknown }).focusPoints) &&
    Array.isArray((v as { phrases?: unknown }).phrases)
  )
}

/**
 * generateAnalysis 的流式版：prompt / model / maxTokens / userMsg 拼装 / 超时预算全部与之一字不差，
 * 仅把「一次性缓冲」换成「流式原始文本 + 增量解析」，边解析边通过 onSection 吐出已完成的段（预览）。
 *
 * 权威返回：流结束后对累积全文走与缓冲路完全相同的最终校验（extractJsonSlice + JSON.parse + isQuestionAnalysis），
 * 这份才是返回值——保证与 generateAnalysis 对同一次调用字节一致；onSection 的段仅供预览，done 以权威返回为准。
 * 校验失败一律 throw（阶段二里 route 据此发 error 帧、前端降级 ?stream=0）。
 *
 * @param input     part / en / zh / story，与 generateAnalysis 同形
 * @param onSection 增量段回调（可选，透传增量解析器吐的 structureLabel / focusPoint / phraseGroup）
 * @param onUsage   真实 token 用量回调（可选，从流的 usage 帧取）
 * @returns         权威 QuestionAnalysis（与缓冲路同全文、同 parse、同 validate）
 * @sideEffect      发起流式网络请求；对每个完成段调用 onSection；拿到 usage 时调用 onUsage
 */
export async function generateAnalysisStreaming(input: {
  part: 1 | 2 | 3
  en: string
  zh: string | null
  story?: string
  /** 目标雅思水平（同 generateAnalysis）。缺省 '6.0'；必须与 generateAnalysis 的 userMsg 拼装逐字一致。 */
  level?: string
}, onSection?: (section: AnalysisStreamSection) => void, onUsage?: (usage: LLMUsage) => void): Promise<QuestionAnalysis> {
  if (!env.dashscopeApiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .env.local 中设置')
  }
  // default 落函数内、与 generateAnalysis 同口径：两函数对同一 input 的 userMsg 必须字节一致（analysis.test 权威返回等价断言）。
  const level = input.level ?? '6.0'
  const storySection = input.story ? `\n\n用户的真实故事：${input.story}` : ''
  const userMsg = `目标雅思水平：${level}\nPart ${input.part}\n英文题目：${input.en}\n中文：${input.zh ?? ''}${storySection}`

  const parser = new AnalysisStreamParser((section) => onSection?.(section))
  let full = ''
  for await (const chunk of streamDashScopeText({
    endpoint: `${env.dashscopeBaseUrl}/chat/completions`,
    apiKey: env.dashscopeApiKey,
    model: MODEL_ANALYSIS,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userMsg },
    ],
    maxTokens: 2560,
    timeoutMs: timeoutFor(userMsg),
    label: '[Analysis-Stream]',
    onUsage,
  })) {
    full += chunk
    parser.push(chunk)
  }

  // —— 权威最终校验：与缓冲路（callLLMJson）完全同口径 ——
  const jsonText = extractJsonSlice(full)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('[Analysis-Stream] JSON 解析失败')
  }
  if (!isQuestionAnalysis(parsed)) {
    throw new Error('[Analysis-Stream] 输出校验失败')
  }
  return parsed
}

const PHRASES_SYSTEM_PROMPT = `你是 LingoBridge 的雅思口语备考助手。给定一道雅思口语题（可能附用户真实故事）和一个目标雅思口语水平，为中国考生生成「可用词组」——一组能直接开口用的英文短词块，按答案分段分组。本页只有 Part 1 和 Part 2 的题。

# 输出：严格 JSON（不要 markdown 代码块，不要任何解释）
{
  "phrases": [{ "group": "简洁名词标签，如「时间」「人物」「原因」「经过」「感受」「行为」", "items": [{ "text": "纯英文短词块", "meaning": "中文释义", "scene": "中文，真实英语里什么场合会用到它" }] }]
}

# phrases 规则
- 每个词组是一个对象，含三个字段：text（英文词组本身）、meaning（中文释义）、scene（中文，适用场景）。
- text 是「短词块」，能直接塞进自己话里说出来（一般 2 到 5 个词）。不要写成完整句子，尤其别给「I / we / it + 动词 + …」这种一整句；短的动词短语、名词短语、形容词都可以，感受组也给短词块。
  · 反例：I felt relieved once we talked it out　正例：relieved、kind of surprised、more honest now
- text 必须是纯英文，绝不能夹中文字；遇到中文概念（如「分工」「健身房卡」）必须翻成英文。
- meaning：一句简短中文释义，不超过 15 字。
- scene：一句中文，说明这个词组在【真实英语世界里】什么场合、什么语境会用到，脱离用户这条具体故事来讲（讲通用用法，不是「在你的故事里」）。例：take all the credit 的 scene 可写「别人把团队或他人的功劳算到自己头上时，用来描述这种行为」。
- 分组标签用简洁名词，不要用「谁」「为什么」「什么时候」这类带疑问词的长标签。通常分 3 组左右；问日常、习惯、休息类的 Part 1 固定分「行为 / 时间 / 感受」三组；其它题按自然分段分组。每组 3 到 5 个。
- text 尽量贴用户故事里的真实内容（动作、场景、感受），绝不替用户编造他没说过的事实；scene 讲通用用法、不绑故事。没有故事时给通用好用的纯英文短词块，三字段照常给。

# 按目标雅思水平给词（用户消息里会给出一个目标水平，5.0 到 8.0）
关键：水平只调「表达性」的词，也就是感受、动作经过、评价这类能体现词汇功力的部分。像时间、人物（谁）、地点这种只是交代事实的锚点（如 last autumn、an old friend、by myself、the plateau），任何档都可以简单、可以和低档一样，不要为了拔高硬换成花哨说法，那样反而假、反而像炫技。
表达性词按下面调难度，但永远是「能说出口的口语」，不是书面词：
- 5.0 到 5.5：最常见、最基础的日常词，简单直接，宁可朴素也别难。
- 6.0 到 6.5：自然的日常口语，朴素为主。感受、描述这类不要用流利的整句、也不要生动习语，普通说清楚就行（默认水平）。
- 7.0 到 7.5：感受和动作这类明显更地道，用 less common 的搭配、phrasal verb、习惯说法，开始有点个性，别停在 6 分那种最普通的搭配上。
- 8.0：感受和动作有 native 感的地道表达（idiomatic chunks、natural collocations、灵活的 particle 用法），但依然是口语，不是长难句或炫技。
meaning 和 scene 始终用中文，和水平无关。

# 全局
- 全部紧扣这道具体题目。
- 不要使用破折号：任何地方都不要出现「—」或「–」，需要停顿或连接用逗号、句号或 and、so、but、like。

【JSON 格式硬约束】
只能输出合法 JSON，前后不得有任何说明文字或 markdown 代码块。
字符串值内部禁止出现英文双引号 " ，如需引用一律改用中文引号「」。`

export async function generatePhrases(input: {
  part: 1 | 2 | 3
  en: string
  zh: string | null
  story?: string
  level: string
}, onUsage?: (usage: LLMUsage) => void): Promise<AnalysisPhraseGroup[]> {
  if (!env.dashscopeApiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .env.local 中设置')
  }
  const storySection = input.story ? `\n\n用户的真实故事：${input.story}` : ''
  const userMsg = `目标雅思水平：${input.level}\nPart ${input.part}\n英文题目：${input.en}\n中文：${input.zh ?? ''}${storySection}`
  const result = await callLLMJson<{ phrases: AnalysisPhraseGroup[] }>({
    label: '[Phrases]',
    onUsage,
    call: {
      provider: 'dashscope',
      endpoint: `${env.dashscopeBaseUrl}/chat/completions`,
      apiKey: env.dashscopeApiKey,
      model: MODEL_ANALYSIS,
      messages: [
        { role: 'system', content: PHRASES_SYSTEM_PROMPT },
        { role: 'user',   content: userMsg },
      ],
      maxTokens: 2048,
    },
    timeoutMs: timeoutFor(userMsg),
    validate: (v): v is { phrases: AnalysisPhraseGroup[] } =>
      typeof v === 'object' && v !== null &&
      Array.isArray((v as { phrases?: unknown }).phrases),
  })
  return result.phrases
}
