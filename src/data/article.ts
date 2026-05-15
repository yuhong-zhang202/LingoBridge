import type { WordDef } from '@/lib/types'

// 口语文章 mock 数据（接入真实 API 后替换此处）
export const ARTICLE_TEXT = `Last weekend, I spent some time at a local park near my home. It was a genuinely refreshing experience. The air was clean and peaceful, which made me feel calm and recharged.`

// 可点击词汇释义数据
export const WORD_DEFINITIONS: Record<string, WordDef> = {
  'local':      { phonetic: '/ˈloʊkl/',        meaning: '当地的，本地的' },
  'genuinely':  { phonetic: '/ˈdʒenjuɪnli/',   meaning: '真正地，确实地' },
  'refreshing': { phonetic: '/rɪˈfreʃɪŋ/',     meaning: '令人清爽的，振奋的' },
  'peaceful':   { phonetic: '/ˈpiːsfl/',        meaning: '平静的，安详的' },
  'recharged':  { phonetic: '/ˌriːˈtʃɑːrdʒd/', meaning: '重新充满活力的' },
}
