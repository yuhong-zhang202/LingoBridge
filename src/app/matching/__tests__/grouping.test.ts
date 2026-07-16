/**
 * @module   grouping.test
 * @desc     匹配页三档分组的「无分数 → 不展示」回归测试（产品不变式 2）。
 *           page.tsx 的分组是纯函数式 useMemo filter，这里复刻同一套判据逐条锁死，
 *           并显式探测台账 002 渲染空洞（highGroup=0 且折叠区>0 → 移动端零卡破损页）
 *           的人口有没有因本次改动变多。
 * @author   LingoBridge
 * @created  2026-07-16
 */
import { SCORE_HIGH, SCORE_MID, SCORE_LOW } from '@/lib/constants'

/** 候选题在分组判定里用到的最小形状 */
interface Cand {
  id: string
  relevanceScore?: number | null
}

/** 与 page.tsx 完全一致的分档判据（未打分一律排除，不进任何档） */
function group(cands: Cand[]): { high: Cand[]; mid: Cand[]; low: Cand[]; totalVisible: number } {
  const high = cands.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_HIGH)
  const mid = cands.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_MID && q.relevanceScore < SCORE_HIGH)
  const low = cands.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_LOW && q.relevanceScore < SCORE_MID)
  const totalVisible = cands.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_LOW).length
  return { high, mid, low, totalVisible }
}

/** 复刻 page.tsx:118 —— 全局无可见题即升级 NoMatchView */
function goesToNoMatchView(cands: Cand[], noMatch = false): boolean {
  return !noMatch && group(cands).totalVisible === 0
}

/** 复刻台账 002 的破损条件：折叠态下高匹配区空、但折叠区有题 → 三个渲染块全落空，零张卡 */
function fallsInto002Hole(cands: Cand[]): boolean {
  const { high, mid, low, totalVisible } = group(cands)
  if (totalVisible === 0) return false          // 走 NoMatchView，不是破损页
  return high.length === 0 && mid.length + low.length > 0
}

const scored = (id: string, s: number): Cand => ({ id, relevanceScore: s })
const unscored = (id: string): Cand => ({ id, relevanceScore: null })

describe('不变式 2 · 无分数 → 不展示、不标任何档', () => {
  test('1. 未打分候选不进高匹配（历史上 `?? 100` 正是把它冒充成高匹配顶在首屏）', () => {
    const g = group([unscored('u1'), scored('a', 90)])
    expect(g.high.map((q) => q.id)).toEqual(['a'])
    expect(g.mid).toEqual([])
    expect(g.low).toEqual([])
  })

  test('2. 未打分不进任何档、不计入标题计数（标题数必须等于真实卡片数）', () => {
    const cands = [unscored('u1'), unscored('u2'), scored('a', 70), scored('b', 45)]
    const g = group(cands)
    expect(g.high.length + g.mid.length + g.low.length).toBe(2)
    expect(g.totalVisible).toBe(2)  // 不是 4
  })

  test('3. undefined 与 null 同等对待（API 缺字段时 JSON 里就是 undefined）', () => {
    const g = group([{ id: 'x' }, { id: 'y', relevanceScore: undefined }, scored('a', 88)])
    expect(g.high.map((q) => q.id)).toEqual(['a'])
    expect(g.totalVisible).toBe(1)
  })

  test('4. 边界分数仍按既有阈值分档（未打分的排除不影响正常分档）', () => {
    const g = group([scored('h', SCORE_HIGH), scored('m', SCORE_MID), scored('l', SCORE_LOW), scored('hidden', SCORE_LOW - 1)])
    expect(g.high.map((q) => q.id)).toEqual(['h'])
    expect(g.mid.map((q) => q.id)).toEqual(['m'])
    expect(g.low.map((q) => q.id)).toEqual(['l'])
    expect(g.totalVisible).toBe(3)  // <40 的不可见
  })
})

describe('不变式 2 · 唯一候选未打分 → NoMatchView', () => {
  test('5. 只有 1 道候选且未打分 → 走 NoMatchView（我们确实对它一无所知）', () => {
    expect(goesToNoMatchView([unscored('only')])).toBe(true)
    expect(fallsInto002Hole([unscored('only')])).toBe(false)
  })

  test('6. 全部候选未打分（重排整体降级）→ 走 NoMatchView，不是破损页', () => {
    const cands = [unscored('a'), unscored('b'), unscored('c')]
    expect(goesToNoMatchView(cands)).toBe(true)
    expect(fallsInto002Hole(cands)).toBe(false)
  })

  test('7. 唯一候选有分且够高 → 正常展示，不误伤', () => {
    expect(goesToNoMatchView([scored('only', 90)])).toBe(false)
    expect(group([scored('only', 90)]).high).toHaveLength(1)
  })
})

describe('台账 002 渲染空洞 · 人口不得因本次改动变多', () => {
  test('8. 未打分 + 有高匹配 → 不掉洞（S056 修复后的真实形态：88 分领衔）', () => {
    // 修复超时后 S056 实测：88/82/75/65/65/40/40/35/30，高匹配区非空
    const cands = [scored('a', 88), scored('b', 82), scored('c', 75), unscored('u')]
    expect(fallsInto002Hole(cands)).toBe(false)
  })

  test('9. ⚠️ 未打分 + 无高匹配 + 有折叠区 → 掉洞（本次改动【新增】的人口，已上报）', () => {
    // 这是 S056/S057 在【修复超时前】的形态：那 1 道未打分曾被 ?? 100 冒充高匹配顶在首屏，
    // 页面因此不破——但那是拿「骗」换来的。移除谎言后，002 的既有缺陷就暴露出来。
    // 本用例不是「期望这样」，而是把这笔交易钉在测试里，防止它被无声改掉。
    const cands = [unscored('u'), scored('m1', 70), scored('m2', 65)]
    expect(fallsInto002Hole(cands)).toBe(true)
  })

  test('10. 002 既有人口与未打分无关：全部有分但无高匹配，本来就掉洞（不是我造成的）', () => {
    const cands = [scored('m1', 70), scored('m2', 65)]
    expect(fallsInto002Hole(cands)).toBe(true)  // 改动前后完全一致
  })

  test('11. 掉洞的唯一前提是「部分打分」；全未打分一律走 NoMatchView', () => {
    // 只要 ranking 要么全成功要么全降级，用例 9 的形态就不可能出现 —— 这正是超时修复的效果
    expect(fallsInto002Hole([unscored('a'), unscored('b')])).toBe(false)
    expect(fallsInto002Hole([scored('a', 90), scored('b', 70)])).toBe(false)
  })
})
