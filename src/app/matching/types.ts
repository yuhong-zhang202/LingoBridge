/**
 * @module   MatchingViewTypes
 * @desc     题目匹配页移动/桌面两视图共享类型 —— page.tsx 外壳集中持有取数/筛选/选中/跳转逻辑
 *           （/api/matching 取数与 saveExtraction 单份、三档分组 useMemo 均在外壳）后下发，两视图纯展示。
 * @author   LingoBridge
 * @created  2026-07-09
 */
import type { MatchedPoint, DimensionLabel } from '@/lib/types'

/** 扩展 MatchedQuestion 加上漏斗信息 + 排名分（结构与原 page.tsx 内联定义一致） */
export interface FunnelQuestion {
  id: string
  part: 1 | 2 | 3
  question_text: string
  question_text_zh: string | null
  cue_card_title: string | null
  cue_card_title_zh: string | null
  is_new: boolean
  topic_only: boolean
  matched_point: string
  dimension: DimensionLabel
  isPrimaryMatch: boolean
  relevanceScore?: number
  relevanceReason?: string
  /** 该题是否已被本用户存为题卡（已存对子）。服务端按 anki_cards 是否已绑非空语料判；匿名一律 false。 */
  ankiSaved: boolean
}

export interface FunnelResult {
  primary: MatchedPoint | null
  secondary: MatchedPoint | null
  questions: FunnelQuestion[]
  count: number
  matchedViaSecondary: boolean
  noMatch: boolean
}

/**
 * SSE 首帧 meta（与服务层 FunnelStreamMeta 同形）：观察点 + 各层命中标记 + 候选总数。
 * 前端据此在题目逐条到达前先搭好 result 骨架（primary/secondary/matchedViaSecondary 供标题渲染）。
 */
export interface FunnelStreamMeta {
  primary: MatchedPoint | null
  secondary: MatchedPoint | null
  matchedViaSecondary: boolean
  matchedViaNeighbor: boolean
  candidateCount: number
}

export type PartTab = '全部' | 'Part 1' | 'Part 2'

export interface MatchingViewProps {
  result: FunnelResult | null
  loading: boolean
  error: string | null
  /** 当日匹配次数用尽（服务端 429）。必须独立于 error：错误态 CTA 是「重试」，
   *  而重试只会再撞一次 429 → 死循环，故两视图须在 error 分支之前判它并渲染无重试 CTA 的提示。 */
  dailyLimitHit: boolean
  /** 标题计数：≥ SCORE_MID 的总量，跨所有 Part（不受 Tab 过滤影响） */
  totalVisible: number
  /** 动态 Part 标签：只含有结果的 Part */
  availableTabs: PartTab[]
  activeTab: PartTab
  /** 当前 Tab 过滤后的题目（桌面筛选联动用） */
  filtered: FunnelQuestion[]
  /** 两档分组（已按 activeTab 过滤）。< SCORE_MID 不展示，故无 lowGroup */
  highGroup: FunnelQuestion[]
  midGroup: FunnelQuestion[]
  /** 折叠区（= 中匹配）题数，及是否显示「查看更多」开关 —— 自动展开时不显示 */
  foldedCount: number
  hasMore: boolean
  /** 无高匹配时中匹配自动展开（002 修复）：此时折叠区就是全部内容，不给"收起" */
  autoExpand: boolean
  /** 当前 Tab 下两档皆空 */
  noneVisible: boolean
  /** 当前选中题 id（加载时默认第一题） */
  selectedId: string | null
  /** 移动端「查看更多」折叠态 */
  expanded: boolean
  onSelectTab: (tab: PartTab) => void
  /** 移动端：点卡片切换选中（再点同一张取消变 null） */
  onToggleSelect: (id: string) => void
  /** 桌面 master-detail：点行始终选中该题（不取消，右栏永远有内容） */
  onSelect: (id: string) => void
  onToggleExpanded: () => void
  /** 对某题进入题目分析（跳 /analysis，非 /practice） */
  onPractice: (id: string) => void
  /** 已存题卡的题 id 集合（含服务端 ankiSaved 初值 + 本次会话新存的）。 */
  savedIds: Set<string>
  /** 正在存题卡的题 id（同一时刻至多一个）；null = 无进行中。 */
  savingId: string | null
  /** 存题卡（书签/右滑触发）。已存题短路、匿名 401 弹注册引导、409 弹换语料弹窗，均在外壳处理。 */
  onSavePair: (id: string) => void
  /** error 态重试（含防重入守卫） */
  onRetry: () => void
  /** 返回上一步（→ /restructure?corpusId=…）；替掉移动端 TopBar 默认 router.back() 落假故事的现网破损 */
  onBack: () => void
  /** 退出回首页（桌面 Esc / 外壳 ✕ 一致） */
  onExit: () => void
}
