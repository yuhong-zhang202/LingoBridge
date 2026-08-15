/**
 * @module   dashboard-verdict.test
 * @desc     「今日结论条」判定纯逻辑守卫：四个判定源各自触发 / 不触发、顺序、文案与锚点、
 *           成本两种触发原因的措辞区分、全绿态空数组。变异自查：断言精确到整句文案与锚点 id，
 *           判定阈值 / 文案任一改坏都会红。
 *
 *   🔴【2026-08-15 口径更新】成本与延迟降级为静默（P4 需求原文：只在真出事时才冒泡）。
 *      本次只更新了 allClearText 那一组断言（原文含「成本正常 ¥2.41」→ 新口径不提成本），
 *      并**加了一条反向断言**钉「静默 = 一个字都不出现」。
 *      成本 / 延迟【超阈值时】的四条断言（措辞、tone、锚点 id、边界严格大于）**一字未改** ——
 *      降级为静默改的是「正常时说不说」，不是「出事时说什么」，那部分标准不许松。
 * @author   LingoBridge
 * @created  2026-08-04
 */
import {
  computeVerdict, isCostWarn, allClearText,
  ANCHOR_FAILURE_DETAIL, ANCHOR_FEEDBACK, ANCHOR_COST, ANCHOR_LATENCY,
  type VerdictInput,
} from '@/lib/dashboard-verdict'

/** 全绿基线输入：四个判定源全部不触发 */
function base(over: Partial<VerdictInput> = {}): VerdictInput {
  return {
    todayFailuresTotal: 0,
    topFailurePhase: null,
    unhandledFeedback: 0,
    todayCost: 2.41,
    avgDailyCost7: 3,
    dailyBudget: 20,
    slowestPhase: { name: '题目重排', p90: 27_100 },
    latencyWarnMs: 30_000,
    ...over,
  }
}

describe('computeVerdict', () => {
  // 【因「成本与延迟降级为静默」的 P4 口径决定而补强，不是放宽】原断言（空数组）保持一字未动，
  // 只是它现在同时承担「成本/延迟正常时一个 chip 都不冒泡」这条新口径的守卫职责，故显式写明。
  it('全绿：四源均不触发时返回空数组（= 成本/延迟正常时不冒泡，静默口径的正面断言）', () => {
    expect(computeVerdict(base())).toEqual([])
    // base() 的成本 2.41 / 均值 3 / 预算 20 与 P90 27.1s / 阈值 30s 都在阈值内 —— 正常态确实不产出任何 chip
    expect(computeVerdict(base()).some(i => i.key === 'cost' || i.key === 'latency')).toBe(false)
  })

  it('计费失败：todayFailuresTotal > 0 触发红色 chip、锚点指向失败明细表', () => {
    const items = computeVerdict(base({ todayFailuresTotal: 3, topFailurePhase: '语音转写' }))
    expect(items).toEqual([{
      key: 'failure',
      text: '计费失败 3 次，卡在语音转写',
      tone: 'error',
      anchorId: ANCHOR_FAILURE_DETAIL,
    }])
  })

  it('计费失败：无环节名时兜底「未知环节」，不显示生 undefined', () => {
    const items = computeVerdict(base({ todayFailuresTotal: 1, topFailurePhase: null }))
    expect(items[0].text).toBe('计费失败 1 次，卡在未知环节')
  })

  it('新反馈：unhandledFeedback > 0 触发品牌色 chip（不是坏了、不用红）、锚点指向反馈区', () => {
    const items = computeVerdict(base({ unhandledFeedback: 2 }))
    expect(items).toEqual([{
      key: 'feedback',
      text: '反馈 2 条未处理',
      tone: 'brand',
      anchorId: ANCHOR_FEEDBACK,
    }])
  })

  it('成本·突增：超近 7 日均 2 倍触发黄 chip，措辞「超 7 日均 2 倍」', () => {
    const items = computeVerdict(base({ todayCost: 6.5, avgDailyCost7: 3 }))
    expect(items).toEqual([{
      key: 'cost',
      text: '今日 ¥6.50 · 超 7 日均 2 倍',
      tone: 'warn',
      anchorId: ANCHOR_COST,
    }])
  })

  it('成本·超预算：仅超日预算（未超 2 倍均值）时措辞「超日预算」', () => {
    // 22 > 预算 20，但 22 < 12 × 2 = 24（未构成突增）
    const items = computeVerdict(base({ todayCost: 22, avgDailyCost7: 12 }))
    expect(items[0].text).toBe('今日 ¥22.00 · 超日预算 ¥20')
    expect(items[0].tone).toBe('warn')
  })

  it('成本：恰在阈值上（= 2 倍均值 / = 预算）不触发（判定用严格大于）', () => {
    expect(computeVerdict(base({ todayCost: 6, avgDailyCost7: 3 }))).toEqual([])
    expect(computeVerdict(base({ todayCost: 20, avgDailyCost7: 0 }))).toEqual([])
  })

  it('速度：slowestPhase.p90 超过阈值触发黄 chip、锚点指向耗时面板；秒保留 1 位小数', () => {
    const items = computeVerdict(base({ slowestPhase: { name: '题目重排', p90: 31_460 } }))
    expect(items).toEqual([{
      key: 'latency',
      text: '题目重排变慢 P90 31.5s',
      tone: 'warn',
      anchorId: ANCHOR_LATENCY,
    }])
  })

  it('速度：p90 恰等于阈值不触发；slowestPhase 为 null 不触发', () => {
    expect(computeVerdict(base({ slowestPhase: { name: '匹配', p90: 30_000 } }))).toEqual([])
    expect(computeVerdict(base({ slowestPhase: null }))).toEqual([])
  })

  it('多源同时触发：顺序固定为 失败 → 反馈 → 成本 → 速度', () => {
    const items = computeVerdict(base({
      todayFailuresTotal: 1, topFailurePhase: '匹配',
      unhandledFeedback: 1,
      todayCost: 25, avgDailyCost7: 3,
      slowestPhase: { name: '语音转写', p90: 40_000 },
    }))
    expect(items.map(i => i.key)).toEqual(['failure', 'feedback', 'cost', 'latency'])
  })
})

describe('isCostWarn', () => {
  it('超日预算 / 超 2 倍均值任一即真；均值为 0 时突增分支不触发（避免除零式误报）', () => {
    expect(isCostWarn(21, 0, 20)).toBe(true)     // 仅超预算
    expect(isCostWarn(7, 3, 20)).toBe(true)      // 仅突增
    expect(isCostWarn(5, 0, 20)).toBe(false)     // 均值 0 且未超预算
    expect(isCostWarn(5, 3, 20)).toBe(false)     // 都不满足
  })
})

describe('allClearText', () => {
  // 【因「成本与延迟降级为静默」的 P4 口径决定而更新，不是放宽】
  // 原断言：expect(allClearText(2.41)).toBe('今天不用处理什么 · 无失败 · 成本正常 ¥2.41 · 无新反馈')
  // 新断言仍是【整句精确相等】，钉死程度不变，只是钉的对象换成新口径。
  it('全绿一句话只说保留的两个判定（无失败 / 无新反馈），不提成本', () => {
    expect(allClearText()).toBe('今天不用处理什么 · 无失败 · 无新反馈')
  })

  // 【新增·因同一决定而加】正向断言容易被「换个说法照样含成本」绕过，故再补一条反向的：
  // 全绿态整句里不许出现任何成本/延迟字样与金额符号。这是把「静默」本身钉住，而非放宽。
  it('全绿一句话里不出现成本/延迟的任何字样（静默 = 一个字都不出现）', () => {
    const text = allClearText()
    for (const forbidden of ['成本', '¥', '预算', '变慢', 'P90', '慢']) {
      expect(text).not.toContain(forbidden)
    }
  })
})
