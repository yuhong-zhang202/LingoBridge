/* Shared mock data for the LingoBridge desktop prototype */

export const DIMENSIONS = [
  { key: 'EMO', label: '情绪内核', color: '#D4875A' },
  { key: 'REL', label: '人际羁绊', color: '#7BA699' },
  { key: 'SPA', label: '空间感知', color: '#9A7DB8' },
  { key: 'SPI', label: '精神栖所', color: '#C4965A' },
  { key: 'GRO', label: '成长演进', color: '#5BA08A' },
  { key: 'VALUE', label: '价值底色', color: '#B5663A' },
] as const

export type Tier = 'high' | 'mid' | 'low'

export interface MatchedQuestion {
  id: string
  part: 'Part 1' | 'Part 2'
  title: string
  prompt: string
  score: number
  tier: Tier
  dimension: string
}

export const MATCHED_QUESTIONS: MatchedQuestion[] = [
  {
    id: 'q1',
    part: 'Part 2',
    title: 'Describe a time you helped someone',
    prompt: 'Describe a time when you helped someone. You should say who you helped, how you helped, and how you felt about it.',
    score: 92,
    tier: 'high',
    dimension: 'REL',
  },
  {
    id: 'q2',
    part: 'Part 2',
    title: 'Describe a person who inspired you',
    prompt: 'Describe a person who has had an important influence on your life and explain why.',
    score: 87,
    tier: 'high',
    dimension: 'REL',
  },
  {
    id: 'q3',
    part: 'Part 1',
    title: 'Friends',
    prompt: 'Do you prefer to spend time with a small group of friends or a large group? Why?',
    score: 71,
    tier: 'mid',
    dimension: 'EMO',
  },
  {
    id: 'q4',
    part: 'Part 2',
    title: 'A piece of good advice',
    prompt: 'Describe a piece of advice someone gave you that you found useful.',
    score: 64,
    tier: 'mid',
    dimension: 'GRO',
  },
  {
    id: 'q5',
    part: 'Part 1',
    title: 'Helping others',
    prompt: 'Do you think people today help each other as much as they did in the past?',
    score: 48,
    tier: 'low',
    dimension: 'VALUE',
  },
]

export interface FeedbackCard {
  id: string
  original: string
  improved: string
  part: string
  date: string
}

export const FEEDBACK_CARDS: FeedbackCard[] = [
  {
    id: 'f1',
    original: 'I help my friend because she is very sad and I want make her happy.',
    improved:
      'I stepped in to support my friend because she was going through a really tough time, and I genuinely wanted to lift her spirits.',
    part: 'Part 2',
    date: '6月22日',
  },
  {
    id: 'f2',
    original: 'It make me feel good and I think I do a right thing.',
    improved:
      'It left me with a warm sense of fulfilment, and looking back, I feel I made the right call.',
    part: 'Part 2',
    date: '6月22日',
  },
  {
    id: 'f3',
    original: 'We talk for long time and she feel better after.',
    improved:
      'We ended up talking for ages, and by the end of it she seemed noticeably more at ease.',
    part: 'Part 1',
    date: '6月22日',
  },
  {
    id: 'f4',
    original: 'I am not sure but maybe I can do more for help her.',
    improved:
      "I'm not entirely sure, but in hindsight there was probably more I could have done to support her.",
    part: 'Part 2',
    date: '6月22日',
  },
]

export const PHRASE_GROUPS = [
  {
    theme: '描述情绪',
    color: 'orange' as const,
    phrases: ['going through a tough time', 'lift someone’s spirits', 'a warm sense of fulfilment'],
  },
  {
    theme: '表达过程',
    color: 'green' as const,
    phrases: ['step in to support', 'talk things through', 'be there for someone'],
  },
  {
    theme: '回顾反思',
    color: 'blue' as const,
    phrases: ['looking back', 'in hindsight', 'make the right call'],
  },
]

export const SENTENCE_FRAMES = [
  '先点题：用一句话说清你帮了谁、在什么情况下。',
  '铺背景：补充时间、地点和当时对方的状态。',
  '讲行动：具体描述你做了什么，用过去时串成顺序。',
  '收感受：说说这件事带给你的体会，呼应开头。',
]

export const IELTS_QUESTIONS = [
  'Describe a time when you helped someone.',
  'Describe a place you like to relax.',
  'Describe a skill you learned that was difficult at first.',
  'Talk about a decision you made that changed your life.',
]
