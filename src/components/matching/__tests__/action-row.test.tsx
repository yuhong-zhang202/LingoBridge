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

  /**
   * 取动作行容器的 class 串（它是唯一带 "flex items-center gap-* mt-3" 的元素）。
   * gap 值用 \d+ 通配而不写死：它是可调的产品参数（见下方 ② 单独钉住当前值），
   * 写死会让「调间距」和「排布走错分支」这两件事挤在同一条断言里、红了分不清是哪件。
   */
  function actionRowClass(html: string): string {
    const m = html.match(/class="(flex items-center gap-\d+ mt-3[^"]*)"/)
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

  it('② 移动端间距钉在 gap-20：再往上调会在特大字体档溢出卡片（本行无 flex-wrap）', () => {
    // 产品方要「隔约 1.5 个按钮宽」，桌面按此取 gap-44；移动端 Chip 只约 72px 宽，
    // 同样 1.5 倍是 108px，但 375px 屏卡内可用仅约 299px —— 特大字体档（1.15）下
    // 两颗涨到约 166px、间距涨到约 124px，合计 290px 只剩 4px 余量。
    // 本行【没有 flex-wrap】且 Chip 是 flex-shrink-0：一旦超宽就是直接溢出卡片，不是换行。
    // 故取 gap-20（80px，约 1.1 倍）留 36px 余量。改这个值前先重算这笔账。
    expect(actionRowClass(chipHtml)).toContain('gap-20')
    expect(actionRowClass(chipHtml)).not.toContain('flex-wrap')
  })

  it('③ 推荐提示已改为纯文字 + ✨，不再是绿色 Tag 胶囊、也不再骑边', () => {
    const recHtml = renderToStaticMarkup(
      <MatchedQuestionCard {...base} recommended practiceVariant="chip" onPracticeDirect={() => {}} />,
    )
    expect(recHtml).toContain('试试这道题吧')
    // 骑边那套已拆：绝对定位出挑、aria-hidden 视觉标签、卡内 sr-only 兜底，一个都不该再有
    expect(recHtml).not.toContain('-left-2')
    expect(recHtml).not.toContain('sr-only')
    // 绿色胶囊的底色 token 不该再出现在这条提示上（dimension / 新题 的绿标签不受影响，另在别处）
    expect(recHtml).toContain('lucide-sparkles')
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
