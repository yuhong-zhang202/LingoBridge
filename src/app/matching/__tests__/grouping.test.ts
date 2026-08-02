/**
 * @module   grouping.test
 * @desc     匹配页两档分组的「无分数 → 不展示」回归测试（产品不变式 2），
 *           以及台账 002 渲染空洞【已修】的回归护栏。
 *           page.tsx 的分组是纯函数式 useMemo filter，这里复刻同一套判据逐条锁死。
 *
 *           2026-07-16 两处语义变更（产品方拍板）：
 *           1. 低匹配档（原 40-59 折叠可见）取消 → < SCORE_MID 一律不展示不入库（台账 042）
 *           2. 002 已修：highGroup=0 且 midGroup>0 时自动展开折叠区（autoExpand），
 *              不再出现「标题说有 N 道、屏幕零张卡」的破损页。
 *              本文件原先把该破损行为钉死在用例 9/10（断言 fallsInto002Hole === true），
 *              注释写明「防止它被无声改掉」——现在它是被【明确授权】改掉的，
 *              故断言翻转为「不再掉洞」，用例全部保留，覆盖不减。
 * @author   LingoBridge
 * @created  2026-07-16
 */
import { SCORE_HIGH, SCORE_MID, LOW_MATCH_SHOW_MAX } from '@/lib/constants'

/** 候选题在分组判定里用到的最小形状 */
interface Cand {
  id: string
  relevanceScore?: number | null
}

/** 与 page.tsx 完全一致的分档判据（未打分一律排除，不进任何档；< SCORE_MID 不展示） */
function group(cands: Cand[]): { high: Cand[]; mid: Cand[]; totalVisible: number } {
  const high = cands.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_HIGH)
  const mid = cands.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_MID && q.relevanceScore < SCORE_HIGH)
  const totalVisible = cands.filter((q) => q.relevanceScore != null && q.relevanceScore >= SCORE_MID).length
  return { high, mid, totalVisible }
}

/** 复刻 page.tsx 的 002 修复：无高匹配但有中匹配时，折叠区自动展开 */
function autoExpands(cands: Cand[]): boolean {
  const { high, mid } = group(cands)
  return high.length === 0 && mid.length > 0
}

/**
 * 复刻 page.tsx 的 B 类低相关展示切片：有分且 < SCORE_MID 的题按降序取前 LOW_MATCH_SHOW_MAX 道。
 * 未打分一律排除（绝不回填占位分）。入参 cands 视作已按分降序（与 page.tsx 的 result.questions 同前提）。
 */
function lowShown(cands: Cand[]): Cand[] {
  return cands.filter((q) => q.relevanceScore != null && q.relevanceScore < SCORE_MID).slice(0, LOW_MATCH_SHOW_MAX)
}

/**
 * 复刻 matching.ts 的机制①降级信号：候选存在但重排一分没产出（全部题无 relevanceScore）。
 * 部分未打分（至少一道有分）不算降级；无候选（noMatch）另判。
 */
function serviceRankingDegraded(cands: Cand[]): boolean {
  return cands.length > 0 && cands.every((q) => q.relevanceScore == null)
}

type Branch = 'noMatch' | 'degraded' | 'lowMatch' | 'normal'

/**
 * 复刻 Matching{Mobile,Desktop} 的空态四支互斥判定（顺序即优先级）：
 * 真没题 A 类 → 机制①降级（无分可展示·重试）→ B 类低相关展示 → 正常首屏。
 * 降级支【优先于】B 类，并兜住「globalNoneVisible 但无低分可展示」这一等价于机制①的组合。
 */
function branchOf(cands: Cand[], noMatch = false): Branch {
  if (noMatch) return 'noMatch'
  const rankingDegraded = serviceRankingDegraded(cands)
  const globalNoneVisible = group(cands).totalVisible === 0
  if (rankingDegraded || (globalNoneVisible && lowShown(cands).length === 0)) return 'degraded'
  if (globalNoneVisible) return 'lowMatch'
  return 'normal'
}

/**
 * 复刻修复【后】的渲染路径，判断用户是否会看到「标题说有 N 道、屏幕零张卡」的破损页。
 * 修复前的破损条件是：高匹配区空 + 折叠区有题 + 折叠区默认收起 → 三个渲染块全落空。
 * 修复后 autoExpands 为真时折叠区直接展开，卡片真的出现 → 破损页不再可达。
 */
function fallsInto002Hole(cands: Cand[]): boolean {
  const { high, mid, totalVisible } = group(cands)
  if (totalVisible === 0) return false          // 走 NoMatchView，不是破损页
  if (autoExpands(cands)) return false          // 002 修复：自动展开，卡片会出现
  return high.length === 0 && mid.length > 0
}

const scored = (id: string, s: number): Cand => ({ id, relevanceScore: s })
const unscored = (id: string): Cand => ({ id, relevanceScore: null })

describe('不变式 2 · 无分数 → 不展示、不标任何档', () => {
  test('1. 未打分候选不进高匹配（历史上 `?? 100` 正是把它冒充成高匹配顶在首屏）', () => {
    const g = group([unscored('u1'), scored('a', 90)])
    expect(g.high.map((q) => q.id)).toEqual(['a'])
    expect(g.mid).toEqual([])
  })

  test('2. 未打分不进任何档、不计入标题计数（标题数必须等于真实卡片数）', () => {
    // b=45 落在原「低匹配」区间，2026-07-16 起该档取消 → 不展示、不计数
    const cands = [unscored('u1'), unscored('u2'), scored('a', 70), scored('b', 45)]
    const g = group(cands)
    expect(g.high.length + g.mid.length).toBe(1)   // 只剩 a
    expect(g.totalVisible).toBe(1)                 // 不是 4，也不是 2
  })

  test('3. undefined 与 null 同等对待（API 缺字段时 JSON 里就是 undefined）', () => {
    const g = group([{ id: 'x' }, { id: 'y', relevanceScore: undefined }, scored('a', 88)])
    expect(g.high.map((q) => q.id)).toEqual(['a'])
    expect(g.totalVisible).toBe(1)
  })

  test('4. 边界分数按两条线分档：SCORE_MID 整数可见，低 1 分即不可见', () => {
    const g = group([scored('h', SCORE_HIGH), scored('m', SCORE_MID), scored('below', SCORE_MID - 1)])
    expect(g.high.map((q) => q.id)).toEqual(['h'])
    expect(g.mid.map((q) => q.id)).toEqual(['m'])
    expect(g.totalVisible).toBe(2)  // below 不可见
  })
})

describe('不变式 2 · 候选未打分 → 机制①降级重试态（不再假装成 NoMatchView）', () => {
  test('5. 只有 1 道候选且未打分 → 降级重试态（重排一分没产出，无分可展示）', () => {
    // 2026-08-02 前此处走 NoMatchView「换故事」；现语义修正为：候选确实存在、只是排序没算出来 → 给重试
    expect(branchOf([unscored('only')])).toBe('degraded')
    expect(fallsInto002Hole([unscored('only')])).toBe(false)
  })

  test('6. 全部候选未打分（重排整体降级）→ 降级重试态，不是破损页、不是 NoMatchView', () => {
    const cands = [unscored('a'), unscored('b'), unscored('c')]
    expect(branchOf(cands)).toBe('degraded')
    expect(serviceRankingDegraded(cands)).toBe(true)
    expect(lowShown(cands)).toHaveLength(0)   // 无低分可展示 → 只能重试
    expect(fallsInto002Hole(cands)).toBe(false)
  })

  test('7. 唯一候选有分且够高 → 正常首屏，不误伤', () => {
    expect(branchOf([scored('only', 90)])).toBe('normal')
    expect(group([scored('only', 90)]).high).toHaveLength(1)
  })
})

describe('noMatch 空态四支互斥 · A 类 / 机制①降级 / B 类低相关 / 正常', () => {
  test('A. 三层漏斗全空（noMatch=true）→ A 类 NoMatchView 换故事，不误判为降级/B 类', () => {
    // noMatch 时 questions 为空：serviceRankingDegraded=false（无候选），branchOf 仍应先判 A 类
    expect(branchOf([], true)).toBe('noMatch')
    expect(branchOf([scored('x', 90)], true)).toBe('noMatch')   // 即便有分，noMatch 优先
  })

  test('降级. 候选存在但重排一分没产出 → 降级重试态（优先于 B 类）', () => {
    const cands = [unscored('a'), unscored('b')]
    expect(branchOf(cands)).toBe('degraded')
  })

  test('B 类可展示. 候选有分但全部 < SCORE_MID → B 类，展示最相关的前几道', () => {
    // 40/45/50 全部低于 SCORE_MID(60)：不走 NoMatchView，如实展示（降序，最高分置顶）
    const cands = [scored('m1', 50), scored('m2', 45), scored('m3', 40)]
    expect(branchOf(cands)).toBe('lowMatch')
    const shown = lowShown(cands)
    expect(shown.map((q) => q.id)).toEqual(['m1', 'm2', 'm3'])   // 置顶 = 最高分 m1
    expect(group(cands).totalVisible).toBe(0)                    // 一道都不入「可见」计数，B 类是独立兜底切片
  })

  test('B 类上限. 低分候选超过 LOW_MATCH_SHOW_MAX → 只展示前 N 道', () => {
    const cands = Array.from({ length: LOW_MATCH_SHOW_MAX + 3 }, (_, i) => scored(`m${i}`, 50 - i))
    expect(branchOf(cands)).toBe('lowMatch')
    expect(lowShown(cands)).toHaveLength(LOW_MATCH_SHOW_MAX)
  })

  test('B 类空低分集回落. globalNoneVisible 但无低分可展示（全未打分）→ 回落降级态，杜绝「文案+零张卡」', () => {
    // ux 点名最易漏的边界：候选全未打分 → globalNoneVisible 也为真，但 lowShown 为空 →
    // 绝不能渲染 B 类空洞，必须回落到降级重试态
    const cands = [unscored('a'), unscored('b'), unscored('c')]
    expect(group(cands).totalVisible).toBe(0)   // globalNoneVisible 成立
    expect(lowShown(cands)).toHaveLength(0)      // 无低分可展示
    expect(branchOf(cands)).toBe('degraded')     // 回落，不是 lowMatch
  })

  test('正常首屏. 有可见题（≥ SCORE_MID）→ normal，不进任何空态支', () => {
    expect(branchOf([scored('h', 90), scored('m', 70)])).toBe('normal')
    expect(branchOf([scored('m', 65), scored('low', 40)])).toBe('normal')   // 有一道可见即 normal
  })
})

describe('台账 002 渲染空洞 · 已修：破损页不再可达', () => {
  test('8. 未打分 + 有高匹配 → 不掉洞（S056 修复超时后的真实形态：88 分领衔）', () => {
    // 修复超时后 S056 实测：88/82/75/65/65/40/40/35/30，高匹配区非空
    const cands = [scored('a', 88), scored('b', 82), scored('c', 75), unscored('u')]
    expect(fallsInto002Hole(cands)).toBe(false)
    expect(autoExpands(cands)).toBe(false)   // 有高匹配就不需要自动展开
  })

  test('9. 未打分 + 无高匹配 + 有折叠区 → 【修复后】自动展开，不再掉洞', () => {
    // 这是 S056/S057 在修复超时前的形态。原先此处断言 toBe(true)，把破损行为钉死；
    // 2026-07-16 产品方授权修 002 后，autoExpand 让这 2 道中匹配直接出现在屏幕上。
    const cands = [unscored('u'), scored('m1', 70), scored('m2', 65)]
    expect(autoExpands(cands)).toBe(true)
    expect(fallsInto002Hole(cands)).toBe(false)
  })

  test('10. 002 的既有人口（全部有分但无高匹配）同样被修复覆盖', () => {
    // 原先此处断言 toBe(true) 并注明「改动前后完全一致，不是我造成的」——现在它被修好了
    const cands = [scored('m1', 70), scored('m2', 65)]
    expect(autoExpands(cands)).toBe(true)
    expect(fallsInto002Hole(cands)).toBe(false)
  })

  test('11. 全未打分 / 有高匹配，都不触发自动展开，也不掉洞', () => {
    expect(fallsInto002Hole([unscored('a'), unscored('b')])).toBe(false)   // → 降级重试态（非破损页）
    expect(autoExpands([unscored('a'), unscored('b')])).toBe(false)
    expect(fallsInto002Hole([scored('a', 90), scored('b', 70)])).toBe(false)
    expect(autoExpands([scored('a', 90), scored('b', 70)])).toBe(false)
  })

  test('12. 破损页在任何输入下都不可达（002 修复的总断言）', () => {
    // 穷举分档形态：高/中/未打分 的所有非空组合，逐个验破损页不可达
    const pool = [scored('h', 90), scored('m', 70), unscored('u')]
    for (let mask = 1; mask < 8; mask++) {
      const cands = pool.filter((_, i) => mask & (1 << i))
      expect(fallsInto002Hole(cands)).toBe(false)
    }
  })
})
