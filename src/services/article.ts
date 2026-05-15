/**
 * @module   article
 * @desc     口语文章生成服务 — 当前返回 mock 数据，接入 AI API 时只需替换此实现
 * @author   LingoBridge
 * @created  2026-05-15
 */
import { ARTICLE_TEXT } from '@/data/article'
import type { BandLevel, FeedbackCard, Question } from '@/lib/types'

/**
 * 根据故事文本和目标等级生成口语文章
 * @param storyText  用户原始故事内容
 * @param band       目标雅思口语等级
 * @returns          生成的口语文章文本
 */
export async function generateArticle(storyText: string, band: BandLevel): Promise<string> {
  return ARTICLE_TEXT
}

/**
 * 根据用户回答和题目生成反馈卡片
 * @param userSentence  用户的口语回答
 * @param question      对应的练习题目
 * @returns             生成的反馈卡片
 */
export async function generateFeedback(userSentence: string, question: Question): Promise<FeedbackCard> {
  return {
    id: `fb_${Date.now()}`,
    questionId: question.id,
    storyId: '1',
    userSentence,
    aiSentence: 'I genuinely enjoy spending time in nature — it helps me recharge.',
    createdAt: new Date().toISOString(),
  }
}
