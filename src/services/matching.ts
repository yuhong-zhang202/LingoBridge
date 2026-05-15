/**
 * @module   matching
 * @desc     题目匹配服务 — 当前返回 mock 数据，接入 Gemini API 时只需替换此实现
 * @author   LingoBridge
 * @created  2026-05-15
 */
import type { Question } from '@/lib/types'

/**
 * 根据故事文本从题库中匹配相关题目
 * @param storyText  用户故事文本
 * @param questions  候选题目列表
 * @returns          匹配到的题目 ID 列表，按相关度排序
 */
export async function matchQuestions(storyText: string, questions: Question[]): Promise<string[]> {
  return questions.map(q => q.id)
}
