/**
 * @module   profile-form-submit-guard.test
 * @desc     「我的」页三个表单弹窗的回归守卫 —— 钉死提交按钮的 type="submit"、ExamGoalModal 的 noValidate
 *           与考试日期下限（陈旧日期不当非法）。
 *
 *           为什么要有这组测试：9609d78（2026-08-03）给共用组件 GradientButton 加了 type prop 并把默认值
 *           定成 'button'（HTML 原生默认是 'submit'，全站 CTA 多在 form 外、默认 button 是对的），
 *           但没有同步修改任何调用方。结果全站三个 <form> 的提交按钮同时退化成普通按钮、onSubmit 永不触发，
 *           用户看到的是「点了保存没任何反应」——设备考目标 / 改昵称 / 改密码三个功能一起哑掉，靠用户反馈才发现。
 *
 *           为什么 tsc / eslint / build / 既有单测全绿也抓不住：type 是可选 prop，不传在类型上完全合法；
 *           渲染出的仍是一个长得一模一样的 <button>，只是不再提交表单。这是「类型合法但语义反转」的默认值变更，
 *           静态检查没有任何抓手；埋点同样抓不住——点击时什么都没发生，连一个「失败」事件都不会上报。
 *           唯一能自动抓住它的位置，就是在这里断言渲染产物里那个按钮确实带着 type="submit"。
 *
 *           因此本文件的断言一律指向「渲染出的 HTML 行为属性」，不碰 className 等实现细节。
 * @author   LingoBridge
 * @created  2026-08-07
 */
import { renderToStaticMarkup } from 'react-dom/server'
import ExamGoalModal from '../ExamGoalModal'
import NameModal from '../NameModal'
import PasswordModal from '../PasswordModal'

// lib/auth 在模块顶层建 Supabase 客户端，跑测试时既不需要也不该真连；三个弹窗只在提交回调里用到它。
jest.mock('@/lib/auth', () => ({
  saveExamGoal: jest.fn(),
  saveDisplayName: jest.fn(),
  loginWithPassword: jest.fn(),
  updatePassword: jest.fn(),
}))

/** 今天的本地 'YYYY-MM-DD'（与 ExamGoalModal 内部同一套算法：不能用 toISOString，那是 UTC 会差一天） */
function todayLocalISO(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * 取出 markup 里 <form> 内部的片段
 * @param markup 完整渲染产物
 * @returns      首个 <form> 起始标签之后、最后一个 </form> 之前的子串
 */
function formInnerHTML(markup: string): string {
  const start = markup.indexOf('<form')
  const end = markup.lastIndexOf('</form>')
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return markup.slice(markup.indexOf('>', start) + 1, end)
}

/**
 * 列出一段 HTML 里所有 <button> 的起始标签
 * @param html HTML 片段
 * @returns    形如 '<button type="submit" ...>' 的字符串数组
 */
function buttonTags(html: string): string[] {
  return html.match(/<button\b[^>]*>/g) ?? []
}

/**
 * 取某个 input 起始标签上的属性值
 * @param markup 完整渲染产物
 * @param id     input 的 id
 * @param attr   属性名
 * @returns      属性值；标签或属性不存在时返回 null
 */
function inputAttr(markup: string, id: string, attr: string): string | null {
  const tag = markup.match(new RegExp(`<input\\b[^>]*id="${id}"[^>]*>`))?.[0]
  if (!tag) return null
  return tag.match(new RegExp(`${attr}="([^"]*)"`))?.[1] ?? null
}

const noop = (): void => {}

describe('「我的」页表单弹窗：提交按钮必须真的能提交（防 9609d78 类回归）', () => {
  it('ExamGoalModal 的「保存目标」按钮带 type="submit" —— 少了它 onSubmit 永不触发，用户点了没反应', () => {
    const markup = renderToStaticMarkup(<ExamGoalModal targetBand={null} examDate={null} onClose={noop} />)
    const tags = buttonTags(formInnerHTML(markup))
    expect(tags.filter((t) => t.includes('type="submit"'))).toHaveLength(1)
  })

  it('NameModal 的「保存昵称」按钮带 type="submit" —— 少了它改昵称整个功能哑掉', () => {
    const markup = renderToStaticMarkup(<NameModal currentName={null} onClose={noop} />)
    const tags = buttonTags(formInnerHTML(markup))
    expect(tags.filter((t) => t.includes('type="submit"'))).toHaveLength(1)
  })

  it('PasswordModal 的「保存修改」按钮带 type="submit" —— 少了它改密码整个功能哑掉', () => {
    const markup = renderToStaticMarkup(<PasswordModal email="user@example.com" onClose={noop} />)
    const tags = buttonTags(formInnerHTML(markup))
    expect(tags.filter((t) => t.includes('type="submit"'))).toHaveLength(1)
  })

  it('三个弹窗里除提交按钮外的按钮都不是 submit —— 防止有人把 type="submit" 补到别的按钮上算「修好了」', () => {
    const markups = [
      renderToStaticMarkup(<ExamGoalModal targetBand={7} examDate="2030-06-01" onClose={noop} />),
      renderToStaticMarkup(<NameModal currentName="小明" onClose={noop} />),
      renderToStaticMarkup(<PasswordModal email="user@example.com" onClose={noop} />),
    ]
    for (const markup of markups) {
      const submits = buttonTags(formInnerHTML(markup)).filter((t) => t.includes('type="submit"'))
      expect(submits).toHaveLength(1)
    }
  })
})

describe('ExamGoalModal：原生校验与日期下限（防「点了没反应」和「用户被锁死在弹窗里」）', () => {
  it('<form> 带 noValidate —— 删了它原生校验会在 submit 事件之前取消提交，又变成静默的「点了没反应」', () => {
    const markup = renderToStaticMarkup(<ExamGoalModal targetBand={null} examDate={null} onClose={noop} />)
    const formTag = markup.match(/<form\b[^>]*>/)?.[0] ?? ''
    // 大小写不敏感：HTML 属性名不区分大小写，React 版本间输出过 novalidate / noValidate 两种写法
    expect(formTag).toMatch(/\bnovalidate\b/i)
  })

  it('已存的考试日期即使已过期，日期框下限仍是那个过期日期本身 —— 陈旧≠非法，不能把用户锁死在弹窗里连目标分都改不了', () => {
    const markup = renderToStaticMarkup(<ExamGoalModal targetBand={6.5} examDate="2020-01-01" onClose={noop} />)
    expect(inputAttr(markup, 'exam-date', 'min')).toBe('2020-01-01')
    expect(inputAttr(markup, 'exam-date', 'min')).not.toBe(todayLocalISO())
  })

  it('未设过考试日期时，日期框下限是今天', () => {
    const markup = renderToStaticMarkup(<ExamGoalModal targetBand={null} examDate={null} onClose={noop} />)
    expect(inputAttr(markup, 'exam-date', 'min')).toBe(todayLocalISO())
  })

  it('已存的考试日期在未来时，日期框下限是今天（不会被抬到那个未来日期，否则用户没法改早）', () => {
    const markup = renderToStaticMarkup(<ExamGoalModal targetBand={7} examDate="2030-06-01" onClose={noop} />)
    expect(inputAttr(markup, 'exam-date', 'min')).toBe(todayLocalISO())
  })
})
