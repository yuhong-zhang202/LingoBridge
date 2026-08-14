/**
 * @module   api/dashboard-queries-error-paths.test
 * @desc     补 P1 拆分留下的**唯一一处测试真空**：十条表查询的「出错 → 500 早退」与
 *           「分页触顶 → dataTruncated 标记 + 打日志」两条路径。
 *
 *   【为什么单独补】P1 是纯结构重构，全程 sed 逐字节搬运，**只有一处做了结构性改写**：
 *   原先在 `route.ts` 内联 `const firstErr = …; if (firstErr) return NextResponse.json(…500)`，
 *   拆分后变成 `fetchDashboardTables()` 返回 `{ error, … }`、由 route 判空返 500。
 *   语义等价（归并顺序、早退时机均逐字保留），但**这条路径此前从未被任何测试执行过**：
 *   `dashboard-refactor-golden` 的 fixture 里查询恒成功、且不满一页即判停，
 *   `dataTruncated` 恒为 false —— 金标在这两条分支上取不到区分度。
 *
 *   实施重构的 agent 在自评里主动点出了这个真空（「我逐行核对过语义等价，但那是读代码
 *   得出的结论，不是跑出来的」）。本文件把它变成跑出来的。
 *
 *   ⚠️ 这两条是**故障路径**：平时不走，一旦走了就是「看板在少报」或「整块打不开」。
 *      没有测试的故障路径 = 出事那天才发现它坏了。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))

import { GET } from '@/app/api/dashboard/route'
import { getSupabaseServer } from '@/lib/supabase-server'
import { logErr } from '@/lib/log'

const mockGetSupabase = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>
const mockLogErr = logErr as jest.MockedFunction<typeof logErr>

// 与金标测试同锚点（香港 2026-08-10 10:00），便于两份 fixture 互相参照
const FROZEN_NOW = '2026-08-10T02:00:00Z'
// PostgREST 单次返回上限；route 的 PAGE_SIZE=500，故「满 500 行」才会触发翻页
const PAGE_SIZE = 500

/**
 * 造查询构建器。
 * @param mode 'ok' 全成功空表 · 'error' 首次 await 即返错 · 'truncate' 每页恒满（永远翻不到底）
 */
function makeBuilder(mode: 'ok' | 'error' | 'truncate') {
  const b: Record<string, unknown> = {}
  const self = () => b
  b.select = self; b.gte = self; b.lt = self; b.eq = self
  b.or = self; b.not = self; b.order = self; b.limit = self
  const payload = () => {
    if (mode === 'error') return { data: null, error: { message: 'boom: PostgREST 挂了' } }
    // 恒满页 ⇒ route 判「还有下一页」⇒ 翻到 MAX_PAGES 仍满 ⇒ truncated 保持 true
    if (mode === 'truncate') return { data: new Array(PAGE_SIZE).fill({ estimated_cost_cny: 0 }), error: null }
    return { data: [], error: null }
  }
  b.range = () => ({ then: (res: (r: unknown) => void) => res(payload()) })
  b.then = (res: (r: unknown) => void) => res(payload())
  return b
}

function wire(mode: 'ok' | 'error' | 'truncate'): void {
  mockGetSupabase.mockReturnValue({
    from: () => makeBuilder(mode),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: { admin: { listUsers: () => Promise.resolve({ data: { users: [] }, error: null }) } },
  } as never)
}

const call = () => GET(new Request('http://x/api/dashboard?range=7d'))

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers().setSystemTime(new Date(FROZEN_NOW))
})
afterEach(() => { jest.useRealTimers() })

describe('/api/dashboard · 十条表查询的故障路径', () => {
  it('任一查询报错 → 500，且把原始 message 透出（不吞成"查询失败"兜底）', async () => {
    wire('error')
    const res = await call()
    expect(res.status).toBe(500)
    // 透出原始 message 是刻意的：500 页上看得到根因，才不用去翻服务端日志。
    // 若哪天被改成统一兜底文案，这条会转红——那是【降低可诊断性】，需人明示。
    expect(await res.json()).toEqual({ error: 'boom: PostgREST 挂了' })
  })

  it('查询报错时【不得】把空占位当成真实数据返回 200', async () => {
    wire('error')
    const res = await call()
    // 拆分后 fetchDashboardTables 出错时会带着「其余字段为空占位」一起返回；
    // 若 route 漏判 tables.error，看板会显示一片 0 且【毫无异常提示】——
    // 那比 500 危险得多：产品方会把"全 0"当成"今天没人用"。
    expect(res.status).not.toBe(200)
  })

  it('分页触顶 → dataTruncated=true 且打日志（绝不静默少报）', async () => {
    wire('truncate')
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json() as { dataTruncated?: boolean }
    expect(body.dataTruncated).toBe(true)
    // 触顶 = 看板在少报。原实现的注释写死「绝不静默：打日志 + 随响应返回标记」，两者缺一不可。
    expect(mockLogErr).toHaveBeenCalled()
  })

  it('一切正常（空表）→ 200 且 dataTruncated=false', async () => {
    wire('ok')
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json() as { dataTruncated?: boolean }
    expect(body.dataTruncated).toBe(false)
  })
})
