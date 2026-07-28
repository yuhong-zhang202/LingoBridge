/**
 * @module   LibraryViewTypes
 * @desc     素材库两套 UI（移动/桌面）共享的数据 props —— 由 page.tsx 统一加载后下发
 * @author   LingoBridge
 * @created  2026-07-04
 */
import type { MyStory, CollectedCard } from '@/lib/types'

/** 题卡 Hero 展示所需的一句题面样本（当季用户想练的一题）。 */
export interface AnkiHeroSample {
  part: number
  text: string
}

export interface LibraryViewProps {
  stories: MyStory[]
  cards: CollectedCard[]
  wordsCount: number
  pronCount: number
  dueCount: number
  /** 当季对子数（anki_cards 里 corpusId 非空且已答的卡，与「语料匹配」tab answered 口径一致）—— 供 tab 胶囊 / 移动 hub 入口卡计数。 */
  pairCount: number
  /** 「语料匹配」tab 回上报当前对子数（加载完/删除后），用于徽标即时回落，无需刷新。tab 未挂载时不触发，徽标沿用首屏派生值。 */
  onCorpusCountChange?: (n: number) => void
  /** 题卡 Hero 数据（Anki 当季题卡入口，见 LibraryMobile「题卡 Hero」）—— 语义待产品方确认，见 page.tsx 注释。 */
  ankiSeasonCount: number
  ankiDueCount: number
  ankiSample: AnkiHeroSample | null
  /** 题卡 Hero 加载态：true 时 Hero 显「加载中…」，避免拉取返回前 count=0 被误判为空态。 */
  ankiLoading: boolean
}
