/**
 * @module   questions
 * @desc     当季雅思口语真题数据 — matching 和 practice 页面的唯一数据来源
 * @author   LingoBridge
 * @created  2026-05-15
 */
import type { Question } from '@/lib/types'

export const QUESTIONS: Question[] = [
  {
    id: 'q1',
    part: 'Part 1',
    hasStory: false,
    hot: true,
    en: 'Do you often go to parks or outdoor spaces?',
    zh: '你经常去公园吗？',
    reason: '与你的故事相关：公园、自然、放松',
  },
  {
    id: 'q2',
    part: 'Part 2',
    hasStory: false,
    hot: true,
    en: 'Describe a place in nature you like to visit.',
    zh: '描述你喜欢的自然环境中的一个地方。',
    reason: '与你的故事相关：户外环境、情绪体验',
  },
  {
    id: 'q3',
    part: 'Part 1',
    hasStory: false,
    hot: false,
    en: 'What do you do on weekends?',
    zh: '你周末都做些什么？',
    reason: '与你的故事相关：周末活动、休闲方式',
  },
]
