/**
 * @module   matching-mock
 * @desc     匹配页各状态的本地演示数据（【仅开发环境】）。产品方要求「先用 mock 数据在本地过一遍再推 main」，
 *           而零贴合、真没题、重排降级这几个状态在真实环境里极难稳定复现（要凑出匹配不上的语料 + 等 50 秒），
 *           故用 URL 参数直接点播状态：`/matching?corpusId=preview&uiState=<state>`。
 *           取值与 MatchPhase 一一对应，另加两个变体：waitingSlow（75 秒超时兜底）、resultNoHigh（无高匹配）。
 *
 *   🔴【生产不可达】唯一入口 getMockUiState 第一行就判 NODE_ENV，生产恒返回 null。
 *     判断写成 `process.env.NODE_ENV !== 'development'` 是刻意的：Next.js 构建时把它内联成字面量，
 *     生产 bundle 里整个函数体连同下面所有假数据会被 DCE 清掉，不只是运行时拦住而已。
 *     ⚠️ 改这行判断前先想清楚：任何让它在生产为真的写法（读 window、读 localStorage、读 cookie），
 *     都等于给线上开了一个「伪造匹配结果」的后门。
 *
 *   ⚠️ 本模块【只造展示层数据】，不碰判分：分数是手写的常量，刻意贴着 SCORE_HIGH(85) / SCORE_MID(60)
 *     两条线取值，好让每个场景稳定落进目标分档。改阈值时这里的数字要跟着核对，否则场景会串档。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
import type { FunnelQuestion, FunnelResult } from '@/app/matching/types'
import type { MatchedPoint } from '@/lib/types'

/**
 * 可点播的 UI 状态。名字即 URL 参数值：`?uiState=lowMatch`。
 * 八个与 MatchPhase 同名，外加两个变体：
 * - `waitingSlow`：伪造已等过 75 秒，验超时兜底行 + 重新匹配出口（否则本地要真干等 75 秒）
 * - `resultNoHigh`：一道高匹配都没有、中匹配自动展开，覆盖台账 002 那条「标题说有 N 道、屏幕上零张卡」的坑
 */
export type MockUiState =
  | 'waiting' | 'waitingSlow' | 'streaming' | 'result' | 'resultNoHigh'
  | 'lowMatch' | 'noMatch' | 'degraded' | 'error' | 'limit'

/** 演示用观察点（取产品方实测那次的真实取值，好和他截图对得上） */
const PRIMARY: MatchedPoint = {
  dimension: '人际羁绊',
  pointCode: 'REL_11',
  pointName: '一次关系摩擦或冲突',
  reason: '你花了大半段在讲那次争执怎么起来的、后来怎么收场，这是整段故事的重心。',
}

/**
 * 造一道演示题。
 * @param i      序号（用于生成稳定的假 id 与题面）
 * @param score  相关性分（决定它落进高/中/低哪一档）
 * @param part   Part 1 或 Part 2
 * @param en     英文题面
 * @param zh     中文题面
 * @returns      一道形状完整的演示题
 */
function q(i: number, score: number, part: 1 | 2, en: string, zh: string): FunnelQuestion {
  return {
    id: `mock-${i}`,
    part,
    question_text: en,
    question_text_zh: zh,
    cue_card_title: part === 2 ? en : null,
    cue_card_title_zh: part === 2 ? zh : null,
    is_new: i === 2,
    topic_only: false,
    matched_point: PRIMARY.pointCode,
    dimension: '人际羁绊',
    isPrimaryMatch: score >= 60,
    relevanceScore: score,
    relevanceReason:
      score >= 60
        ? '你讲的这段冲突里有明确的对象和转折，正好是这道题要的材料。'
        : '这道题问的是这段关系里的正面部分，而你的故事讲的是摩擦，方向对不上。',
    ankiSaved: false,
  }
}

// ⚠️ 下面三组题目【刻意写成工厂函数而不是顶层常量数组】：顶层数组的初始化会调用 q()，
// webpack 无法证明该调用无副作用，于是整个模块（连同所有假数据字符串）会被留在生产 bundle 里 ——
// 虽然通路已不可达，但那不符合「整段被 DCE 清掉」的要求。改成函数后模块顶层只剩纯声明，
// 生产里没人调用即被完整摇掉。（改动前后用 grep .next/static 实测过。）

/** 五道低相关题（全部 < SCORE_MID），复刻产品方实测那次的题目，便于对照 */
const lowQuestions = (): FunnelQuestion[] => [
  q(1, 52, 2, 'A Helpful Person', '一个经常帮助别人的人'),
  q(2, 48, 2, 'A Childhood Friend', '你的发小'),
  q(3, 45, 2, 'A Friend Who Loves Drawing', '一个喜欢画画的朋友'),
  q(4, 41, 1, 'What gift have you received recently?', '你最近收到过什么礼物'),
  q(5, 38, 1, 'Do you like making new friends?', '你喜欢结交新朋友吗'),
]

/** 正常态：两道高匹配 + 两道中匹配 + 一道低相关（低的那道验证它确实不出现在列表里） */
const normalQuestions = (): FunnelQuestion[] => [
  q(1, 92, 2, 'A Disagreement You Had With Someone', '一次和别人的分歧'),
  q(2, 88, 2, 'A Person You Once Argued With', '一个你曾经争论过的人'),
  q(3, 74, 2, 'A Time You Apologised To Someone', '一次你向别人道歉的经历'),
  q(4, 66, 1, 'Do you often disagree with your friends?', '你经常和朋友意见不合吗'),
  q(5, 43, 1, 'Do you like making new friends?', '你喜欢结交新朋友吗'),
]

/** 无高匹配态：全部落在 [SCORE_MID, SCORE_HIGH)，中匹配组应自动展开（台账 002） */
const midOnlyQuestions = (): FunnelQuestion[] => [
  q(1, 78, 2, 'A Time You Apologised To Someone', '一次你向别人道歉的经历'),
  q(2, 71, 2, 'A Person Who Once Misunderstood You', '一个曾经误解过你的人'),
  q(3, 64, 1, 'Do you often disagree with your friends?', '你经常和朋友意见不合吗'),
]

/**
 * 一个演示场景的完整形态：它就是「取数 effect 跑完之后，页面本该持有的那组 state」。
 * 字段与 page.tsx 的 state 一一对应，接入处只是把它们灌进去，不走任何特殊渲染分支。
 */
export interface MockUiScenario {
  /** 全量题目（按 arrivalIntervalMs 逐条到达）；null = 连骨架都没有（error 态） */
  result: FunnelResult | null
  /** 对应 page.tsx 的 streamDone。false = 流式未定稿，页面应当呈现等待中 */
  settled: boolean
  /** 对应 page.tsx 的 error */
  error: string | null
  /** 对应 page.tsx 的 dailyLimitHit（429） */
  dailyLimitHit: boolean
  /** 对应 page.tsx 的 candidateCount（SSE meta 帧）；null = 无此信号，计数行整行不渲染 */
  candidateCount: number | null
  /** 强制显示 75 秒超时兜底行（免去本地真干等 75 秒） */
  slowHint: boolean
  /** 首帧就给出的题数；其余按 arrivalIntervalMs 逐条追加 */
  initialCount: number
  /** 题目逐条到达的间隔（毫秒）；0 = 一次性给全 */
  arrivalIntervalMs: number
}

/** 定稿场景的公共默认值 */
const SETTLED = {
  settled: true,
  error: null,
  dailyLimitHit: false,
  slowHint: false,
  arrivalIntervalMs: 0,
} as const

/**
 * 取某个 UI 状态的演示场景。
 * @param s 状态名
 * @returns 该状态下页面应当持有的那组 state
 */
function build(s: MockUiState): MockUiScenario {
  const base = { primary: PRIMARY, secondary: null, matchedViaSecondary: false }
  const LOW_QUESTIONS = lowQuestions()
  const NORMAL_QUESTIONS = normalQuestions()
  const MID_ONLY_QUESTIONS = midOnlyQuestions()
  const full = (qs: FunnelQuestion[], extra: Partial<FunnelResult> = {}): FunnelResult =>
    ({ ...base, questions: qs, count: qs.length, noMatch: false, rankingDegraded: false, ...extra })

  switch (s) {
    // 等待态：题在逐条到达，但全部低于 SCORE_MID 且【永不定稿】——totalVisible 恒为 0。
    // 这正是产品方撞到问题的那个区间（真实环境里持续了约 50 秒）：
    // 旧代码在这里显示「匹配到 0 道当季真题」+ 空白左栏，新骨架必须显示等待中的骨架卡。
    case 'waiting':
      return { ...SETTLED, settled: false, result: full(LOW_QUESTIONS), candidateCount: 12, initialCount: 0, arrivalIntervalMs: 1500 }
    case 'waitingSlow':
      return { ...SETTLED, settled: false, result: full(LOW_QUESTIONS), candidateCount: 12, initialCount: 3, arrivalIntervalMs: 0, slowHint: true }
    // 流式中：已有可见题、仍未定稿。首帧先给 1 道，其余每 1.5 秒追加一道，标题数字会自己往上跳。
    case 'streaming':
      return { ...SETTLED, settled: false, result: full(NORMAL_QUESTIONS), candidateCount: 12, initialCount: 1, arrivalIntervalMs: 1500 }
    case 'result':
      return { ...SETTLED, result: full(NORMAL_QUESTIONS), candidateCount: 12, initialCount: NORMAL_QUESTIONS.length }
    case 'resultNoHigh':
      return { ...SETTLED, result: full(MID_ONLY_QUESTIONS), candidateCount: 9, initialCount: MID_ONLY_QUESTIONS.length }
    case 'lowMatch':
      return { ...SETTLED, result: full(LOW_QUESTIONS), candidateCount: 12, initialCount: LOW_QUESTIONS.length }
    case 'noMatch':
      return { ...SETTLED, result: full([], { noMatch: true }), candidateCount: 0, initialCount: 0 }
    // 降级 = 候选存在但一分没产出：题带过来了，relevanceScore 全部缺失
    case 'degraded':
      return {
        ...SETTLED,
        result: full(LOW_QUESTIONS.map((x) => ({ ...x, relevanceScore: undefined, relevanceReason: undefined })), { rankingDegraded: true }),
        candidateCount: 12,
        initialCount: LOW_QUESTIONS.length,
      }
    case 'error':
      return { ...SETTLED, result: null, error: '匹配失败', candidateCount: null, initialCount: 0 }
    case 'limit':
      return { ...SETTLED, result: null, dailyLimitHit: true, candidateCount: null, initialCount: 0 }
  }
}

const VALID: readonly MockUiState[] = [
  'waiting', 'waitingSlow', 'streaming', 'result', 'resultNoHigh',
  'lowMatch', 'noMatch', 'degraded', 'error', 'limit',
] as const

/**
 * 从 URL 的 `?uiState=` 取演示场景。**生产环境恒返回 null**（理由见顶注）。
 * @param raw `?uiState=` 的原始值（无参传 null）
 * @returns   命中的演示场景；非开发环境、无参数、参数不认识时一律 null（调用方据此走真实取数）
 */
export function getMockUiState(raw: string | null): MockUiScenario | null {
  if (process.env.NODE_ENV !== 'development') return null
  if (!raw) return null
  const s = VALID.find((v) => v === raw)
  return s ? build(s) : null
}

/** 演示场景清单（供本地验收时逐个点开核对，也用于给产品方列 URL） */
export const MOCK_UI_STATES: ReadonlyArray<{ key: MockUiState; label: string }> = [
  { key: 'waiting',      label: '等待中（题在到达，但一道可见的都没有）' },
  { key: 'waitingSlow',  label: '等待超时（已等过 75 秒，出兜底行 + 重新匹配）' },
  { key: 'streaming',    label: '流式中（已有可见题，仍在继续找）' },
  { key: 'result',       label: '正常结果（高 2 + 中 2）' },
  { key: 'resultNoHigh', label: '正常结果·无高匹配（中匹配自动展开）' },
  { key: 'lowMatch',     label: '没有能用的题（列出最接近的几道作佐证）' },
  { key: 'noMatch',      label: '题库里真的一道都没有' },
  { key: 'degraded',     label: '排序降级（题有、分没算出来）' },
  { key: 'error',        label: '请求失败' },
  { key: 'limit',        label: '当日次数用完（429）' },
] as const
