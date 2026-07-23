/**
 * @module   ai/anki-answer
 * @desc     Anki 卡背生成器 —— 输入「题目分析 + part + 中文语料 + 目标档」，产出可直接开口念的英文口语回答。
 *           纯服务端服务函数，契约对齐 services/analysis.ts 的 generatePhrases：只负责「调模型 + 上抛真实用量」，
 *           同意闸 / 计次 / 记账的编排由调用方（drain 端点、未来的入队端点）负责——与 phrases 路由同范式。
 *
 *   为什么走裸 fetch 而不是 lib/llm.ts 的 callLLMJson：卡背输出是【一段纯文本】不是 JSON，callLLMJson
 *   只处理 JSON（见其模块头「coachReply 多轮纯文本不走这里」）。故本文件复用的是 services/practice.ts
 *   coachReply 的纯文本调用范式（裸 fetch + AbortController 超时 + onUsage 上抛 + 破折号兜底清洗），
 *   不另造一套。低层调用抽成可注入的 transport（默认 = 读 env 的真实 fetch），令单测能不真调 DashScope。
 *
 *   prompt 同源：SYSTEM / 档位标签 / user 模板全部 import 自 anki-answer-prompt.ts（唯一真相源，
 *   与探针 generate.mjs 逐字互锁）；本文件绝不内联任何 prompt 文本。
 * @author   LingoBridge
 * @created  2026-07-23
 */
import 'server-only'
import { env } from '@/lib/env-server'
import { MODEL_ANKI } from '@/lib/constants'
import type { LLMUsage } from '@/lib/llm'
import {
  ANKI_ANSWER_SYSTEM,
  ANKI_TIERS,
  ankiAnswerUserPrompt,
  type AnkiTier,
} from '@/lib/ai/anki-answer-prompt'

export type { AnkiTier } from '@/lib/ai/anki-answer-prompt'

/**
 * ⚠️ 初值，金标盲判基线回填前不冻结（方案 §11 冻结门）。切点具体值「先跑基线再定、不预设」。
 *
 * 目标综合分 T → 达标口语下限 S = T − 0.5 → 档位。单一切点划在 T 6.0 / 6.5 之间：
 *   T ≤ 6.0 → A 档（范本 band 5.0–5.5）；T ≥ 6.5 → B 档（默认档，主流 6.5 目标用户落此）。
 * 取两线中点 6.25 作阈值即可让 6.0→A、6.5→B。此常量是唯一切点，调参只改这一处（方案 §7）。
 */
export const TIER_SPLIT = 6.25

/**
 * 目标综合分 → 档位。切点隔离在 TIER_SPLIT 单一常量（见其注释：初值、未冻结）。
 * @param band  卡主的目标综合分（IELTS 总分，如 6.0 / 6.5）
 * @returns     'A'（band < 切点）或 'B'（band ≥ 切点）
 */
export function bandToTier(band: number): AnkiTier {
  return band < TIER_SPLIT ? 'A' : 'B'
}

/** part1 短 / part2 长（maxTokens 参照探针 generate.mjs：part1 512、part2 1200）。 */
export const ANKI_MAX_TOKENS: Record<1 | 2, number> = { 1: 512, 2: 1200 }

/** 探针同款采样温度（generate.mjs TEMPERATURE）。 */
export const ANKI_TEMPERATURE = 0.7

/** 生成器入参：题型只可能是 1 或 2（part3 不生成卡背，由 0030 不变式与调用方共同保证不会走到这里）。 */
export interface AnkiAnswerInput {
  part: 1 | 2
  /** 这道题的分析文本（含英文题面）；由调用方把持久化的 QuestionAnalysis 用 formatAnalysisText 序列化而来 */
  analysis: string
  /** 用户中文口述语料 */
  corpus: string
  /** 目标档（bandToTier 算出，只有 A/B） */
  tier: AnkiTier
}

/** 低层模型调用的可注入形状：单测传桩、生产用默认真实实现，令单测无需真调 DashScope。 */
export interface AnkiChatTransport {
  (params: {
    system: string
    user: string
    maxTokens: number
  }): Promise<{ text: string; usage: LLMUsage | null }>
}

/**
 * 默认 transport：裸 fetch DashScope（OpenAI 兼容），范式对齐 practice.ts coachReply。
 * 各自带 30s 超时；解析真实 usage（缺则返回 null，交调用方回退估算，绝不把 undefined 当 0）。
 */
const defaultTransport: AnkiChatTransport = async ({ system, user, maxTokens }) => {
  if (!env.dashscopeApiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .env.local 中设置')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(`${env.dashscopeBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.dashscopeApiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_ANKI,
        temperature: ANKI_TEMPERATURE,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const detail = await res.text()
      throw new Error(`Anki 卡背生成失败（${res.status}）：${detail.slice(0, 300)}`)
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const text = data.choices?.[0]?.message?.content?.trim() ?? ''
    const u = data.usage
    const usage: LLMUsage | null =
      u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number'
        ? { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens }
        : null
    return { text, usage }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 把持久化的静态分析序列化成生成器要的分析文本（含英文题面）。
 * 形状对齐探针 generate.mjs 里手写的 analysis 文本（英文题面 → 答题结构 → 侧重点编号列表），
 * 让线上喂给模型的分析结构与过闸时一致。此为「怎么拼分析文本」的展示层决定，非 prompt 本身，无同源约束。
 * @param questionText  英文题面（questions.question_text）
 * @param analysis      持久化的静态分析（question_analyses.analysis）
 * @returns             一段分析文本
 */
export function formatAnalysisText(
  questionText: string,
  analysis: { structureLabel?: string; focusPoints?: { title?: string; desc?: string }[] },
): string {
  const lines = [`英文题面：${questionText}`]
  if (analysis.structureLabel) lines.push(`答题结构：${analysis.structureLabel}`)
  const points = analysis.focusPoints ?? []
  if (points.length > 0) {
    lines.push('侧重点：')
    points.forEach((p, i) => {
      lines.push(`${i + 1}) ${p.title ?? ''}：${p.desc ?? ''}`)
    })
  }
  return lines.join('\n')
}

/**
 * 生成一段英文口语卡背。
 * @param input    题目分析 + part + 中文语料 + 目标档
 * @param onUsage  拿到模型真实 token 用量的回调（供调用方真实记账；模型没吐 usage 则不触发，调用方回退估算）
 * @param transport 低层模型调用（默认真实 DashScope）；单测注入桩以避免真调
 * @returns        英文卡背正文（已做破折号兜底清洗）
 * @throws         模型调用失败 / 返回为空时抛错（交由调用方落入失败重试）
 * @sideEffect     默认 transport 会发起一次 DashScope 网络请求
 */
export async function generateAnkiAnswer(
  input: AnkiAnswerInput,
  onUsage?: (usage: LLMUsage) => void,
  transport: AnkiChatTransport = defaultTransport,
): Promise<string> {
  const tierLabel = ANKI_TIERS[input.tier]
  const user = ankiAnswerUserPrompt(input.part, tierLabel, input.analysis, input.corpus)
  const { text, usage } = await transport({
    system: ANKI_ANSWER_SYSTEM,
    user,
    maxTokens: ANKI_MAX_TOKENS[input.part],
  })
  if (!text) throw new Error('Anki 卡背生成返回为空')
  if (usage) onUsage?.(usage)
  // qwen 顽固爱用破折号、prompt 压不住（同 coachReply 实测）；统一替换成逗号，收拢空格避免双空格。
  return text.replace(/\s*[—–]\s*/g, ', ')
}
