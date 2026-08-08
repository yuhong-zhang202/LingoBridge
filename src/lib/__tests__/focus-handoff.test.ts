/**
 * @module   focus-handoff.test
 * @desc     删卡后「焦点落到哪张卡」的落点规则单测（2026-08-08 修复配套）。
 *
 *           这一组是【行为】测试：真跑 pickFocusTarget、断言它选中的那一项。规则本身抽成不碰 document
 *           的纯函数，正是为了能在本仓库这个没有 DOM 的 jest（testEnvironment: 'node'）里测到 ——
 *           留在组件里就只能读源码守「这段代码还在」，守不住「它挑错了人」。
 *
 *           边界（诚实标注）：本文件一条断言也没有真的移动过焦点。「focus() 之后读屏果然落在下一张卡上」
 *           属于真机 + 真读屏才验得了的部分，见交付说明。
 * @author   LingoBridge
 * @created  2026-08-08
 */
import { pickFocusTarget } from '@/lib/focus-handoff'

/** 测试替身：一张卡，只保留落点规则真正关心的两件事 —— 是谁、看不看得见 */
interface FakeCard { id: string; visible: boolean }

const card = (id: string, visible = true): FakeCard => ({ id, visible })
const isVisible = (c: FakeCard): boolean => c.visible

describe('pickFocusTarget【行为】焦点优先交给下一张卡', () => {
  it('删中间那张 → 焦点给它后面那张（键盘用户接着往下删，不必回页首重新 Tab）', () => {
    const items = [card('a'), card('b'), card('c')]
    expect(pickFocusTarget(items, items[1], isVisible)).toBe(items[2])
  })

  it('删第一张 → 焦点给第二张', () => {
    const items = [card('a'), card('b')]
    expect(pickFocusTarget(items, items[0], isVisible)).toBe(items[1])
  })
})

describe('pickFocusTarget【行为】没有下一张时退回上一张', () => {
  it('删最后一张 → 焦点给它前面那张，而不是掉回 body', () => {
    const items = [card('a'), card('b'), card('c')]
    expect(pickFocusTarget(items, items[2], isVisible)).toBe(items[1])
  })

  it('列表只剩这一张 → 没有落点，返回 null（调用方保持原样、不乱抢焦点）', () => {
    const items = [card('only')]
    expect(pickFocusTarget(items, items[0], isVisible)).toBeNull()
  })
})

describe('pickFocusTarget【行为】藏起来的那份列表不能当落点', () => {
  // 素材库同一时刻页面上挂着移动版与桌面版两份列表，一份被 CSS 藏着。把焦点交给藏起来的那份，
  // 用户的感受与「焦点掉回 body」没有区别 —— 光标凭空消失，而且这次连 announce 都提示不了。
  it('跳过不可见的下一张，继续往后找可见的', () => {
    const items = [card('a'), card('b'), card('hidden', false), card('d')]
    expect(pickFocusTarget(items, items[1], isVisible)).toBe(items[3])
  })

  it('后面全不可见时，往前找可见的', () => {
    const items = [card('a'), card('b'), card('hidden1', false), card('hidden2', false)]
    expect(pickFocusTarget(items, items[1], isVisible)).toBe(items[0])
  })

  it('前后都不可见 → null', () => {
    const items = [card('h1', false), card('current'), card('h2', false)]
    expect(pickFocusTarget(items, items[1], isVisible)).toBeNull()
  })
})

describe('pickFocusTarget【行为】异常输入不乱指', () => {
  it('current 不在候选里（标记没打上 / 列表已经变了）→ null，宁可不动也不猜', () => {
    const items = [card('a'), card('b')]
    expect(pickFocusTarget(items, card('外来的'), isVisible)).toBeNull()
  })

  it('空列表 → null', () => {
    expect(pickFocusTarget([], card('a'), isVisible)).toBeNull()
  })
})
