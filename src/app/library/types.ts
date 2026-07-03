/**
 * @module   LibraryViewTypes
 * @desc     素材库两套 UI（移动/桌面）共享的数据 props —— 由 page.tsx 统一加载后下发
 * @author   LingoBridge
 * @created  2026-07-04
 */
import type { MyStory, CollectedCard } from '@/lib/types'

export interface LibraryViewProps {
  stories: MyStory[]
  cards: CollectedCard[]
  wordsCount: number
  pronCount: number
  dueCount: number
  loading: boolean
  error: string | null
  onDeleteStory: (id: string) => void
}
