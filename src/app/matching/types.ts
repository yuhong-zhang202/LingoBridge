/**
 * @module   MatchingViewTypes
 * @desc     题目匹配页移动/桌面两视图共享类型 —— page.tsx 外壳集中持有取数/筛选/选中/跳转逻辑
 *           （/api/matching 取数与 saveExtraction 单份、三档分组 useMemo 均在外壳）后下发，两视图纯展示。
 * @author   LingoBridge
 * @created  2026-07-09
 */
import type { MatchEarlyHint } from '@/lib/match-early-hint'
import type { MatchedPoint, DimensionLabel } from '@/lib/types'
import type { MatchPhase } from './phase'

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
  /**
   * 机制①重排整体降级：候选存在但重排一分没产出（全部题无 relevanceScore）。前端据此走「排序暂不可用·重试」
   * 降级态，与 B 类低相关展示区分。可选：流式中途骨架不带此字段（undefined→falsy），只有 done 定稿 DTO 才带真值。
   */
  rankingDegraded?: boolean
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
  /**
   * 页面形态的唯一真源（见 app/matching/phase.ts）。两端各只有一种骨架，槽位内容全部按它填。
   * 【两视图不得再自行推导形态】——本次 bug 正是同一判定写两遍、且门控条件写错造成的。
   */
  phase: MatchPhase
  result: FunnelResult | null
  /** SSE 收到 done 帧（结果定稿）。视图侧只用于 aria-busy 之类的辅助判断，形态判定一律走 phase */
  streamDone: boolean
  /** 缺少 corpusId：此时重试永远无效，error 态的文案与出口都要换成「回到首页」（F10） */
  missingCorpus: boolean
  /** 当日匹配次数用尽（服务端 429）。必须独立于 error：错误态 CTA 是「重试」，
   *  而重试只会再撞一次 429 → 死循环，故两视图须在 error 分支之前判它并渲染无重试 CTA 的提示。 */
  dailyLimitHit: boolean
  /** 本次候选总数（SSE meta 帧）。?stream=0 降级路没有 meta 帧 → null，等待期计数行整行不渲染 */
  candidateCount: number | null
  /** 已到达题数（= result.questions.length），等待期计数行的分子 */
  arrivedCount: number
  /**
   * 等待期前置提示（判据见 lib/match-early-hint）：meta 帧在重排开始【前】就到，此时「主观察点召回不足、
   * 走了邻居」或「一道都没召回」已是客观事实，如实告诉用户，别让他白等重排那约 11 秒再看到空结果。
   * null = 不提示（正常召回，以及 ?stream=0 降级路无 meta 帧的情况）。
   */
  earlyHint: MatchEarlyHint | null
  /** 低相关兜底切片（全部 < SCORE_MID，按分降序）。lowMatch 态把它们作为「确实翻遍题库了」的佐证列出 */
  lowShown: FunnelQuestion[]
  /** 强制显示 75 秒超时兜底行；仅本地 mock 演示用（生产恒 undefined，由计时器自行判定） */
  slowHint?: boolean
  /** 标题计数：≥ SCORE_MID 的总量，跨所有 Part（不受 Tab 过滤影响） */
  totalVisible: number
  /** 本次匹配【跨所有 Part】有没有高匹配（≥ SCORE_HIGH）。结果级属性，不随 Tab 变：
   *  result 态据此切「情况二·没有完美匹配的题目」的标题与说明卡（产品方 2026-08-03 定稿） */
  hasHigh: boolean
  /** 定稿后从全局排序选出的唯一推荐题；Part 筛选只控制其显隐，不得按当前 Tab 重选。 */
  recommendedId: string | null
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
  /**
   * 对某题进入【题目分析】（跳 /analysis，非 /practice）。
   * ⚠️ 原名 onPractice —— 名字与行为不符（它一直跳的是分析页），2026-08-27 两入口平权时正名。
   */
  onAnalyze: (id: string) => void
  /**
   * 对某题【直接开始练习】（跳 /practice，跳过分析页）。2026-08-27 起与「题目分析」平权。
   * 🔴 lowMatch 形态不出这个入口（那几道题一道都用不上），故两端的低相关分支在【类型上】
   *    就没有这个回调的位置（见 MatchedQuestionCard 的 Props 联合与桌面 DetailPane）。
   */
  onPracticeDirect: (id: string) => void
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
