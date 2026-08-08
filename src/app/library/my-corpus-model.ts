/**
 * @module   my-corpus-model
 * @desc     素材库「我的语料」tab 的纯逻辑层 —— 语料与对子的合并、筛选、计数、列表状态判定、删除确认文案。
 *           这里刻意不含任何 JSX / React / 网络调用：本 tab 的产品性质（一条语料一张卡、未绑题的也要出现、
 *           三档筛选、四档空态、确认框知情点）全部落在本文件的纯函数上，可被单测直接钉死。
 *
 *           口径要点（改动前务必读）：
 *           - 列表单位是「语料」而不是「对子」。同一条语料绑 3 道题时只产生 1 个 MyCorpusItem，
 *             3 道题收进 item.questions。改回按对子铺卡会让「删这张卡」与「删这条语料」重新错位
 *             （旧实现里点一张卡会连带消失 3 张，界面事先毫无预告）。
 *           - 未绑题的语料同样是 item，只是 questions 为空 —— 那正是本次改版要解决的用户诉求
 *             （「我录了故事，素材库里却找不到」）。
 * @author   LingoBridge
 * @created  2026-08-08
 */
import type { AnkiCard } from '@/lib/anki/list'
import type { Corpus, CorpusSource } from '@/lib/types'

/** 语料绑上的一道题（对子在卡内的展示形态）。 */
export interface BoundQuestion {
  questionId: string
  part: 1 | 2 | 3
  /** 展示用题面：Part2 优先 cue card 标题（更贴合该题问法），其余用题面本身。 */
  title: string
  topic: string
  /** 卡背是否已就绪（可直接练/看）；否则是生成中。 */
  backReady: boolean
}

/** 「我的语料」列表的一项 = 一条语料 + 它绑上的题目。 */
export interface MyCorpusItem {
  /** corpusId —— 同时是列表项 id 与删除目标 id，「删这张卡 = 删这条语料」是字面真理。 */
  id: string
  source: CorpusSource
  /** 正文：整理后的文本优先，没有则原始转写。 */
  text: string
  /** 一句话概括（旧语料为 null）。 */
  summary: string | null
  /** ISO 时间字符串（展示层再转相对时间）。 */
  createdAt: string
  questions: BoundQuestion[]
}

/** 筛选三档：全部 / 已结对 / 还没绑题目。 */
export type CorpusFilter = 'all' | 'paired' | 'unpaired'

/**
 * 列表当前该渲染什么。四档空态互斥，判定集中在这里，避免组件里散落一堆 && 条件后被改乱。
 * - loading：骨架屏（「一条都没有」必须等加载完再判，否则 loading 期的 0 条会闪出空态）
 * - error：错误 / 离线
 * - empty-no-corpus：一条语料都没有
 * - empty-search：搜索无结果
 * - empty-paired：筛选「已结对」为空
 * - empty-unpaired：筛选「还没绑题目」为空
 * - list：正常列表
 */
export type CorpusListState =
  | 'loading'
  | 'error'
  | 'empty-no-corpus'
  | 'empty-search'
  | 'empty-paired'
  | 'empty-unpaired'
  | 'list'

/** resolveListState 的输入。 */
export interface CorpusListStateInput {
  loading: boolean
  error: boolean
  /** 语料总数（已扣除待删项）—— 只看这个判「一条都没有」，与搜索/筛选无关。 */
  totalCount: number
  /** 搜索词是否非空。 */
  searching: boolean
  filter: CorpusFilter
  /** 经搜索 + 筛选后的可见项数。 */
  visibleCount: number
}

/**
 * 对子展示用题面：Part2 用 cue card 标题，其余用题面本身
 * @param card  anki 卡
 * @returns     题面字符串
 */
export function pairTitle(card: AnkiCard): string {
  if (card.part === 2 && card.cueCardTitle) return card.cueCardTitle
  return card.questionText
}

/**
 * 卡背是否已就绪（可直接练/看）；其余（analysis）= 生成中
 * @param card  anki 卡
 * @returns     true = 已生成或用户已编辑
 */
export function isBackReady(card: AnkiCard): boolean {
  return card.backKind === 'generated' || card.backKind === 'edited'
}

/**
 * 把「全部语料」和「已绑对子」合并成一条语料一项的列表
 * @param corpus  listMyCorpus() 的全部语料
 * @param cards   fetchAnkiCards 拿到的已答卡（含未绑语料的，内部按 corpusId 过滤）
 * @returns       按 createdAt 倒序的列表；未绑题的语料 questions 为空数组（默认混排，不置顶分区）
 */
export function mergeCorpusWithCards(corpus: Corpus[], cards: AnkiCard[]): MyCorpusItem[] {
  const byCorpusId = new Map<string, BoundQuestion[]>()
  for (const card of cards) {
    if (card.corpusId === null) continue
    const list = byCorpusId.get(card.corpusId) ?? []
    // 同一题在 part1/part2 两次拉取里不会重复出现，但兜一层去重，防上游口径变动后卡内出现两枚同题 chip
    if (list.some((q) => q.questionId === card.questionId)) continue
    list.push({
      questionId: card.questionId,
      part: card.part,
      title: pairTitle(card),
      topic: card.topic,
      backReady: isBackReady(card),
    })
    byCorpusId.set(card.corpusId, list)
  }

  return corpus
    .map((c) => ({
      id: c.id,
      source: c.source,
      text: c.cleanedText ?? c.rawText,
      summary: c.summary,
      createdAt: c.createdAt,
      questions: byCorpusId.get(c.id) ?? [],
    }))
    // 时间倒序：用户的检索线索是「我什么时候讲的那段」，时间序最省认知。
    // listMyCorpus 已按 created_at 倒序，这里显式再排一次，让顺序不依赖上游实现细节。
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

/**
 * 一项的可搜文本（大小写不敏感匹配交 makeSearchFilter）
 * @param item  列表项
 * @returns     正文 + 概括 + 各题题面 + 话题拼成的一串
 * @remarks     正文必须在内：用户搜自己的故事时，脑子里是原话，不是 AI 写的概括。
 */
export function itemSearchText(item: MyCorpusItem): string {
  return [
    item.text,
    item.summary ?? '',
    ...item.questions.map((q) => `${q.title} ${q.topic}`),
  ].join(' ')
}

/**
 * 一项是否落在某个筛选档里
 * @param item    列表项
 * @param filter  筛选档
 * @returns       是否可见
 */
export function matchesFilter(item: MyCorpusItem, filter: CorpusFilter): boolean {
  if (filter === 'paired') return item.questions.length > 0
  if (filter === 'unpaired') return item.questions.length === 0
  return true
}

/**
 * 三档筛选各自的条数（供筛选 Chip 显示）
 * @param items  参与计数的列表项（调用方应先按搜索过滤，让计数与「你现在能看到几条」一致）
 * @returns      { all, paired, unpaired }
 */
export function countByFilter(items: MyCorpusItem[]): { all: number; paired: number; unpaired: number } {
  const paired = items.filter((it) => it.questions.length > 0).length
  return { all: items.length, paired, unpaired: items.length - paired }
}

/**
 * 判定列表当前该渲染哪一档
 * @param input  加载 / 错误 / 总数 / 搜索 / 筛选 / 可见数
 * @returns      CorpusListState
 */
export function resolveListState(input: CorpusListStateInput): CorpusListState {
  // loading 优先于一切：loading 期 totalCount 恒为 0，先判空态会闪出「还没有你的语料」
  if (input.loading) return 'loading'
  if (input.error) return 'error'
  if (input.totalCount === 0) return 'empty-no-corpus'
  if (input.visibleCount > 0) return 'list'
  // 搜索优先于筛选：用户刚敲完字，最该被告知的是「这个词没搜到」
  if (input.searching) return 'empty-search'
  if (input.filter === 'paired') return 'empty-paired'
  if (input.filter === 'unpaired') return 'empty-unpaired'
  return 'list'
}

/**
 * 单条删除的确认描述
 * @param boundCount  这条语料当前绑着的题数
 * @returns           确认框正文
 * @remarks           绑了题才提「卡背清空（含你手动编辑过的内容）」—— 那是 2026-08-07 补的知情点
 *                    （deleteCorpus 走 0060 事务型 RPC，会连用户亲手改过的答案一起清）。
 *                    没绑题的语料不存在卡背，硬塞这句只会让用户以为自己要丢别的东西。
 */
export function deleteConfirmDescription(boundCount: number): string {
  const head = '删掉的是你讲的那段经历本身，删除后没法找回。'
  if (boundCount === 0) return head
  return `${head}正用着它的 ${boundCount} 道题会变回「还没绑语料」、卡背清空（含你手动编辑过的内容），题卡和你的复习进度都还在。`
}

/**
 * 桌面批量删除的确认描述
 * @param total       本次要删的语料条数
 * @param boundTotal  其中绑着题的条数
 * @returns           确认框正文
 */
export function bulkDeleteConfirmDescription(total: number, boundTotal: number): string {
  const head = total === 1
    ? '删掉的是你讲的那段经历本身，删除后没法找回。'
    : '删掉的是你讲的那几段经历本身，删除后没法找回。'
  if (boundTotal === 0) return head
  return `${head}其中 ${boundTotal} 条正被题目用着，那些题会变回「还没绑语料」、卡背清空（含你手动编辑过的内容）。`
}
