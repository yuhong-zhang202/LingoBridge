/**
 * @module   matching
 * @desc     /matching 页面 mock 数据 — 语料价值维度与匹配题目
 * @author   LingoBridge
 * @created  2026-05-28
 */

export type DimensionColor = 'orange' | 'green' | 'gray'

export type Dimension = {
  label: string
  color: DimensionColor
}

export type MatchQuestion = {
  id: string
  part: 'Part 1' | 'Part 2' | 'Part 3'
  en: string
  zh: string
  hot?: boolean
  related: string[]
}

export const DIMENSIONS: Dimension[] = [
  { label: '情绪变化', color: 'orange' },
  { label: '放松体验', color: 'orange' },
  { label: '自然环境', color: 'green' },
  { label: '观察他人', color: 'green' },
  { label: '独处时光', color: 'gray' },
]

export const MATCH_QUESTIONS: MatchQuestion[] = [
  {
    id: 'mq1',
    part: 'Part 1',
    hot: true,
    en: 'Do you often go to parks or outdoor spaces?',
    zh: '你经常去公园吗？',
    related: ['自然环境', '情绪变化'],
  },
  {
    id: 'mq2',
    part: 'Part 2',
    hot: true,
    en: 'Describe a place in nature you like to visit.',
    zh: '描述一个你喜欢的自然环境。',
    related: ['放松体验', '自然环境'],
  },
  {
    id: 'mq3',
    part: 'Part 1',
    en: 'What do you do on weekends?',
    zh: '你周末都做些什么？',
    related: ['独处时光', '放松体验'],
  },
  {
    id: 'mq4',
    part: 'Part 3',
    en: 'Why do people need time alone in nature?',
    zh: '为什么人们需要独处于自然中？',
    related: ['独处时光', '放松体验'],
  },
  {
    id: 'mq5',
    part: 'Part 2',
    en: 'Describe a time when you felt relaxed.',
    zh: '描述一次你感到放松的经历。',
    related: ['情绪变化', '放松体验'],
  },
]
