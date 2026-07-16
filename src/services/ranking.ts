/**
 * @module   ranking
 * @desc     相关性排名服务 — 用千问 qwen-plus 对候选题按故事贴合度打分并降序排列。
 *           与模型之间的 join key 用短序号 q1/q2/…（不用 36 位 UUID：语义相近的题簇上模型会抄错
 *           UUID，把 {score, reason} 整体贴到另一道题上）；并强制模型回显题干前缀 q 做对齐校验，
 *           校验不过就退回重试、再不过就整次降级，绝不静默接受错位。UUID↔序号的映射只在本模块内维护。
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

/**
 * 超时预算 = BASE + PER_CANDIDATE × 候选数。
 * 不能吃 llm.ts 的 30s 默认值：重排的输出长度随候选数线性增长，候选多的故事生成逼近 30s 会被
 * fetch 层 abort ——连一个字节都拿不到，截断抢救也无从下手，整条故事的候选全空。
 * 标定实测：7 道 ≈ 11s、35 道 ≈ 20s；本公式给出 2.3×~3.4× 余量（7 道→25.5s，35 道→67.5s）。
 */
const TIMEOUT_BASE_MS = 15_000
const TIMEOUT_PER_CANDIDATE_MS = 1_500

/**
 * 最多重问几轮。每轮都是【整批】重问（全部候选一起），绝不改成只单独问缺失的那几道：
 * 单独问时模型看不到其余候选，给出的分数不再是「在这批里横向比较」的结果，而是孤立判断——
 * 与「分批调用」是同一个病：每批换一把尺，引入我们没有任何指标能测到的偏差。
 */
const MAX_ATTEMPTS = 3

/** 要求模型回显的英文题干前缀长度。够长才能区分同题簇的近似题（如"拍照"与"景色"两问） */
const ECHO_PREFIX_LEN = 40
/** 回显串短于此长度视为无效回显：太短的前缀在近似题簇里区分不出谁是谁，等于没校验 */
const ECHO_MIN_LEN = 8

/** 喂给模型的候选题：id 是本地短序号 q1/q2/…，模型只需原样抄回它 */
interface SeqCandidate {
  id: string
  en: string
  zh: string
  obs: string
}

/** 模型返回的单条打分：id=短序号，q=英文题干前缀回显（用于抓 score/reason 贴错题） */
interface RankingScoreItem {
  id: string
  q: string
  score: number
  reason: string
}

type RankingResponse = { scores: RankingScoreItem[] }

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
2) 一组候选题，每条带 id（形如 q1、q2 的短编号）、英文题干 en、中文 zh、所属观察点 obs。

【输出】只返回一个合法 JSON 对象，格式如下，不要任何额外文字，不要 markdown 代码块围栏，字符串值内部禁止使用英文双引号：
{"scores":[{"id":"q1","q":"英文题干前 ${ECHO_PREFIX_LEN} 个字符","reason":"一句话中文理由","score":0-100},...]}
按 score 从高到低排序，覆盖所有候选题，一个都不漏，id 不重复。

【⚠️ 字段顺序不许调换：先 reason 后 score】
每条打分必须按 id → q → reason → score 的顺序写。这不是格式洁癖，是判断顺序：
先回显题干（q）看清这道题在问什么，再写出判断依据（reason），最后才落分数（score）。
分数必须是前面那句 reason 的结论。如果你写完 reason 发现它在说「要换主语／得换故事／场景对不上」，
那 score 就不能是高分——reason 怎么说，score 就怎么落。
反过来先写分数再补理由，等于给已经定了的数字事后编说法，那个理由是假的。

【⚠️ 关于 q 字段：这是防错位校验，必须照做】
每条打分里的 q，必须是【你正在打分的那道题】en 的开头原文（照抄前 ${ECHO_PREFIX_LEN} 个字符即可，不足则抄全）。
系统会逐条核对 q 与 id 是否指向同一道题，对不上就整次作废。
所以每写一条打分前，请回头确认：这个 score 和 reason，说的确实是 id 指向的那道题吗？
候选里出现话题相近、句式相似的题时（例如同时有「你喜欢拍照吗」和「你见过最美的景色是什么」），最容易把两条的 score/reason 写反——务必逐题核对再落笔。

【示例 A · 低分】
故事：用户每天早上手冲一杯咖啡，享受慢下来、给自己充电的过程，是他放松的方式。
候选题：{"id":"q1","en":"Do you prefer typing or handwriting?","zh":"你更喜欢打字还是手写？","obs":"学会的技能"}
正确输出：{"scores":[{"id":"q1","q":"Do you prefer typing or handwriting?","reason":"故事讲的是咖啡和放松，跟打字手写没交集，硬答会跑题。","score":15}]}

【示例 B · 高分】
故事：用户在小组项目里成果被同事抢功，私下找对方摊牌争取公正，最后对方向他道歉。
候选题：{"id":"q1","en":"Describe a time when someone apologized to you","zh":"描述一次别人向你道歉的经历","obs":"关系摩擦冲突"}
正确输出：{"scores":[{"id":"q1","q":"Describe a time when someone apologized to","reason":"故事里正好有对方道歉这一段，能直接完整地答。","score":92}]}

【示例 C · 中分（场景对不上）】
故事：用户每天下班一进门就泡茶、陷进沙发、放空，靠这个解一天的紧绷。
候选题：{"id":"q1","en":"What do you usually do when you have days off?","zh":"你放假时通常做什么？","obs":"让你感到放松的事"}
正确输出：{"scores":[{"id":"q1","q":"What do you usually do when you have days","reason":"讲的是下班后，放假是另一个场景，要换场景才能答。","score":70}]}

【示例 D · 中分（重心要挪）+ 近似题簇逐条核对】
故事：室友没问就用了用户的健身房卡，用户纠结后当面说清楚，室友道了歉，之后关系更坦诚。
候选题：[{"id":"q1","en":"Describe a time you told someone the truth","zh":"描述一次你跟别人说实话的经历","obs":"诚实与信任"},{"id":"q2","en":"Describe a time you lent something to a friend","zh":"描述一次你把东西借给朋友的经历","obs":"诚实与信任"}]
正确输出：{"scores":[{"id":"q1","q":"Describe a time you told someone the trut","reason":"故事高潮是对方道歉，答说实话要换个重心，算中匹配。","score":72},{"id":"q2","q":"Describe a time you lent something to a f","reason":"故事里卡是被擅自拿走的，不是主动借出，要换故事。","score":45}]}
注意示例 D 两题句式相似，q 各自回显自己那道题的开头，score 与 reason 也各归各题，没有写反。

【字数约束】reason 控制在 25 字以内，只说能不能用这故事答、缺什么。
【reason 硬约束】reason 会原样展示给用户，用户看不到候选编号，也看不到别的题。所以：
每条 reason 必须自己讲得通，禁止出现 q1、q2 这类编号，禁止写「同上」「同 q5」「同前」这类指代；
哪怕两道题的判词几乎一样，也各自完整写一遍。`

/** 校验失败时退回给模型的整改要求：必须说清是「对齐错了」，否则模型会按默认指令去修引号 */
const REALIGN_INSTRUCTION =
  '你上次的输出没有通过校验，可能的原因：q 字段与 id 指向的题目对不上（把某题的 score/reason 写到了另一题的 id 上）、' +
  'id 有重复、有编造、漏了候选题、或某条 reason 用了「同上」「同 q5」这类指代。请重新逐题核对后输出：' +
  '对每一道候选题各出且仅出一条打分；id 只能取自候选里给出的短编号；' +
  'q 必须原样抄该 id 对应那道题的英文题干开头；score 与 reason 必须说的是同一道题；' +
  '每条 reason 都要独立写完整，不出现任何编号或跨条指代。' +
  '只输出 JSON 本身，不要任何说明文字，也不要 markdown 代码块。'

/**
 * 归一化题干文本用于回显比对：压平空白 + 转小写。
 * 只做保守归一化（不动标点），避免把两道仅标点不同的题误判成同一道。
 */
function normalizeFace(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * 判断模型回显的题干前缀 echo 是否确实来自候选题 en。
 * 模型可能抄多抄少，故用「短的是长的前缀」而非等长比较；过短的回显直接判否（等于没校验）。
 */
function echoMatches(echo: string, en: string): boolean {
  const a = normalizeFace(echo)
  const b = normalizeFace(en)
  if (a.length < ECHO_MIN_LEN) return false
  return a.length <= b.length ? b.startsWith(a) : a.startsWith(b)
}

/**
 * reason 会原样展示给用户，而用户看不到候选编号、也看不到别的题，
 * 所以「同q5」「同上」这类跨条指代对用户等于废话。实测 prompt 约束不住模型，必须代码兜。
 */
const UNUSABLE_REASON_RE = /\bq\d+\b|同上|同前|如上|同一题|同该题/i

/** reason 是否自足（不依赖别的候选才能读懂） */
function isReasonSelfContained(reason: string): boolean {
  return !UNUSABLE_REASON_RE.test(reason)
}

/** 一次对齐校验的结论：ok=完全对齐；否则 problems 列出人可读的错位描述 */
type AlignResult = { ok: true } | { ok: false; problems: string[] }

/**
 * 严格对齐校验：模型返回的 scores 必须与候选题一一对应。
 * 逐项查四类错位：编造 id、重复 id、q 回显与 id 对不上（真正的「贴错题」）、漏题。
 * @param items   模型返回的打分数组
 * @param seqMap  短序号 → 候选题
 * @returns       ok 或问题清单
 */
function checkAlignment(items: RankingScoreItem[], seqMap: Map<string, SeqCandidate>): AlignResult {
  const problems: string[] = []
  const covered = new Set<string>()

  for (const it of items) {
    const cand = seqMap.get(it.id)
    if (!cand) {
      problems.push(`编造 id：${it.id}（不在候选中）`)
      continue
    }
    if (covered.has(it.id)) {
      problems.push(`重复 id：${it.id}`)
      continue
    }
    covered.add(it.id)
    if (!isReasonSelfContained(it.reason)) {
      problems.push(`理由不自足：${it.id} 的 reason 指代了别的候选题——「${it.reason}」`)
    }
    if (!echoMatches(it.q, cand.en)) {
      // 顺带指出这条判词其实像是哪道题的——错位多为两两互换，指出对家能极大加速复盘
      const actual = [...seqMap.values()].find((c) => echoMatches(it.q, c.en))
      problems.push(
        `题干回显对不上：id=${it.id} 应为「${cand.en.slice(0, ECHO_PREFIX_LEN)}」，` +
          `模型回显「${it.q}」${actual ? `（实为 ${actual.id} 的题干，疑似两题判词互换）` : ''}`,
      )
    }
  }

  for (const id of seqMap.keys()) {
    if (!covered.has(id)) problems.push(`漏题：${id} 未打分`)
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}

/** 结构层类型守卫：只查字段类型，语义对齐由 checkAlignment 负责 */
function isRankingResponse(v: unknown): v is RankingResponse {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (!Array.isArray(obj.scores)) return false
  return obj.scores.every((item) => {
    if (typeof item !== 'object' || item === null) return false
    const o = item as Record<string, unknown>
    return (
      typeof o.id === 'string' &&
      typeof o.q === 'string' &&
      typeof o.score === 'number' &&
      typeof o.reason === 'string'
    )
  })
}

/**
 * 截断容错：从被截断的原始输出中抢救已完成的 score 对象。
 * callLLMJson 在两次解析均失败后调用 fallback(raw, jsonText)；
 * 若截断发生在数组中段，已完成的对象仍可用。注意这里只做结构抢救，
 * 对齐校验（q 回显）由调用方在 fallback 里逐条再过一遍，抢救不等于放行。
 */
function recoverPartialScores(raw: string): RankingScoreItem[] {
  const arrayStart = raw.indexOf('"scores"')
  if (arrayStart === -1) return []
  const bracketPos = raw.indexOf('[', arrayStart)
  if (bracketPos === -1) return []

  const content = raw.slice(bracketPos + 1)
  const results: RankingScoreItem[] = []
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
      if (
        typeof obj.id === 'string' &&
        typeof obj.q === 'string' &&
        typeof obj.score === 'number' &&
        typeof obj.reason === 'string'
      ) {
        results.push({ id: obj.id, q: obj.q, score: obj.score, reason: obj.reason })
      }
    } catch { /* 跳过格式错误的单个对象 */ }
    i = j
  }

  return results
}

/**
 * 截断抢救专用的宽松对齐：逐条过 q 回显校验，只保留对得上的，其余丢弃并告警。
 * 与严格校验的区别：允许缺项（截断本就丢尾巴），但绝不允许错位条目蒙混过关。
 * @param items   抢救出的打分数组
 * @param seqMap  短序号 → 候选题
 * @returns       对齐通过的条目（仍为短序号）
 */
function keepAligned(items: RankingScoreItem[], seqMap: Map<string, SeqCandidate>): RankingScoreItem[] {
  const kept: RankingScoreItem[] = []
  const covered = new Set<string>()
  for (const it of items) {
    const cand = seqMap.get(it.id)
    if (!cand) {
      console.error('[Ranking] 截断抢救丢弃：编造 id', { id: it.id })
      continue
    }
    if (covered.has(it.id)) {
      console.error('[Ranking] 截断抢救丢弃：重复 id', { id: it.id })
      continue
    }
    if (!echoMatches(it.q, cand.en)) {
      console.error('[Ranking] 截断抢救丢弃：题干回显对不上（疑似判词错位）', {
        id: it.id,
        expected: cand.en.slice(0, ECHO_PREFIX_LEN),
        echoed: it.q,
      })
      continue
    }
    covered.add(it.id)
    kept.push(it)
  }
  return kept
}

/**
 * 对候选题按故事贴合度打分，返回 RelevanceScore[]（id 已换回真实题目 UUID）。
 * 与模型交互一律用短序号 q1/q2/…，并强制回显题干前缀校验对齐。对齐失败的处置分两级：
 * 1) 首次输出未通过 → 整份作废，带 REALIGN_INSTRUCTION 退回模型重排一次；
 * 2) 重试仍未通过 → 走 fallback，只保留 q 回显对得上的条目，错位条目逐条 error 日志后丢弃
 *    （丢弃后该题 relevanceScore 为空，调用方按未打分处理）——宁可不给分，也不把判词贴到错的题上。
 * @param storyText   用户整理后的中文故事
 * @param candidates  候选题（id 为真实 UUID）
 * @returns           RelevanceScore[]（id 为真实 UUID）；全员错位或异常时返回 []
 * @sideEffect        调用 DashScope；对齐失败时打 error 日志
 */
export async function rankQuestions(
  storyText: string,
  candidates: CandidateQuestion[],
): Promise<RelevanceScore[]> {
  if (candidates.length === 0) return []
  if (!env.dashscopeApiKey) return []

  // 短序号 ↔ UUID 映射只活在本函数内：模型永远看不到 36 位 UUID，也就无从抄错
  const seqOf = new Map<string, string>()   // seq → 真实 UUID
  const seqMap = new Map<string, SeqCandidate>()
  const seqCandidates: SeqCandidate[] = candidates.map((c, i) => {
    const seq = `q${i + 1}`
    seqOf.set(seq, c.id)
    const sc: SeqCandidate = { id: seq, en: c.en, zh: c.zh, obs: c.obs }
    seqMap.set(seq, sc)
    return sc
  })

  const userMessage =
    `【故事】\n${storyText}\n\n【候选题】\n` +
    JSON.stringify(seqCandidates, null, 2)

  /**
   * 序号打分 → 真实 UUID 打分，兼作出厂前最后一道网：
   * 1) seqOf 必定命中（调用前已过对齐校验），不命中直接丢；
   * 2) 指代别的候选的 reason 一律清空——分数可信但这句话对用户是废话，宁可不显示理由
   *    （前端对空 reason 不渲染），也不能让「同q5」这种内部编号漏到用户眼前。
   */
  function toRelevance(items: RankingScoreItem[]): RelevanceScore[] {
    const out: RelevanceScore[] = []
    for (const it of items) {
      const realId = seqOf.get(it.id)
      if (realId === undefined) continue  // 理论不可达：对齐校验已排除编造 id
      let reason = it.reason
      if (!isReasonSelfContained(reason)) {
        console.warn('[Ranking] reason 指代了别的候选题，已清空该条理由', { id: it.id, reason })
        reason = ''
      }
      out.push({ id: realId, score: it.score, reason })
    }
    return out
  }

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
      timeoutMs: TIMEOUT_BASE_MS + TIMEOUT_PER_CANDIDATE_MS * candidates.length,
      maxAttempts: MAX_ATTEMPTS,
      // 结构守卫 + 对齐校验合流：任一不过都返回 false，交由 callLLMJson 带 REALIGN_INSTRUCTION 重试
      validate: (v): v is RankingResponse => {
        if (!isRankingResponse(v)) return false
        const aligned = checkAlignment(v.scores, seqMap)
        if (!aligned.ok) {
          console.error('[Ranking] 打分与候选题对齐校验未通过', { problems: aligned.problems })
          return false
        }
        return true
      },
      retryInstruction: REALIGN_INSTRUCTION,
      fallback: (raw) => {
        // 走到这里 = MAX_ATTEMPTS 轮整批重问都没让模型交出完整且对齐的结果。
        // 保留能对上的，缺的那几道保持无分（前端不展示分数）——但绝不静默，必须留证。
        const partial = keepAligned(recoverPartialScores(raw), seqMap)
        const missing = [...seqMap.keys()].filter((seq) => !partial.some((p) => p.id === seq))
        if (missing.length > 0) {
          console.error(`[Ranking] 已用尽 ${MAX_ATTEMPTS} 轮整批重问，仍有候选题拿不到可信打分，这些题将不展示分数`, {
            attempts: MAX_ATTEMPTS,
            totalCandidates: seqCandidates.length,
            missingCount: missing.length,
            missingQuestions: missing.map((seq) => ({ seq, en: seqMap.get(seq)?.en.slice(0, ECHO_PREFIX_LEN) })),
          })
        }
        if (partial.length > 0) {
          console.warn('[Ranking] 按对齐条目恢复', { recovered: partial.length, of: seqCandidates.length })
          return { scores: partial }
        }
        return { scores: [] }
      },
      label: '[Ranking]',
    })
    return toRelevance(result.scores)
  } catch {
    return []
  }
}
