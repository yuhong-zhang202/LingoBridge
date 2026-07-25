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
  /** 一句话概括（≤20 字，整理时 AI 顺手产；旧语料为 null，前端按空降级）。 */
  summary: string | null
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
  season: string
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

// ── 三层漏斗匹配（matchByStory）的返回 DTO ──
// 放在中性的 types 层而非 services/matching：db 层（match-snapshots）要按此类型读写快照，
// 若定义留在 services 会形成 db→services 的反向分层依赖（仅类型、无运行时环，但属分层气味）。
// services/matching.ts 从这里 import 并 re-export，保留原 `@/services/matching` 导入路径的兼容。

/** 漏斗召回并排名后的单道题（含匹配来源标记与可选的相关性分/理由）。 */
export interface FunnelMatchedQuestion {
  id: string
  part: 1 | 2 | 3
  question_text: string
  question_text_zh: string | null
  cue_card_title: string | null
  cue_card_title_zh: string | null
  is_new: boolean
  topic_only: boolean
  matched_point: string
  pointName: string
  dimension: string
  isPrimaryMatch: boolean
  relevanceScore?: number
  relevanceReason?: string
}

/** matchByStory 的完整结果：主/副观察点 + 三层漏斗召回题 + 各层命中标记。 */
export interface FunnelMatchResult {
  primary: MatchedPoint | null
  secondary: MatchedPoint | null
  questions: FunnelMatchedQuestion[]
  count: number
  matchedViaSecondary: boolean
  /** 主/副皆空时经「邻居观察点」兜底层召回到题（第三层） */
  matchedViaNeighbor: boolean
  /** 邻居兜底层实际借用（贡献了题）的相邻观察点，按借用顺序，供前端「换个角度」文案 */
  neighborPointsUsed: MatchedPoint[]
  noMatch: boolean
}

// ── feedback 收藏 ──
export interface SessionPolish {
  original: string
  optimized: string
  note: string
  part: 1 | 2 | 3
  questionEn: string
}
export interface SavedWord {
  id: string         // 唯一 id（用词组英文本身）
  text: string       // 英文词组
  meaning: string    // 中文释义
  scene: string      // 适用场景
  group: string      // 分组标签，如「感受」
  level: string      // 收藏时的雅思水平，如「6.0」
  questionEn: string // 收藏时所在题目（英文）
  createdAt: string  // ISO 时间
}
export interface SavedPhrase extends SessionPolish {
  id: string
  createdAt: string
}
export interface SavedPronunciation {
  id: string          // 唯一 id（intended__heard 小写）
  intended: string    // 用户真正想说的词
  heard: string       // ASR 听成的词
  context: string     // 出处：这个词所在的整句
  createdAt: string   // ISO 时间
  ipaIntended?: string // AI 生成并缓存：想说词的音标
  ipaHeard?: string    // AI 生成并缓存：被听成词的音标
  tip?: string         // AI 生成并缓存：怎么念提示
}

/** 发音提示（AI 返回，缓存进 SavedPronunciation） */
export interface PronunciationTip {
  ipaIntended: string  // 想说词的音标
  ipaHeard: string     // 被听成词的音标
  tip: string          // 一段中文「怎么念」提示
}

export interface PhraseCard {
  id: string
  text: string            // 英文词组
  meaning: string         // 中文释义
  scene: string           // 适用场景
  group: string           // 分类标签（感受 / 时间 / 行为 …）
  box: number             // Leitner 盒子等级 1..5
  dueAt: string           // ISO 时间，下次复习
  lastReviewedAt: string | null
  createdAt: string       // ISO 时间
}

// ── 🔨 重新表达 ──
export interface PolishResult {
  needsWork: boolean  // 这句是否需要优化；false = 已经够好，不给改写句
  optimized: string   // 优化后的英文句子（needsWork=false 时为空字符串）
  note: string        // 一句中文说明改进点（needsWork=false 时为空字符串）
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
  level: string            // 用户在题目分析里选的目标雅思水平（如「6.0」），用于调 Lior 难度
}
export interface PracticeMessage {
  role: 'assistant' | 'user'
  content: string
}

// ── analysis 真实化 ──
export interface AnalysisFocusPoint {
  title: string
  desc: string
  /**
   * 该侧重点的英文示范例句（可选）。⚠️ 来源分两类：
   * · part3：无用户语料，例句是「通用示范论据句」，随 focusPoints 一起 pregen 静态存在此字段（方案 §10）。
   * · part1/2：例句是【基于用户中文语料 per-user 生成】的、忠料的，走 Anki 生成器（anki-answer.ts）→
   *   落 anki_cards.generated_answer（每用户各不同），【不落本字段】。故 part1/2 的 focusPoint 此字段恒空。
   */
  example?: string
}
export interface AnalysisPhrase {
  text: string       // 英文词组本身
  meaning: string    // 中文释义
  scene: string      // 适用场景：真实英语里什么场合会用到它（脱离用户故事的通用用法）
}
export interface AnalysisPhraseGroup {
  group: string      // 分组中文标签，如「时间」「原因」「感受」
  items: AnalysisPhrase[]
}
export interface QuestionAnalysis {
  structureLabel: string
  focusPoints: AnalysisFocusPoint[]
  phrases: AnalysisPhraseGroup[]
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
  /** 话题名（英文大写下划线，如 HOMETOWN）：首页雅思模式选题卡显示话题标用，展示前经 prettifyTopic 美化。 */
  topic: string
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
  service: 'doubao_asr' | 'qwen_flash' | 'qwen_plus'
  endpoint: string
  usage_amount: number
  usage_unit: 'tokens' | 'seconds'
  estimated_cost_cny: number
  latency_ms: number
  status: 'success' | 'error'
  // 归属字段（0021 补列）：各 route 手里已有的值，记费用时一并带上，供成本按用户/语料/匿名归因。
  // 均可选：无语料的调用（restructure/pronounce/polish/transcribe）corpus_id 省略；requireUser 路由无 is_anonymous。
  user_id?: string
  corpus_id?: string
  is_anonymous?: boolean
  metadata?: Record<string, unknown>
}
