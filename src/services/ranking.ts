/**
 * @module   ranking
 * @desc     相关性排名服务 — 用千问 qwen-plus 对候选题按故事贴合度打分并降序排列
 * @author   LingoBridge
 * @created  2026-06-06
 */
import 'server-only'
import { env } from '@/lib/env'
import { callLLMJson } from '@/lib/llm'
import { MODEL_RANKING } from '@/lib/constants'
import type { RelevanceScore } from '@/lib/types'

export interface CandidateQuestion {
  id: string
  en: string
  zh: string
  obs: string  // 所属观察点名称
}

const SYSTEM_PROMPT = `你是雅思口语备考教练。给你一段用户讲的真实故事，和一组候选雅思题，
你要判断：用户能不能用这段故事，自然、充分地回答每一道题。

【判定主线】
判断关键不是话题像不像，而是「要不要改动故事本身才能答」。
不用改 = 高匹配；同一个故事换角度/只覆盖一部分 = 中匹配；得换一个完全不同的故事 = 低匹配。

【打分档(0-100，整数)】
85-100：不用改变故事的重心、主语、场景或时间设定，照着故事就能直接充分地答。
60-84 ：同一个故事换个角度或侧重才能答，或只能覆盖题目的一部分，无需另起一个故事。
30-59 ：必须换一个不同的故事/经历才能答，当前故事帮不上——即使话题沾边也在这档。
0-29  ：完全答非所问，拿这故事答会很尴尬。

【两条判定指引】
· 故事讲的是「一直如此的习惯/常态」，而题目问「某个具体的一次/上一次是什么时候」：
  需要把常态硬套成单次事件，属中匹配(60-84)，不进高匹配。
· 题目要求的场景或活动在故事里根本没有发生（例：故事全程在室内独处，题目问户外散步）：
  必须另讲一个故事才能答，属低匹配(30-59)，不给到 60 以上。

【跨语言】故事是中文，题目是英文（附中文）。按语义判断，别因语言不同误判。

【输入】我会给你：
1) 用户整理后的故事（中文）；
2) 一组候选题，每条带 id、英文题干、中文、所属观察点名称。

【输出】只返回一个合法 JSON 对象，格式如下，不要任何额外文字，不要 markdown 代码块围栏，字符串值内部禁止使用英文双引号：
{"scores":[{"id":"...","score":0-100,"reason":"一句话中文理由"},...]}}
按 score 从高到低排序，覆盖所有候选题，一个都不漏。

【示例 A · 低分】
故事：用户每天早上手冲一杯咖啡，享受慢下来、给自己充电的过程，是他放松的方式。
候选题：{"id":"q_typing","en":"Do you prefer typing or handwriting?","zh":"你更喜欢打字还是手写？","obs":"学会的技能"}
正确输出：{"scores":[{"id":"q_typing","score":15,"reason":"故事讲的是咖啡和放松，跟打字/手写没有交集，硬答会答非所问。"}]}

【示例 B · 高分】
故事：用户在小组项目里成果被同事抢功，私下找对方摊牌争取公正，最后对方向他道歉。
候选题：{"id":"q_apology","en":"Describe a time when someone apologized to you","zh":"描述一次别人向你道歉的经历","obs":"关系摩擦/冲突"}
正确输出：{"scores":[{"id":"q_apology","score":92,"reason":"故事正好有一段「对方向你道歉」的真实经历，能直接完整地答这道题。"}]}

【字数约束】reason 控制在 25 字以内，只说能不能用这故事答、缺什么。`

type RankingResponse = { scores: RelevanceScore[] }

function isRankingResponse(v: unknown): v is RankingResponse {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (!Array.isArray(obj.scores)) return false
  return obj.scores.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).id === 'string' &&
      typeof (item as Record<string, unknown>).score === 'number' &&
      typeof (item as Record<string, unknown>).reason === 'string',
  )
}

/**
 * 截断容错：从被截断的原始输出中抢救已完成的 score 对象。
 * callLLMJson 在两次解析均失败后调用 fallback(raw, jsonText)；
 * 若截断发生在数组中段，已完成的对象仍可用。
 */
function recoverPartialScores(raw: string): RelevanceScore[] {
  const arrayStart = raw.indexOf('"scores"')
  if (arrayStart === -1) return []
  const bracketPos = raw.indexOf('[', arrayStart)
  if (bracketPos === -1) return []

  const content = raw.slice(bracketPos + 1)
  const results: RelevanceScore[] = []
  let i = 0

  while (i < content.length) {
    const ch = content[i]
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === ',') { i++; continue }
    if (ch !== '{') break

    // 用深度计数找到匹配的 } 结尾
    let depth = 0
    let j = i
    let inString = false
    let escaped = false
    while (j < content.length) {
      const c = content[j]
      if (escaped) { escaped = false; j++; continue }
      if (c === '\\' && inString) { escaped = true; j++; continue }
      if (c === '"') { inString = !inString; j++; continue }
      if (inString) { j++; continue }
      if (c === '{') depth++
      if (c === '}') { depth--; if (depth === 0) { j++; break } }
      j++
    }
    if (depth !== 0) break  // 对象不完整，截断发生在此处，停止

    try {
      const obj = JSON.parse(content.slice(i, j)) as Record<string, unknown>
      if (typeof obj.id === 'string' && typeof obj.score === 'number' && typeof obj.reason === 'string') {
        results.push({ id: obj.id, score: obj.score, reason: obj.reason })
      }
    } catch { /* 跳过格式错误的单个对象 */ }
    i = j
  }

  return results
}

/**
 * 对候选题按故事贴合度打分，返回 score 降序排列的 RelevanceScore[]。
 * 任何异常都静默降级，返回空数组（调用方按原序展示）。
 */
export async function rankQuestions(
  storyText: string,
  candidates: CandidateQuestion[],
): Promise<RelevanceScore[]> {
  if (candidates.length === 0) return []
  if (!env.dashscopeApiKey) return []

  const userMessage =
    `【故事】\n${storyText}\n\n【候选题】\n` +
    JSON.stringify(candidates, null, 2)

  try {
    const result = await callLLMJson<RankingResponse>({
      call: {
        provider: 'dashscope',
        endpoint: `${env.dashscopeBaseUrl}/chat/completions`,
        apiKey: env.dashscopeApiKey,
        model: MODEL_RANKING,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.2,
        maxTokens: 4096,
      },
      validate: isRankingResponse,
      fallback: (raw) => {
        const partial = recoverPartialScores(raw)
        if (partial.length > 0) {
          console.warn('[Ranking] 截断容错恢复', { recovered: partial.length })
          return { scores: partial }
        }
        return { scores: [] }
      },
      label: '[Ranking]',
    })
    return result.scores
  } catch {
    return []
  }
}
