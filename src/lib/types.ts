/**
 * @module   types
 * @desc     全局共享类型定义 — 所有业务实体的唯一类型来源（含数据库实体契约）
 * @author   LingoBridge
 * @created  2026-05-15
 */

// ── 素材库相关
export type Story = {
  id: string
  title: string
  preview: string
  date: string
  band: string
  matchCount: number
}

export type Question = {
  id: string
  part: 'Part 1' | 'Part 2' | 'Part 3'
  en: string
  zh: string
  hasStory: boolean
  storyTitle?: string
  hot?: boolean
  reason?: string
  dimension?: '情绪内核' | '人际羁绊' | '空间感知' | '精神栖所' | '成长演进' | '价值底色'
  observationPoint?: string
  frequency?: 'high' | 'low'
}

// ── 文章相关
export type WordDef = {
  phonetic: string
  meaning: string
}

// ── 反馈相关
export interface FeedbackCard {
  id: string
  questionId: string
  storyId: string
  userSentence: string
  aiSentence: string
  userAudioUrl?: string
  aiAudioUrl?: string
  createdAt: string
}

// ── 等级相关
export type BandLevel = '5.5' | '6.0' | '6.5' | '7.0'

// ── 素材库 v2
export interface CollectedCard {
  id: string
  questionId: string
  part: 'Part 1' | 'Part 2' | 'Part 3'
  topicEn: string
  originalSentence: string
  aiOptimized: string
  collectedAt: string
  keywords?: string[]
}

export interface PracticedTopic {
  id: string
  questionId: string
  part: 'Part 1' | 'Part 2' | 'Part 3'
  topicEn: string
  practiceCount: number
  collectedCount: number
  lastPracticedAt: string
}

export interface MyStory {
  id: string
  inputType: 'voice' | 'text'
  duration?: string
  content: string
  matchedCount: number
  createdAt: string
  dimension?: '情绪内核' | '人际羁绊' | '空间感知' | '精神栖所' | '成长演进' | '价值底色'
}

// ── 题库相关
/**
 * 维度的「中文显示标签」联合类型（如 '情绪内核' | '人际羁绊' | ...）。
 * 仅用于 UI 文案展示，是历史遗留命名。
 * ⚠️ 与下方数据库实体 Dimension 是两个不同的东西，请勿混用。
 */
export type DimensionLabel = '情绪内核' | '人际羁绊' | '空间感知' | '精神栖所' | '成长演进' | '价值底色'

export interface BankQuestion {
  id: string
  en: string
  part: 'Part 1' | 'Part 2' | 'Part 3'
  dimension: DimensionLabel
  matched: boolean
}

export interface DimensionSummary {
  dimension: DimensionLabel
  total: number
  matched: number
  questions: BankQuestion[]
}

// ── 数据库实体（应用层契约，camelCase；snake_case ↔ camelCase 转换留在数据层）

export type DimensionId =
  | 'emotion' | 'relationship' | 'space' | 'spirit' | 'growth' | 'value'

export type ObservationLayer =
  | 'state' | 'rhythm' | 'fluctuation' | 'mixed' | 'non_event'

/**
 * 数据库里的「维度」实体（dimensions 表的一行）。
 * ⚠️ 与上方 DimensionLabel（中文显示标签）不同：这是数据模型，不是 UI 文案。
 */
export interface Dimension {
  id: DimensionId
  name: string
  sortOrder: number
}

export interface ObservationPoint {
  id: string
  code: string
  dimensionId: DimensionId
  name: string
  layer: ObservationLayer
  mappedQuestionCount: number
  richThreshold: number
  sortOrder: number
}

export type CorpusSource = 'voice' | 'text'
export type CorpusStatus = 'draft' | 'restructured' | 'extracted'
export type LinkRole = 'primary' | 'secondary'

export interface Corpus {
  id: string
  userId: string
  source: CorpusSource
  rawText: string
  cleanedText: string | null
  audioUrl: string | null
  status: CorpusStatus
  createdAt: string   // ISO 时间字符串
  updatedAt: string
}

export interface CorpusPointLink {
  id: string
  corpusId: string
  pointId: string
  role: LinkRole
  createdAt: string
}

export type UserPlan = 'free' | 'pro'

export interface Profile {
  id: string
  plan: UserPlan
  displayName: string | null
  createdAt: string
  updatedAt: string
}

// ── 题库相关（数据库对齐，列名保持 snake_case 与 DB 一致）

export interface DBQuestion {
  id: string
  part: 1 | 2 | 3
  topic: string
  question_text: string
  question_text_zh: string | null
  cue_card_title: string | null
  cue_card_title_zh: string | null
  is_new: boolean
  topic_only: boolean
  parent_card_id: string | null
  created_at: string
}

export interface QuestionObservationLink {
  id: string
  question_id: string
  observation_point_id: string
  is_primary: boolean
}

/** 前端展示用：题目 + 关联的观察点 code 列表 */
export interface QuestionWithLinks extends DBQuestion {
  observation_points: string[]
}

// ── matching 真实化相关 ──

export interface MatchedPoint {
  pointCode: string          // 'SPA_03'
  pointName: string          // '你和所在城市/街区的关系'
  dimension: DimensionLabel  // '空间感知'
  reason: string             // 萃取理由
}

export interface MatchedQuestion {
  id: string
  part: 1 | 2 | 3
  question_text: string
  question_text_zh: string | null
  cue_card_title: string | null
  cue_card_title_zh: string | null
  is_new: boolean
  topic_only: boolean
  matched_point: string      // 命中的观察点 code
  dimension: DimensionLabel  // 该观察点所属维度（中文标签）
}

export interface MatchResult {
  primary: MatchedPoint | null
  secondary: MatchedPoint | null
  questions: MatchedQuestion[]
  count: number
}

// ── feedback 收藏 ──
export interface SessionPolish {
  original: string
  optimized: string
  note: string
  part: 1 | 2 | 3
  questionEn: string
}
export interface SavedPhrase extends SessionPolish {
  id: string
  createdAt: string
}

// ── 🔨 重新表达 ──
export interface PolishResult {
  optimized: string   // 优化后的英文句子
  note: string        // 一句中文说明改进点
}

// ── practice 对话 ──
export interface PracticeScaffold {
  part: 1 | 2 | 3
  questionForAI: string    // 喂给 AI 的完整题目（Part 2 = 完整 cue card）
  displayEn: string        // 页面头部展示用（Part 2 = 短标题）
  displayZh: string
  focusPoints: string[]    // analysis 侧重点（作对话节拍）
  part3Questions: string[] // 真实 Part 3 追问（要自然融入；Part 1 为空）
  userStory?: string       // 用户为这道题选中的真实语料（无则教练走 fallback）
}
export interface PracticeMessage {
  role: 'assistant' | 'user'
  content: string
}

// ── analysis 真实化 ──
export interface AnalysisFocusPoint {
  title: string
  desc: string
}
export interface AnalysisSentenceFrame {
  text: string   // 含 [可替换] 方括号标记
  tip?: string
}
export interface QuestionAnalysis {
  structureLabel: string
  focusPoints: AnalysisFocusPoint[]
  sentenceFrames: AnalysisSentenceFrame[]
}
export interface AnalysisResponse {
  question: {
    id: string
    part: 1 | 2 | 3
    en: string
    zh: string
    dimension: DimensionLabel | null
    isNew: boolean
  }
  analysis: QuestionAnalysis
}

/** 切换池用：首页随机切换展示的题目 */
export interface SwitchQuestion {
  id: string
  part: 1 | 2
  question_text: string
  question_text_zh: string
  cue_card_title: string | null
  cue_card_title_zh: string | null
  topic_only: boolean
  observation_points: string[]
}

// ── 题库真实数据展示类型 ──

export interface QBQuestion {
  id: string
  part: 1 | 2 | 3
  /** Part 2 取 cue_card_title（无则 question_text），其余取 question_text */
  displayText: string
  displayTextZh: string | null
  dimension: DimensionLabel
  matched: boolean
}

export interface QBDimensionSummary {
  dimension: DimensionLabel
  total: number
  matched: number
  questions: QBQuestion[]
}

// ── 相关性排名 ──
export type RelevanceScore = {
  id: string      // 候选题 id
  score: number   // 0-100，贴合度
  reason: string  // 一句话中文理由（可复用为前台"为什么推荐这道题"）
}

// ── API 用量日志 ──
export type ApiUsageLog = {
  service: 'doubao_asr' | 'qwen_flash' | 'qwen_plus' | 'claude_sonnet' | 'claude_haiku'
  endpoint: string
  usage_amount: number
  usage_unit: 'tokens' | 'seconds'
  estimated_cost_cny: number
  latency_ms: number
  status: 'success' | 'error'
  metadata?: Record<string, unknown>
}
