/**
 * @module   analysis
 * @desc     题目侧重点分析生成 — 服务端调 qwen-plus，针对题目生成侧重点 + 句式框架
 * @author   LingoBridge
 * @created  2026-06-03
 */
import 'server-only'
import { env } from '@/lib/env'
import { callLLMJson } from '@/lib/llm'
import { MODEL_ANALYSIS } from '@/lib/constants'
import type { QuestionAnalysis } from '@/lib/types'

const SYSTEM_PROMPT = `你是 LingoBridge 的雅思口语备考助手。给定一道雅思口语题，为中国考生生成「答题侧重点」和「可用句式框架」。

# 输出：严格 JSON（不要 markdown 代码块，不要任何解释）
{
  "structureLabel": "答题结构标签，用 · 分隔",
  "focusPoints": [{ "title": "中文标题", "desc": "中文说明 1-2 句，具体可操作" }],
  "sentenceFrames": [{ "text": "地道英文句型，可替换部分用[方括号]标出", "tip": "中文提示" }]
}

# 规则
- structureLabel：Part 1 简短如「频率 · 原因 · 例子」；Part 2 用「事件 · 细节 · 感受 · 收尾」类；Part 3 用「观点 · 理由 · 例子」类
- focusPoints 数量：Part 1 给 2-3 个；Part 2 给 4 个（对应 cue card 的 you should say 结构）；Part 3 给 2-3 个
- focusPoints 写「考官关注什么 + 怎么答」，中文，避免空话套话
- sentenceFrames 固定 3 个，地道但适合 6-7 分水平（别太难），可替换部分一律用 [方括号] 标出
- 全部紧扣这道具体题目

【当用户消息包含「用户的真实故事」时】
- focusPoints 的 desc 要直接结合这个故事的具体内容来写：点名故事里的人物、场景、动作、细节，告诉用户「你可以用故事里的 XX 来答这个点」，而不是泛泛的通用建议。
- sentenceFrames 的 [方括号] 可替换部分，要提示用户填入故事里的真实细节（例：[具体例子，比如你称豆子、控制水温那种细节]），引导用户用自己的真实经历，绝不替用户编造他没说过的事实。
- 如果故事和这道题其实不太贴（用户可能从别的入口点进来），就照常给通用攻略，不要硬把故事塞进去、不要牵强附会。
- 没有「用户的真实故事」字段时，行为和现在完全一样（通用攻略）。

【JSON 格式硬约束】
你只能输出合法 JSON，前后不得有任何说明文字或 markdown 代码块（不要 \`\`\`json）。
字符串值内部禁止出现英文双引号 " ——如需引用或强调，一律改用中文引号「」。
  错误示例："tip":"别只说"I was scared""   ← 裸双引号会破坏 JSON
  正确示例："tip":"别只说「I was scared」"`

export async function generateAnalysis(input: {
  part: 1 | 2 | 3
  en: string
  zh: string | null
  story?: string
}): Promise<QuestionAnalysis> {
  if (!env.dashscopeApiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .env.local 中设置')
  }
  const storySection = input.story ? `\n\n用户的真实故事：${input.story}` : ''
  const userMsg = `Part ${input.part}\n英文题目：${input.en}\n中文：${input.zh ?? ''}${storySection}`
  return callLLMJson<QuestionAnalysis>({
    label: '[Analysis]',
    call: {
      provider: 'dashscope',
      endpoint: `${env.dashscopeBaseUrl}/chat/completions`,
      apiKey: env.dashscopeApiKey,
      model: MODEL_ANALYSIS,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMsg },
      ],
      maxTokens: 1024,
    },
    validate: (v): v is QuestionAnalysis =>
      typeof v === 'object' && v !== null &&
      Array.isArray((v as { focusPoints?: unknown }).focusPoints) &&
      Array.isArray((v as { sentenceFrames?: unknown }).sentenceFrames),
  })
}
