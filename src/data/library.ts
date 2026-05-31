import type { Story, Question, CollectedCard, PracticedTopic, MyStory } from '@/lib/types'

export const MY_STORIES: Story[] = [
  {
    id: '1',
    title: '公园的周末',
    preview: '上周末我去了附近的公园，空气很好...',
    date: '昨天',
    band: '6.0',
    matchCount: 3,
  },
  {
    id: '2',
    title: '工作的烦恼',
    preview: '今天开会又迟到了，被经理说了一顿...',
    date: '3天前',
    band: '6.5',
    matchCount: 2,
  },
  {
    id: '3',
    title: '和朋友的晚餐',
    preview: '昨晚和大学同学聚餐，去了一家新开的...',
    date: '5天前',
    band: '6.0',
    matchCount: 4,
  },
]

export const QUESTIONS_BY_PART: Record<string, Question[]> = {
  'Part 1': [
    {
      id: 'q1',
      part: 'Part 1',
      en: 'Do you often go to parks or outdoor spaces?',
      zh: '你经常去公园吗？',
      hasStory: true,
      storyTitle: '公园的周末',
    },
    {
      id: 'q2',
      part: 'Part 1',
      en: 'What outdoor activities do you enjoy?',
      zh: '你喜欢哪些户外活动？',
      hasStory: false,
    },
    {
      id: 'q3',
      part: 'Part 1',
      en: 'Do you prefer working indoors or outdoors?',
      zh: '你更喜欢在室内还是室外工作？',
      hasStory: false,
    },
  ],
  'Part 2': [
    {
      id: 'q4',
      part: 'Part 2',
      en: 'Describe a place in nature you like to visit.',
      zh: '描述你喜欢的自然场所。',
      hasStory: true,
      storyTitle: '公园的周末',
    },
    {
      id: 'q5',
      part: 'Part 2',
      en: 'Describe a time when you felt relaxed.',
      zh: '描述一次你感到放松的经历。',
      hasStory: false,
    },
  ],
  'Part 3': [
    {
      id: 'q6',
      part: 'Part 3',
      en: 'Why do people need green spaces in cities?',
      zh: '为什么城市需要绿色空间？',
      hasStory: false,
    },
  ],
}

export const COLLECTED_CARDS: CollectedCard[] = [
  {
    id: 'cc1',
    questionId: 'q1',
    part: 'Part 1',
    topicEn: 'Do you often go to parks or outdoor spaces?',
    originalSentence: 'I went to park yesterday, very happy.',
    aiOptimized: 'I visited a local park yesterday, which left me feeling genuinely refreshed.',
    collectedAt: '5/28',
    keywords: ['park', 'nature'],
  },
  {
    id: 'cc2',
    questionId: 'q4',
    part: 'Part 2',
    topicEn: 'Describe a place in nature you like to visit.',
    originalSentence: 'The park near my home is very beautiful and I like going there.',
    aiOptimized: 'The park near my home has become my favourite sanctuary — it offers a perfect blend of greenery and tranquillity.',
    collectedAt: '5/26',
    keywords: ['outdoor', 'relaxation'],
  },
]

export const PRACTICED_TOPICS: PracticedTopic[] = [
  {
    id: 'pt1',
    questionId: 'q1',
    part: 'Part 1',
    topicEn: 'Do you often go to parks or outdoor spaces?',
    practiceCount: 3,
    collectedCount: 2,
    lastPracticedAt: '5/28',
  },
  {
    id: 'pt2',
    questionId: 'q4',
    part: 'Part 2',
    topicEn: 'Describe a place in nature you like to visit.',
    practiceCount: 1,
    collectedCount: 1,
    lastPracticedAt: '5/26',
  },
]

export const MY_STORIES_NEW: MyStory[] = [
  {
    id: 's1',
    inputType: 'voice',
    duration: '1:24',
    content: '上周末我去了附近的公园，空气很好，心情也轻松了很多。待了很长时间，感觉充了电一样。偶尔看到几个孩子在玩耍，让我想起了小时候的时光。',
    matchedCount: 3,
    createdAt: '5/28',
  },
  {
    id: 's2',
    inputType: 'text',
    content: '今天在公司加班到很晚，回家路上看到夜空特别清澈，心情突然就好了。有时候一件小事就能改变一天的心情。',
    matchedCount: 2,
    createdAt: '5/25',
  },
]
