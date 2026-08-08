/**
 * @module   LibraryViewTypes
 * @desc     素材库两套 UI（移动/桌面）共享的数据 props —— 由 page.tsx 统一加载后下发
 * @author   LingoBridge
 * @created  2026-07-04
 */
import type { CollectedCard } from '@/lib/types'

/** 题卡 Hero 展示所需的一句题面样本（当季用户想练的一题）。 */
export interface AnkiHeroSample {
  part: number
  text: string
}

export interface LibraryViewProps {
  cards: CollectedCard[]
  wordsCount: number
  pronCount: number
  dueCount: number
  /** 语料条数（listMyCorpus 的行数）—— 同时供页头「已攒下 N 条」的加数、「我的语料」tab 胶囊 / 移动 hub 入口卡计数。
   *  ⚠️ 口径：三处共用这一个数，不再各算各的。2026-08-08 改版前 tab 胶囊取的是【对子数】，
   *  于是 hub 说 12 条、入口卡显示 7，同一屏两个数打架，用户一眼看得出。 */
  corpusCount: number
  /** 「我的语料」tab 回上报当前语料数（加载完/删除后），用于徽标即时回落，无需刷新。tab 未挂载时不触发，徽标沿用首屏值。 */
  onCorpusCountChange?: (n: number) => void
  /** 题卡 Hero 数据（Anki 当季题卡入口，见 LibraryMobile「题卡 Hero」）—— 语义待产品方确认，见 page.tsx 注释。 */
  ankiSeasonCount: number
  ankiDueCount: number
  ankiSample: AnkiHeroSample | null
  /** 题卡 Hero 加载态：true 时 Hero 显「加载中…」，避免拉取返回前 count=0 被误判为空态。 */
  ankiLoading: boolean
}
