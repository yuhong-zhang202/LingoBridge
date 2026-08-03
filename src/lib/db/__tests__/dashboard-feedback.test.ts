/**
 * @module   db/dashboard-feedback.test
 * @desc     看板反馈待办读取的三态降级守卫：
 *           ① 正常路径 —— 未处理/已处理正确映射，user_id 只出前 8 位（完整 id 不出接口）、
 *              context 四键收窄、handledCount 取 count 查询而非被截断的列表长度；
 *           ② 迁移 0055 未跑（42703 且 message 提到 handled_at）—— 降级近 7 天只读，
 *              且降级查询不再 select handled_at；
 *           ③ 其余错误（含「42703 但不是 handled_at」）—— 置 loadFailed，绝不 throw 拖垮主看板。
 *           全 mock，不碰真实 DB。
 * @author   LingoBridge
 * @created  2026-08-03
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))

import { fetchDashboardFeedback, isMissingHandledColumn } from '@/lib/db/dashboard-feedback'
import type { getSupabaseServer } from '@/lib/supabase-server'

type SupabaseServer = ReturnType<typeof getSupabaseServer>

/** 一次查询的响应（count 查询另带 count 键） */
type QueryResult = { data?: unknown[] | null; error?: unknown; count?: number | null }

/** 四条查询的预置结果：unhandled / handledList / handledCount（新 schema 三连）+ legacy（降级近 7 天） */
type Spec = {
  unhandled?: QueryResult
  handledList?: QueryResult
  handledCount?: QueryResult
  legacy?: QueryResult
}

/** 各查询捕获到的 select 串（断言降级查询不碰 handled_at 用） */
let capturedSelects: string[]

/**
 * 造 mock supabase：按链式特征把查询分派到 spec 的四个槽位。
 * 分派依据：.is → unhandled；.gte → legacy；.not + select 含 message → handledList；.not + select='id' → handledCount。
 * @param spec  预置结果（未指定的槽位回空表）
 */
function makeSupabase(spec: Spec): SupabaseServer {
  return {
    from: () => {
      let select = ''
      let usedIs = false
      let usedNot = false
      let usedGte = false
      const resolveResult = (): QueryResult => {
        if (usedIs) return spec.unhandled ?? { data: [], error: null }
        if (usedGte) return spec.legacy ?? { data: [], error: null }
        if (usedNot && select === 'id') return spec.handledCount ?? { data: null, error: null, count: 0 }
        if (usedNot) return spec.handledList ?? { data: [], error: null }
        throw new Error('未识别的查询链')
      }
      const b: Record<string, unknown> = {}
      const self = () => b
      b.select = (cols: string) => { select = cols; capturedSelects.push(cols); return b }
      b.is = () => { usedIs = true; return b }
      b.not = () => { usedNot = true; return b }
      b.gte = () => { usedGte = true; return b }
      b.order = self
      b.limit = self
      b.then = (resolve: (r: QueryResult) => void) => {
        const r = resolveResult()
        resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null })
      }
      return b
    },
  } as never
}

/** 造一行 feedback（新 schema，含 handled_at） */
function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'f1',
    user_id: '12345678-abcd-4000-8000-000000000000',
    kind: 'manual',
    message: '字体能大一点吗',
    context: { category: 'suggestion', route: '/practice', email: 'a@b.co', errorMessage: null },
    created_at: '2026-08-01T02:00:00.000Z',
    handled_at: null,
    ...over,
  }
}

/** 42703 · handled_at 缺列错误（PostgREST 透传 Postgres undefined_column 的真实形状） */
const MISSING_COL_ERR = { code: '42703', message: 'column feedback.handled_at does not exist' }

beforeEach(() => {
  capturedSelects = []
})

describe('fetchDashboardFeedback', () => {
  it('正常路径：映射条目、user_id 只出前 8 位、handledCount 取 count 查询', async () => {
    const supabase = makeSupabase({
      unhandled:    { data: [row()], error: null },
      handledList:  { data: [row({ id: 'f2', kind: 'crash', handled_at: '2026-08-02T05:00:00.000Z', context: { route: '/matching', errorMessage: 'TypeError: x' } })], error: null },
      handledCount: { data: null, error: null, count: 33 },
    })
    const out = await fetchDashboardFeedback(supabase)
    expect(out.handledSupported).toBe(true)
    expect(out.loadFailed).toBe(false)
    expect(out.unhandledCount).toBe(1)
    // handled 只回近 20 条，「历史 N」必须取 count 查询的 33、不能拿列表长度 1 冒充
    expect(out.handledCount).toBe(33)

    const u = out.unhandled[0]
    expect(u.userIdShort).toBe('12345678')
    // 完整 user_id 不出接口（隐私红线）：条目上不存在 user_id 键
    expect('user_id' in u).toBe(false)
    expect(u.category).toBe('suggestion')
    expect(u.route).toBe('/practice')
    expect(u.email).toBe('a@b.co')
    expect(u.kind).toBe('manual')

    const h = out.handled[0]
    expect(h.kind).toBe('crash')
    expect(h.handled_at).toBe('2026-08-02T05:00:00.000Z')
    expect(h.errorMessage).toBe('TypeError: x')
    expect(h.email).toBeNull()
  })

  it('迁移未跑（42703·handled_at）：降级近 7 天只读，降级查询不 select handled_at', async () => {
    const supabase = makeSupabase({
      unhandled:    { data: null, error: MISSING_COL_ERR },
      handledList:  { data: null, error: MISSING_COL_ERR },
      handledCount: { data: null, error: MISSING_COL_ERR },
      legacy:       { data: [row({ handled_at: undefined })], error: null },
    })
    const out = await fetchDashboardFeedback(supabase)
    expect(out.handledSupported).toBe(false)
    expect(out.loadFailed).toBe(false)
    expect(out.unhandled).toHaveLength(1)
    expect(out.unhandled[0].handled_at).toBeNull()
    expect(out.handled).toEqual([])
    // 降级查询（最后一条 select）绝不能再碰 handled_at，否则降级路径自己也 42703
    const legacySelect = capturedSelects[capturedSelects.length - 1]
    expect(legacySelect).not.toContain('handled_at')
  })

  it('其余错误：置 loadFailed、绝不 throw', async () => {
    const supabase = makeSupabase({
      unhandled: { data: null, error: { code: 'XX000', message: 'boom' } },
    })
    const out = await fetchDashboardFeedback(supabase)
    expect(out.loadFailed).toBe(true)
    expect(out.handledSupported).toBe(false)
    expect(out.unhandled).toEqual([])
  })

  it('42703 但不是 handled_at（别的列名打错）：按普通错误走 loadFailed，不误判成待迁移', async () => {
    const supabase = makeSupabase({
      unhandled: { data: null, error: { code: '42703', message: 'column feedback.messge does not exist' } },
    })
    const out = await fetchDashboardFeedback(supabase)
    expect(out.loadFailed).toBe(true)
    expect(out.handledSupported).toBe(false)
  })
})

describe('isMissingHandledColumn', () => {
  it('只认「42703 且 message 提到 handled_at」', () => {
    expect(isMissingHandledColumn(MISSING_COL_ERR)).toBe(true)
    expect(isMissingHandledColumn({ code: '42703', message: 'column x does not exist' })).toBe(false)
    expect(isMissingHandledColumn({ code: 'XX000', message: 'handled_at' })).toBe(false)
    expect(isMissingHandledColumn(null)).toBe(false)
    expect(isMissingHandledColumn('handled_at')).toBe(false)
  })
})
