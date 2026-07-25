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
  loading: boolean
  error: string | null
  onDeleteStory: (id: string) => void
  /** 静默重拉语料列表（批量删除后刷新，不翻 loading 以免卸载列表组件） */
  onRefresh: () => void
  /** 题卡 Hero 数据（Anki 当季题卡入口，见 LibraryMobile「题卡 Hero」）—— 语义待产品方确认，见 page.tsx 注释。 */
  ankiSeasonCount: number
  ankiDueCount: number
  ankiSample: AnkiHeroSample | null
  /** 题卡 Hero 加载态：true 时 Hero 显「加载中…」，避免拉取返回前 count=0 被误判为空态。 */
  ankiLoading: boolean
}
