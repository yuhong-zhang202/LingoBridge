/**
 * @module   questionBank
 * @desc     当季题库 mock 数据 — 25 道真题按六维度分类
 * @author   LingoBridge
 * @created  2026-06-01
 */
import type { BankQuestion, DimensionLabel as Dimension, DimensionSummary } from '@/lib/types'

export const BANK_QUESTIONS: BankQuestion[] = [
  // 情绪内核 ×6
  { id: 'bq1',  part: 'Part 1', dimension: '情绪内核', matched: true,  en: 'Do you often feel stressed in your daily life?' },
  { id: 'bq2',  part: 'Part 1', dimension: '情绪内核', matched: false, en: 'Are you generally an optimistic person?' },
  { id: 'bq3',  part: 'Part 2', dimension: '情绪内核', matched: true,  en: 'Describe a time when you felt very proud of yourself.' },
  { id: 'bq4',  part: 'Part 1', dimension: '情绪内核', matched: false, en: 'What makes you happy in your daily life?' },
  { id: 'bq5',  part: 'Part 3', dimension: '情绪内核', matched: false, en: 'How do people deal with negative emotions in your country?' },
  { id: 'bq6',  part: 'Part 3', dimension: '情绪内核', matched: false, en: 'Why is mental health becoming more important in modern society?' },
  // 人际羁绊 ×5
  { id: 'bq7',  part: 'Part 1', dimension: '人际羁绊', matched: true,  en: 'Are you close to your family members?' },
  { id: 'bq8',  part: 'Part 1', dimension: '人际羁绊', matched: false, en: 'Do you prefer spending time with friends or alone?' },
  { id: 'bq9',  part: 'Part 2', dimension: '人际羁绊', matched: false, en: 'Describe an important friendship in your life.' },
  { id: 'bq10', part: 'Part 2', dimension: '人际羁绊', matched: false, en: 'Describe a time when someone helped you significantly.' },
  { id: 'bq11', part: 'Part 3', dimension: '人际羁绊', matched: false, en: 'How has technology changed the way people build relationships?' },
  // 空间感知 ×4
  { id: 'bq12', part: 'Part 1', dimension: '空间感知', matched: true,  en: 'Do you often go to parks or outdoor spaces?' },
  { id: 'bq13', part: 'Part 2', dimension: '空间感知', matched: true,  en: 'Describe a place in nature that you like to visit.' },
  { id: 'bq14', part: 'Part 1', dimension: '空间感知', matched: false, en: 'What is your hometown like?' },
  { id: 'bq15', part: 'Part 3', dimension: '空间感知', matched: false, en: 'How does the living environment affect people\'s well-being?' },
  // 精神栖所 ×3
  { id: 'bq16', part: 'Part 2', dimension: '精神栖所', matched: true,  en: 'Describe a hobby or activity that helps you relax.' },
  { id: 'bq17', part: 'Part 1', dimension: '精神栖所', matched: false, en: 'Do you enjoy reading books in your free time?' },
  { id: 'bq18', part: 'Part 3', dimension: '精神栖所', matched: false, en: 'Why do people need personal space and time alone?' },
  // 成长演进 ×4
  { id: 'bq19', part: 'Part 1', dimension: '成长演进', matched: true,  en: 'What skills would you like to learn in the future?' },
  { id: 'bq20', part: 'Part 2', dimension: '成长演进', matched: false, en: 'Describe an experience that changed you significantly.' },
  { id: 'bq21', part: 'Part 3', dimension: '成长演进', matched: false, en: 'How important is lifelong learning in today\'s world?' },
  { id: 'bq22', part: 'Part 1', dimension: '成长演进', matched: false, en: 'Have you ever changed your career or study direction?' },
  // 价值底色 ×3
  { id: 'bq23', part: 'Part 1', dimension: '价值底色', matched: true,  en: 'Is honesty important in your culture?' },
  { id: 'bq24', part: 'Part 2', dimension: '价值底色', matched: false, en: 'Describe a person you admire and explain why.' },
  { id: 'bq25', part: 'Part 3', dimension: '价值底色', matched: false, en: 'How do the values of young people differ from those of older generations?' },
]

const ORDERED_DIMS: Dimension[] = ['情绪内核', '人际羁绊', '空间感知', '精神栖所', '成长演进', '价值底色']

export const DIMENSION_SUMMARIES: DimensionSummary[] = ORDERED_DIMS.map(dim => {
  const questions = BANK_QUESTIONS.filter(q => q.dimension === dim)
  const matched = questions.filter(q => q.matched).length
  return { dimension: dim, total: questions.length, matched, questions }
})
