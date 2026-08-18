/**
 * @module   anki/auto-pair-outcome.test
 * @desc     雅思流「落库即自动存对子」的处置判据守卫。
 *
 *   【为什么要有这组】2026-08-18 产品方拍板：雅思流的语料就是为回答那道题说的，
 *   落库时就该自动结对，不再要求用户先点书签。改之前实测 49 条雅思流语料里 **47 条**
 *   在素材库被显示成「还没绑题目」+ 一个「去匹配题目」按钮（素材库的 bound 判据数的是
 *   Anki 卡、不是 corpus_question_matches），于是有 3 条被用户拿去又跑了一整条 AI 匹配。
 *
 *   🔴 这组用例真正要钉死的是一条【与手动流程相反】的处置规则：
 *     · 手动点书签存对子失败 → 必须告诉用户（匿名弹注册引导、超额/出错弹 toast）
 *     · **自动存对子失败 → 一律不许出声、更不许阻断跳转**
 *   用户点的是「开始分析」，存对子是我们替他做的副作用。因为一个他没要求的东西
 *   把他卡在整理页、或弹一个他看不懂的注册框，是拿我们的便利去打断他的正事。
 *
 *   ⚠️ 唯一例外是 'bound'：Anki 卡是 (user_id, question_id) 唯一——一道题只能有一个背面。
 *     近 60 天 317 组配对里 22 组撞这个。静默选哪边都会有一半时候是错的
 *     （覆盖=丢数据，保留=无视用户刚写的新答案），所以只有这一种要问人。
 *
 * @author   LingoBridge
 * @created  2026-08-18
 */
import { autoPairOutcome, type SavePairResult } from '@/lib/anki/cards-client'

/** 造一个「该题已绑别的语料」的 409 结果 */
const bound: SavePairResult = {
  ok: false, kind: 'bound',
  currentCorpus: { id: 'c-old', summary: '上次答这道题用的那段语料' },
}

describe('autoPairOutcome · 只有真冲突才打断用户', () => {
  it('存上了 → saved', () => {
    expect(autoPairOutcome({ ok: true })).toBe('saved')
  })

  it('【唯一例外】同一道题已有别的语料当答案 → conflict（弹换语料框、暂不跳转）', () => {
    expect(autoPairOutcome(bound)).toBe('conflict')
  })

  it('匿名用户 → skip，【不弹注册引导】（他没主动要存对子，不该被拦下来推销注册）', () => {
    expect(autoPairOutcome({ ok: false, kind: 'anon' })).toBe('skip')
  })

  it('当日存对子超额 → skip，【不弹 toast】（他点的是开始分析，不该看见一个副作用的报错）', () => {
    expect(autoPairOutcome({ ok: false, kind: 'limit' })).toBe('skip')
  })

  it('服务端出错 → skip', () => {
    expect(autoPairOutcome({ ok: false, kind: 'error' })).toBe('skip')
  })

  it('调用本身抛异常（网络断了）→ skip，绝不把用户卡在整理页', () => {
    expect(autoPairOutcome(null)).toBe('skip')
  })

  it('【不变式】除 bound 外，没有任何结果能打断跳转 —— 穷举全部取值域', () => {
    const all: (SavePairResult | null)[] = [
      { ok: true },
      { ok: false, kind: 'anon' },
      { ok: false, kind: 'limit' },
      { ok: false, kind: 'error' },
      bound,
      null,
    ]
    const blocking = all.filter((r) => autoPairOutcome(r) === 'conflict')
    expect(blocking).toHaveLength(1)
    expect(blocking[0]).toBe(bound)
  })
})
