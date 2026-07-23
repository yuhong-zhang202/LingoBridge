/**
 * @module   ai/anki-answer
 * @desc     Anki 卡背「分点式例句」生成器（v0.3 形态）—— 输入「题面 + part + 答题侧重点 + 中文语料」，
 *           为每个侧重点产出一句忠于语料的短英文例句；语料没素材的点【留空】（en=null、noMaterial=true），
 *           绝不为填满而编造（留空出口，方案 §3/§11）。不分档（v0.3 砍 band，见 anki-answer-prompt.ts）。
 *
 *   纯服务端服务函数，契约对齐 services/analysis.ts 的 generatePhrases：只负责「调模型 + 上抛真实用量」，
 *   同意闸 / 计次 / 记账的编排由调用方（drain 端点）负责。
 *
 *   为什么走本地 callAnkiLLMJson（anki-json.ts）而非共享 callLLMJson：分点式输出是【JSON 点数组】，
 *   但 qwen 对富语料约 28% 概率把 JSON【双发】（紧凑+美化拼接），共享 llm.ts 的 extractJson 贪切会拼成
 *   非法 JSON。本地 caller 改用平衡括号取首个完整值兜双发（见 anki-json.ts 头），绝不改全站 llm.ts。
 *   输出仍用 {"points":[...]} 对象包一层（历史契约，validate 认对象），平衡括号解析对象/数组皆可。
 *
 *   prompt 同源：SYSTEM / user 模板全部 import 自 anki-answer-prompt.ts（唯一真相源，与探针
 *   example-probe.mjs 的 SYSTEM_STORIED 逐字互锁）；本文件绝不内联任何 prompt 文本。
 * @author   LingoBridge
 * @created  2026-07-23
 */
import 'server-only'
import { env } from '@/lib/env-server'
import { MODEL_ANKI } from '@/lib/constants'
import type { LLMUsage } from '@/lib/llm'
import { callAnkiLLMJson } from '@/lib/ai/anki-json'
import { ANKI_ANSWER_SYSTEM, ankiAnswerUserPrompt } from '@/lib/ai/anki-answer-prompt'

/**
 * 单点例句生成结果，逐点对齐输入 focusPoints。
 * - noMaterial=false：en 是一句忠于语料的短英文例句。
 * - noMaterial=true ：en 为 null，表示这个侧重点用户语料里没素材、按留空出口留空（不是失败）。
 */
export interface AnkiAnswerPoint {
  idx: number
  en: string | null
  noMaterial: boolean
}

/** 对象包裹（历史契约：给点数组包一层 points；平衡括号解析对象/数组皆可，包裹只为与探针输出契约一致）。 */
interface AnkiAnswerEnvelope {
  points: AnkiAnswerPoint[]
}

/**
 * part1 短 / part2 长的 max_tokens 上限。分点式每点 ≤22 词、点数少（part1 2 点 / part2 3 点），
 * 512 / 1200 对当前形态绰绰有余（宽松防截断，不精调）。
 */
export const ANKI_MAX_TOKENS: Record<1 | 2, number> = { 1: 512, 2: 1200 }

/** 探针同款采样温度（example-probe.mjs TEMPERATURE）。 */
export const ANKI_TEMPERATURE = 0.7

/** 生成器入参：题型只可能是 1 或 2（part3 例句走 pregen 静态、不经本生成器、不进 drain）。 */
export interface AnkiAnswerInput {
  part: 1 | 2
  /** 英文题面（questions.question_text） */
  questionText: string
  /** 这道题的答题侧重点（question_analyses.analysis.focusPoints）；生成结果按其顺序逐点对齐 */
  focusPoints: { title: string; desc: string }[]
  /** 用户中文口述语料 */
  corpus: string
}

/** 单点例句结果的运行时守卫：idx 数字、noMaterial 布尔、en 为字符串或 null。 */
function isAnkiAnswerPoint(v: unknown): v is AnkiAnswerPoint {
  if (typeof v !== 'object' || v === null) return false
  const p = v as { idx?: unknown; en?: unknown; noMaterial?: unknown }
  return (
    typeof p.idx === 'number' &&
    typeof p.noMaterial === 'boolean' &&
    (p.en === null || typeof p.en === 'string')
  )
}

/** 顽固破折号兜底清洗（同 coachReply 实测：qwen 爱用破折号、prompt 压不住），只清非空 en。 */
function cleanEn(en: string): string {
  return en.replace(/\s*[—–]\s*/g, ', ').trim()
}

/**
 * 为每个侧重点生成一句英文口语例句（或留空）。
 * @param input    题面 + part + 侧重点 + 中文语料
 * @param onUsage  拿到模型真实 token 用量的回调（供调用方真实记账；模型没吐 usage 则不触发，调用方回退估算）
 * @returns        点数组，逐点对齐 input.focusPoints；留空点 en=null、noMaterial=true
 * @throws         模型调用失败 / 校验不过（用尽重试）时抛错，交由调用方落入失败重试
 * @sideEffect     发起一次 DashScope 网络请求
 */
export async function generateAnkiAnswer(
  input: AnkiAnswerInput,
  onUsage?: (usage: LLMUsage) => void,
): Promise<AnkiAnswerPoint[]> {
  if (!env.dashscopeApiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .env.local 中设置')
  }
  const user = ankiAnswerUserPrompt(input.part, input.questionText, input.focusPoints, input.corpus)
  const result = await callAnkiLLMJson<AnkiAnswerEnvelope>({
    label: '[AnkiAnswer]',
    onUsage,
    call: {
      endpoint: `${env.dashscopeBaseUrl}/chat/completions`,
      apiKey: env.dashscopeApiKey,
      model: MODEL_ANKI,
      temperature: ANKI_TEMPERATURE,
      maxTokens: ANKI_MAX_TOKENS[input.part],
      messages: [
        { role: 'system', content: ANKI_ANSWER_SYSTEM },
        { role: 'user', content: user },
      ],
    },
    validate: (v): v is AnkiAnswerEnvelope =>
      typeof v === 'object' && v !== null &&
      Array.isArray((v as { points?: unknown }).points) &&
      (v as { points: unknown[] }).points.every(isAnkiAnswerPoint),
  })
  // 逐点对齐：按 idx 升序，清洗非空 en 的破折号（留空点 en 保持 null）。
  return [...result.points]
    .sort((a, b) => a.idx - b.idx)
    .map((p) => ({ idx: p.idx, en: p.en === null ? null : cleanEn(p.en), noMaterial: p.noMaterial }))
}
