/**
 * @module   action-row.test
 * @desc     MatchedQuestionCard 动作行的守卫 —— 真实渲染 DOM 取证，不是读源码。
 *
 *   【为什么补这份】这个组件此前**整个零测试覆盖**，而它身上压着三条只靠注释维系的约定，
 *   全都是「改错了页面照常渲染、tsc 与既有测试全绿」的那种：
 *   ① 排布：常规态 justify-center（2026-09-01 产品方拍板，由 justify-between 改），
 *      低相关（practiceVariant='text'）态仍是 justify-end；
 *   ② 平权：两颗 Chip 的 class 串必须**逐字相同** —— 差异只许写在父容器的 justify 上。
 *      谁给左颗加个 mr-auto，两串就分叉、"平权"名存实亡；
 *   ③ 判别式必须是 `=== 'text'` 而非真值判断 —— practiceVariant 在 'chip' 形态下是可选的、
 *      实际常为 undefined，写成真值判断会让**常规态整个走错分支**。故这里刻意跑一遍
 *      「完全不传 practiceVariant」的形态，它才是线上最常见的那条路径。
 *   外加 2026-09-01 的去箭头：按钮里不许再出现 → 字符或 lucide arrow-right 的 svg。
 *
 *   断言刻意从 renderToStaticMarkup 的产物里抠 class 串与字符，而不是 import 常量对比 ——
 *   对比常量只能证明"变量没变"，证明不了它真的落到了那个 div 上。
 * @author   LingoBridge
 * @created  2026-09-01
 */
import { renderToStaticMarkup } from 'react-dom/server'
import MatchedQuestionCard from '../MatchedQuestionCard'
import type { MatchedQuestion } from '@/lib/types'

const q = {
  id: 'q1',
  part: 2,
  question_text: 'Describe a time you helped someone',
  question_text_zh: '描述一次你帮助别人的经历',
  cue_card_title: 'Describe a time you helped someone',
  cue_card_title_zh: '描述一次你帮助别人的经历',
  dimension: '人际关系',
  matched_point: 'REL_02',
  is_new: false,
} as unknown as MatchedQuestion

const base = {
  question: q,
  selected: false,
  onToggle: () => {},
  onAnalyze: () => {},
  isPrimaryMatch: true,
  isHighMatch: true,
  recommended: false,
  saveState: 'idle' as const,
  onSave: () => {},
}

describe('取证：MatchedQuestionCard 动作行', () => {
  const chipHtml = renderToStaticMarkup(
    <MatchedQuestionCard {...base} practiceVariant="chip" onPracticeDirect={() => {}} />,
  )
  const textHtml = renderToStaticMarkup(<MatchedQuestionCard {...base} practiceVariant="text" />)
  const undefHtml = renderToStaticMarkup(
    <MatchedQuestionCard {...base} onPracticeDirect={() => {}} />,
  )

  /** 取动作行容器的 class 串（它是唯一带 "flex items-center gap-2 mt-3" 的元素） */
  function actionRowClass(html: string): string {
    const m = html.match(/class="(flex items-center gap-2 mt-3[^"]*)"/)
    if (!m) throw new Error('找不到动作行容器')
    return m[1]
  }

  it('① 常规态（chip）动作行 = justify-center', () => {
    expect(actionRowClass(chipHtml)).toContain('justify-center')
    expect(actionRowClass(chipHtml)).not.toContain('justify-between')
  })

  it('① 常规态 practiceVariant 省略（undefined）时也是 justify-center，没走错分支', () => {
    expect(actionRowClass(undefHtml)).toContain('justify-center')
    // 两颗按钮都在 —— 真值判断走错分支的话这里只会剩一颗文本钮
    expect(undefHtml).toContain('题目分析')
    expect(undefHtml).toContain('开始练习')
  })

  it('① text（低相关）态仍是 justify-end', () => {
    expect(actionRowClass(textHtml)).toContain('justify-end')
  })

  it('② 两颗 Chip 的 class 串逐字相同', () => {
    const actionBtns = [...chipHtml.matchAll(/<button[^>]*aria-label="(?:题目分析|开始练习)[^"]*"[^>]*class="([^"]*)"/g)]
      .map((m) => m[1])
    expect(actionBtns).toHaveLength(2)
    expect(actionBtns[0]).toBe(actionBtns[1])
  })

  it('③ 三种形态下按钮里都没有 → 字符，也没有 lucide arrow-right 的 svg', () => {
    for (const [name, html] of [['chip', chipHtml], ['text', textHtml], ['undef', undefHtml]] as const) {
      expect({ name, has: html.includes('→') }).toEqual({ name, has: false })
      expect({ name, has: /arrow-right/i.test(html) }).toEqual({ name, has: false })
    }
  })
})
