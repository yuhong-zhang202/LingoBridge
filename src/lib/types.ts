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
}

// ── 文章相关
export type WordDef = {
  phonetic: string
  meaning: string
}

// ── 等级相关
export type BandLevel = '5.5' | '6.0' | '6.5' | '7.0'
