/**
 * @module   ranking
 * @desc     相关性排名服务 — 用千问 qwen-plus 对候选题按故事贴合度打分并降序排列
 * @author   LingoBridge
 * @created  2026-06-06
 */
import 'server-only'
import { env } from '@/lib/env-server'
import { callLLMJson } from '@/lib/llm'
import { MODEL_RANKING } from '@/lib/constants'
import type { RelevanceScore } from '@/lib/types'

export interface CandidateQuestion {
  id: string
  en: string
  zh: string
  obs: string  // 所属观察点名称
}

const SYSTEM_PROMPT = `你是雅思口语备考教练。给你一段用户讲的真实故事，和一组候选雅思题，你要判断：用户能不能用这段故事，自然、充分地回答每一道题。

【第一步：先逐题拆解「这道题到底在问什么」，再判断】
对每一道候选题，先想清楚它真正要的是什么：是问「多久一次」（频率）？「某一次具体经历」（单次事件，常见 describe a time…）？某个「特定场景」（如放假、户外、某个具体地点或对象）？「日常习惯或偏好」？还是「看法、观点」（Part 3）？
拆清楚之后，再判断用户这段故事能不能原样回答「这个具体的问法」。不要只看话题像不像。

【判定主线】
判断关键是：要不要改动故事本身（重心、主语、场景、时间、活动、或聚光灯落点），才能回答这道题真正在问的东西。
什么都不用改 = 高匹配；沾边但要换角度、换场景、换聚光灯、或只覆盖一部分 = 中匹配；得换一个完全不同的故事 = 低匹配。

【打分档(0-100，整数)，从严】
85-100（高，从严给）：故事的重心、主语、场景、时间、活动、聚光灯落点【全都不用改】，照现有故事就能直接、充分地回答，而且回答的正是这道题在问的点。只要有一样需要改或硬凑，就不要给到 85。
60-84（中）：沾边，但需要换角度或侧重、把聚光灯挪到故事的另一部分才能答、或只覆盖题目的一部分、或要把「日常习惯」硬套成「某一次」、或场景时间对不太上但故事主体还能用，无需另起一个完全不同的故事。
30-59（低）：必须换一个不同的经历或故事才能答，当前故事帮不上，即使话题沾边也在这档。
0-29：完全答非所问，拿这故事答会很尴尬。

【从严判定的几条硬指引（务必照做）】
· 重心、聚光灯要挪才能答就降到中：故事确实沾这道题，但它的高潮、重心落在别处，要把聚光灯挪到另一个角度、或换个侧重才答得上（例：故事高潮是「对方向你道歉」，拿去答「你说真话的一次」就得把重心改成「我开口讲真话」），属中匹配(60-84)。只有重心不挪、原样答的正是它问的，才给高分。
· 时间、场景对不上就降到中：题目问的是某个特定场景（如「放假时 days off」），故事讲的是另一个场景（如「每天下班后」），必须换个场景才能答，属中匹配(60-84)，不要因为都跟「休息、放松」沾边就给高分。
· 习惯 vs 某一次：故事讲「一直如此的习惯、常态」，题目问「某个具体的一次、上一次」，要把常态硬套成单次事件，属中匹配(60-84)，不进高匹配。
· 场景根本没发生就给低分：题目要求的场景或活动在故事里压根没出现（例：故事全程室内独处，题目问户外散步），必须另讲一个故事，属低匹配(30-59)，不给到 60 以上。

【跨语言】故事是中文，题目是英文（附中文）。按语义判断，别因语言不同误判。

【输入】我会给你：
1) 用户整理后的故事（中文）；
2) 一组候选题，每条带 id、英文题干、中文、所属观察点名称。

【输出】只返回一个合法 JSON 对象，格式如下，不要任何额外文字，不要 markdown 代码块围栏，字符串值内部禁止使用英文双引号：
{"scores":[{"id":"...","score":0-100,"reason":"一句话中文理由"},...]}
按 score 从高到低排序，覆盖所有候选题，一个都不漏。

【示例 A · 低分】
故事：用户每天早上手冲一杯咖啡，享受慢下来、给自己充电的过程，是他放松的方式。
候选题：{"id":"q_typing","en":"Do you prefer typing or handwriting?","zh":"你更喜欢打字还是手写？","obs":"学会的技能"}
正确输出：{"scores":[{"id":"q_typing","score":15,"reason":"故事讲的是咖啡和放松，跟打字手写没交集，硬答会跑题。"}]}

【示例 B · 高分】
故事：用户在小组项目里成果被同事抢功，私下找对方摊牌争取公正，最后对方向他道歉。
候选题：{"id":"q_apology","en":"Describe a time when someone apologized to you","zh":"描述一次别人向你道歉的经历","obs":"关系摩擦冲突"}
正确输出：{"scores":[{"id":"q_apology","score":92,"reason":"故事里正好有对方道歉这一段，能直接完整地答。"}]}

【示例 C · 中分（场景对不上）】
故事：用户每天下班一进门就泡茶、陷进沙发、放空，靠这个解一天的紧绷。
候选题：{"id":"q_daysoff","en":"What do you usually do when you have days off?","zh":"你放假时通常做什么？","obs":"让你感到放松的事"}
正确输出：{"scores":[{"id":"q_daysoff","score":70,"reason":"讲的是下班后，放假是另一个场景，要换场景才能答。"}]}

【示例 D · 中分（重心要挪）】
故事：室友没问就用了用户的健身房卡，用户纠结后当面说清楚，室友道了歉，之后关系更坦诚。
候选题：{"id":"q_truth","en":"Describe a time you told someone the truth","zh":"描述一次你跟别人说实话的经历","obs":"诚实与信任"}
正确输出：{"scores":[{"id":"q_truth","score":72,"reason":"故事高潮是对方道歉，答说实话要换个重心，算中匹配。"}]}

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
        temperature: 0,
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
