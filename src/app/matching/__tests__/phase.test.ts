/**
 * @module   phase.test
 * @desc     匹配页形态判定 deriveMatchPhase 的单测 —— 八种 phase 各一条，外加本次 bug 的回归护栏。
 *
 *   最重要的一条是 describe「回归 · 流式中途无可见题」：产品方 2026-08-02 实测那次低相关匹配跑了约 50 秒，
 *   期间 streamDone=false 且 totalVisible 恒为 0，旧代码把它当成「结果」渲染出「匹配到 0 道当季真题」+
 *   空白左栏，50 秒后整页跳变。这条测试就是那个坑的墓碑，删它等于把坑重新挖开。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
import { deriveMatchPhase, type MatchPhaseInput } from '../phase'

/** 定稿且一切正常的基线入参，各用例只覆盖自己关心的那几个字段 */
const BASE: MatchPhaseInput = {
  dailyLimitHit: false,
  error: null,
  hasResult: true,
  streamDone: true,
  noMatch: false,
  rankingDegraded: false,
  totalVisible: 3,
  lowShownCount: 0,
}

describe('deriveMatchPhase · 八种形态', () => {
  test('limit：429 优先于一切，连 error 都压过', () => {
    expect(deriveMatchPhase({ ...BASE, dailyLimitHit: true, error: '匹配失败' })).toBe('limit')
  })

  test('error：非 429 的失败，且优先于未定稿判定（失败后不该还转圈）', () => {
    expect(deriveMatchPhase({ ...BASE, error: '匹配失败', streamDone: false })).toBe('error')
  })

  test('waiting：首次加载，什么都还没有', () => {
    expect(deriveMatchPhase({ ...BASE, hasResult: false, streamDone: false, totalVisible: 0 })).toBe('waiting')
  })

  test('streaming：未定稿但已有可展示题', () => {
    expect(deriveMatchPhase({ ...BASE, streamDone: false, totalVisible: 2 })).toBe('streaming')
  })

  test('result：定稿且有可展示题', () => {
    expect(deriveMatchPhase(BASE)).toBe('result')
  })

  test('lowMatch：定稿、无可展示题、但有低分题可作佐证', () => {
    expect(deriveMatchPhase({ ...BASE, totalVisible: 0, lowShownCount: 5 })).toBe('lowMatch')
  })

  test('noMatch：三层漏斗全空，优先于降级与低相关', () => {
    expect(deriveMatchPhase({ ...BASE, noMatch: true, totalVisible: 0, lowShownCount: 5, rankingDegraded: true })).toBe('noMatch')
  })

  test('degraded：重排整体降级（一分没产出）', () => {
    expect(deriveMatchPhase({ ...BASE, rankingDegraded: true, totalVisible: 0 })).toBe('degraded')
  })

  test('degraded 优先于 lowMatch：降级时即使有低分题也不当佐证列（那些分数本身不可信）', () => {
    expect(deriveMatchPhase({ ...BASE, rankingDegraded: true, totalVisible: 0, lowShownCount: 5 })).toBe('degraded')
  })

  test('degraded 兜住「无可见题且无低分可列」：等价于降级，不能落进 lowMatch 渲染零张卡', () => {
    expect(deriveMatchPhase({ ...BASE, totalVisible: 0, lowShownCount: 0 })).toBe('degraded')
  })
})

describe('回归 · 流式中途无可见题（2026-08-02 产品方实测那 50 秒）', () => {
  // 这是本次改造的全部起因：低相关语料在流式期间 totalVisible 恒为 0，
  // 若判成 result，页面就会打出「匹配到 0 道当季真题」+ 空白左栏，直到 done 帧才整页跳变。
  test('流式中途 totalVisible=0 时 phase 是 waiting，不是 result', () => {
    const phase = deriveMatchPhase({
      ...BASE,
      streamDone: false,
      totalVisible: 0,
      lowShownCount: 5,   // 题已经到了 5 道，只是全部低于 SCORE_MID
    })
    expect(phase).toBe('waiting')
    expect(phase).not.toBe('result')
  })

  test('同一批数据在 done 帧到达后才允许变成 lowMatch', () => {
    const input: MatchPhaseInput = { ...BASE, totalVisible: 0, lowShownCount: 5 }
    expect(deriveMatchPhase({ ...input, streamDone: false })).toBe('waiting')
    expect(deriveMatchPhase({ ...input, streamDone: true })).toBe('lowMatch')
  })

  test('?stream=0 降级重发期间（result 残缺、未定稿）不判空态', () => {
    // 陷阱二：降级重发时 streamDone 仍为 false、result 可能是残缺的流式中间态。
    expect(deriveMatchPhase({ ...BASE, streamDone: false, totalVisible: 0, noMatch: false })).toBe('waiting')
    expect(deriveMatchPhase({ ...BASE, streamDone: false, totalVisible: 1 })).toBe('streaming')
  })

  test('未定稿时 noMatch / rankingDegraded 一律不生效（空态只在定稿后判）', () => {
    expect(deriveMatchPhase({ ...BASE, streamDone: false, totalVisible: 0, noMatch: true })).toBe('waiting')
    expect(deriveMatchPhase({ ...BASE, streamDone: false, totalVisible: 0, rankingDegraded: true })).toBe('waiting')
  })
})
