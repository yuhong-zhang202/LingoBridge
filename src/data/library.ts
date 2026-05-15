import type { Story, Question } from '@/lib/types'

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
