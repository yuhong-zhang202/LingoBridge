/**
 * @module   dashboard/window-core-note.test
 * @desc     漏斗③「窗口核心活跃」口径小字的守卫 —— 钉住「数不准的时候必须在脸上说清楚，且要说方向」。
 *
 *   【背景】`windowCoreApprox` 这个字段此前**算了、返回了、但没有任何界面消费**，一度被当成
 *   和 pageViewStats 同类的死字段准备删掉。查下来是反的：`data.windowCoreActive` 正被
 *   `GrowthFunnel` 当大数字显示在屏幕上，而 `windowCoreApprox` 说的正是「这个数可不可信」——
 *   数在屏幕上、可信度标志不接线，与本项目「宁可把『这个数不完整』摆在脸上」的纪律相反。
 *
 *   【为什么整行换而不是补一句「（近似）」】降级时原口径小字**本身在说假话**：
 *   它宣称「AI 环节 / 闪卡复习 / 收藏 任一即算」，而回退路径只数 api_usage_logs 的 AI 环节。
 *   这组用例专门钉这一点 —— 近似态下不许再出现「闪卡复习 / 收藏 任一即算」那句宣称。
 *
 * @author   LingoBridge
 * @created  2026-08-15
 */
import { windowCoreNote } from '@/app/dashboard/_sections/GrowthFunnel'

describe('windowCoreNote · 权威态', () => {
  it('权威态照旧写全三个信号，且带上区间天数', () => {
    expect(windowCoreNote(false, 7)).toBe('AI 环节 / 闪卡复习 / 收藏 任一即算 · 仅注册用户 · 近7天')
  })

  it('权威态不出现任何「不可信」字样（不制造狼来了）', () => {
    const t = windowCoreNote(false, 30)
    for (const forbidden of ['近似', '偏低', '⚠️', '未接入']) expect(t).not.toContain(forbidden)
  })
})

describe('windowCoreNote · 近似态', () => {
  it('必须说【偏低】这个方向，而不是只说「近似」', () => {
    const t = windowCoreNote(true, 7)
    expect(t).toContain('偏低')
    expect(t).toContain('不会偏高')   // 方向是确定的，别让人以为也可能偏高
  })

  it('【核心】近似态不许再宣称数了闪卡/收藏 —— 回退路径根本没数它们', () => {
    const t = windowCoreNote(true, 7)
    expect(t).not.toContain('任一即算')
    // 「闪卡复习与收藏没算进去」这句里也含这两个词，所以不能简单断言不含词；
    // 钉的是那句【宣称】不复存在，且明确写出它们被排除。
    expect(t).toContain('没算进去')
  })

  it('近似态仍带区间天数（换措辞不等于把有用信息一起丢了）', () => {
    expect(windowCoreNote(true, 14)).toContain('近14天')
    expect(windowCoreNote(true, 31)).toContain('近31天')
  })

  it('两态措辞必须真的不同（防有人把三元两边写成同一句）', () => {
    for (const d of [7, 14, 30]) {
      expect(windowCoreNote(true, d)).not.toBe(windowCoreNote(false, d))
    }
  })
})
