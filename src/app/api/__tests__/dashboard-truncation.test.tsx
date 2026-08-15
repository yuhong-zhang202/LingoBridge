/**
 * @module   api/dashboard-truncation.test
 * @desc     看板 cohort 回访聚合器的【取数完整性】守卫。
 *
 *   【为什么要有这组测试】2026-08-12 之前，fetchCohortReturns 手写分页，跑满页数上限就
 *   【直接退出】——没有标志位、没有日志，把不完整数据交给聚合。分页按 created_at
 *   升序，被截掉的永远是【最新那批】，于是失真方向恒定偏低：看板显示回访在跌，实际是新数据
 *   被丢了，而且没有任何人会知道。这类缺陷编译器和普通用例都抓不到——它没有异常、没有报错，
 *   只是数字悄悄变小。所以必须有一组用例专门钉「触顶时到底有没有声张」。
 *
 *   【2026-08-15 缩编】本文件原来同时守 fetchPageViewStats / PageActivityList（「哪些页面被用得多」）。
 *   那块界面已于 2026-08-14 从看板摘除、本次连同后端整链删除，**守卫的对象不存在了**，故那半边一并移除。
 *   ⚠️ 保留的这半边不是残余：CohortReturnTable 仍由「谁留下了」区实时渲染，
 *   「取数触顶时界面必须说清偏低」这条规矩在它身上仍然成立、仍需被守。
 *
 *   【每条守的是行为还是结构】
 *     · describe 一（取数层）：守【行为】—— supabase mock 按 PostgREST 语义执行 range 分页与
 *       db-max-rows 封顶、并真的执行 route 套上的过滤器，触顶与否由真实翻页行为决定，
 *       不是把 truncated 直接塞进 mock 返回值。
 *     · describe 二（展示层）：守【结构】—— 本仓库无 jsdom / testing-library 且禁止新增依赖，
 *       用 renderToStaticMarkup 对渲染产物断言（警示行在不在、有没有说「偏低」这个方向）。
 *     · describe 三（端到端）：把 route 真实响应里的标志【原样喂给组件】渲染 —— 证明信号确实
 *       从取数一路走到了界面，中间没有哪一段把它吞掉。
 * @author   LingoBridge
 * @created  2026-08-12
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))

import { renderToStaticMarkup } from 'react-dom/server'
import { GET } from '@/app/api/dashboard/route'
import { getSupabaseServer } from '@/lib/supabase-server'
import { logErr } from '@/lib/log'
import { PAGE_SIZE, MAX_PAGES } from '@/lib/db/dashboard-shared'
import CohortReturnTable, { type CohortReturns } from '@/components/dashboard/CohortReturnTable'

const mockGetSupabase = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>
const mockLogErr = logErr as jest.MockedFunction<typeof logErr>

// PostgREST 的 db-max-rows：单次查询最多返回这么多行且不报错——【带 range 的请求同样被它封顶】。
// mock 照做，才能验出「PAGE_SIZE 必须严格小于它」这条判停不变式（PAGE_SIZE ≥ 它时满页会被削成
// 不满页 → 误判到底 → truncated 恒 false，静默少报无声复活）。
const PG_MAX_ROWS = 1000

/** 触顶所需的最小行数：跑满 MAX_PAGES 页、且最后一页仍是满页 */
const ROWS_TO_TRUNCATE = MAX_PAGES * PAGE_SIZE

/** 冻结时刻 UTC 2026-08-12 02:00 → 香港 10:00 */
const NOW_ISO = '2026-08-12T02:00:00Z'
/** 造行用的时刻：香港 08-11 09:00，落在 cohort 的 8 天窗口与 page.view 的区间窗口内 */
const ROW_ISO = '2026-08-11T01:00:00Z'

/** 一行 flow_events（只给两个聚合器读得到的列） */
type FlowRow = {
  event: string
  user_id: string | null
  created_at: string
  is_qa: boolean | null
  props: Record<string, unknown> | null
}

/** 一次查询链上捕获到的过滤条件（mock 据此按 PostgREST 语义求值） */
type Captured = { eq: Array<[string, unknown]>; not: Array<[string, string, unknown]> }

/**
 * 一张「虚拟 flow_events 表」：
 *   · rows 模式 —— 显式给出全部候选行，过滤逐行真实执行（小规模行为用例用）；
 *   · count 模式 —— 只给行数与工厂，按需生成该页的行（10 万行触顶用例用，避免先造一个 10 万元素数组）。
 *     工厂产出的行【必须全部满足查询过滤】，否则「先过滤后分页」的语义会失真。
 */
type FlowTable = { rows: FlowRow[] } | { count: number; make: (i: number) => FlowRow }

/** 一名 auth 用户（listUsers 返回形状里本 fetcher 读到的字段） */
type AuthUser = { id: string; email: string | null; is_anonymous: boolean; created_at: string }

/** 本次 wire 的数据源 */
type Wiring = {
  /** cohort 那条查询（无 event 过滤）看到的表 */
  cohort: FlowTable
  /** auth.admin.listUsers 的全量用户 */
  users: AuthUser[]
}

/** flow_events 上实际发出的请求次数——用于量化「N 页 = N 次往返」 */
let flowRequests: { cohort: number }

/**
 * 按 PostgREST 语义对捕获到的过滤器求值（三值逻辑；认不出的形态一律抛错，
 * 换写法就必须先在这里明确它的 NULL 语义，不许悄悄溜过去）。
 * @param rows  候选行
 * @param q     捕获到的过滤条件
 * @returns     过滤后的行
 */
function applyFilters(rows: FlowRow[], q: Captured): FlowRow[] {
  let out = rows
  for (const [col, v] of q.eq) {
    if (col === 'event') out = out.filter(r => r.event === v)
    else throw new Error(`未识别的 eq 过滤：${col} —— 新过滤器必须在此明确语义`)
  }
  for (const [col, op, v] of q.not) {
    // `.not('user_id','is',null)` → SQL `user_id IS NOT NULL`
    if (col === 'user_id' && op === 'is' && v === null) out = out.filter(r => r.user_id !== null)
    // `.not('is_qa','is',true)` → SQL `is_qa IS NOT TRUE`：false 与 NULL 均保留
    else if (col === 'is_qa' && op === 'is' && v === true) out = out.filter(r => r.is_qa !== true)
    else throw new Error(`未识别的 not 过滤：${col}.${op}.${String(v)} —— 新过滤器必须在此明确语义`)
  }
  return out
}

/**
 * 取某一页的行：先过滤后分页（与 PostgREST 一致），再套 db-max-rows 封顶。
 * @param table  虚拟表
 * @param q      捕获到的过滤条件
 * @param from   range 起（含）
 * @param to     range 止（含）
 * @returns      该页的行
 */
function pageOf(table: FlowTable, q: Captured, from: number, to: number): FlowRow[] {
  const cap = (rows: FlowRow[]): FlowRow[] => rows.slice(0, PG_MAX_ROWS)
  if ('rows' in table) return cap(applyFilters(table.rows, q).slice(from, to + 1))
  const end = Math.min(to + 1, table.count)
  const batch: FlowRow[] = []
  for (let i = from; i < end; i++) batch.push(table.make(i))
  // 生成的行同样过一遍过滤器：工厂若造出不满足过滤的行，这里会当场少一行、断言随即转红
  return cap(applyFilters(batch, q))
}

/**
 * 装配 supabase mock：api_usage_logs / practice_sessions / profiles 一律空表（本套不关心成本口径），
 * flow_events 喂 cohort 的虚拟表，各指标 RPC 一律不可用（走既有降级）。
 * @param w  本次的数据源
 */
function wire(w: Wiring): void {
  flowRequests = { cohort: 0 }
  const makeBuilder = (table: string) => {
    const q: Captured = { eq: [], not: [] }
    const b: Record<string, unknown> = {}
    const self = () => b
    b.select = self; b.gte = self; b.lt = self; b.or = self; b.order = self; b.limit = self
    b.eq = (col: string, v: unknown) => { q.eq.push([col, v]); return b }
    b.not = (col: string, op: string, v: unknown) => { q.not.push([col, op, v]); return b }
    b.range = (from: number, to: number) => ({
      then: (resolve: (r: { data: unknown[]; error: null }) => void) => {
        if (table !== 'flow_events') return resolve({ data: [], error: null })
        flowRequests.cohort += 1
        return resolve({ data: pageOf(w.cohort, q, from, to), error: null })
      },
    })
    // 裸查（不带 range）：真库会被 db-max-rows 静默截断，本套的两个聚合器【不该】走到这里
    b.then = (resolve: (r: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null })
    return b
  }
  mockGetSupabase.mockReturnValue({
    from: (table: string) => makeBuilder(table),
    rpc: () => Promise.resolve({ data: null, error: { message: 'not deployed' } }),
    auth: {
      admin: {
        listUsers: ({ page, perPage }: { page: number; perPage: number }) =>
          Promise.resolve({ data: { users: w.users.slice((page - 1) * perPage, page * perPage) }, error: null }),
      },
    },
  } as never)
}

/** 造一行 flow_events（默认：非 QA、有归属、窗口内） */
function flowRow(over: Partial<FlowRow> = {}): FlowRow {
  return {
    event: 'flow.ai_call',
    user_id: 'u1',
    created_at: ROW_ISO,
    is_qa: false,
    props: null,
    ...over,
  }
}

/** 造一名真注册用户（非匿名 + 有邮箱 + 窗口内） */
function authUser(i: number): AuthUser {
  return { id: `reg-${i}`, email: `u${i}@example.com`, is_anonymous: false, created_at: ROW_ISO }
}

/** 触顶用：一张恒满页的 flow_events 表（行内容全部满足过滤器） */
function hugeTable(event: string): FlowTable {
  return {
    count: ROWS_TO_TRUNCATE,
    // user_id 只在少数几个值间循环：行数要够多，但去重后的人不必多（聚合器建的 Map 才不会撑爆）
    make: (i: number) => flowRow({ event, user_id: `u${i % 50}`, props: { route: 'home' } }),
  }
}

/** 本套用到的响应字段（route 返回体很大，只声明关心的这一个） */
type Body = {
  cohortReturns: CohortReturns | null
}

/**
 * 跑一次看板接口，取回本套关心的字段
 * @returns  响应体（仅本套关心的字段）
 */
async function callDashboard(): Promise<Body> {
  const res = await GET(new Request('http://localhost/api/dashboard?range=7d'))
  return await res.json() as Body
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers().setSystemTime(new Date(NOW_ISO))
})
afterEach(() => { jest.useRealTimers() })

describe('一 · 取数层：触顶必须被记下来，不许静默', () => {
  test('flow_events 行数跑满页数上限 → cohortReturns.truncated 为真', async () => {
    wire({ cohort: hugeTable('flow.ai_call'), users: [authUser(1)] })
    const body = await callDashboard()

    expect(body.cohortReturns?.truncated).toBe(true)
    // 触顶时确实翻满了页（不是提前收工后瞎标一个 true）
    expect(flowRequests.cohort).toBe(MAX_PAGES)
  })

  test('数据量正常 → truncated 为假，且只发一次请求就到底', async () => {
    wire({
      cohort:   { rows: [flowRow(), flowRow({ user_id: 'u2' })] },
      users:    [authUser(1)],
    })
    const body = await callDashboard()

    expect(body.cohortReturns?.truncated).toBe(false)
    expect(flowRequests.cohort).toBe(1)
    // 数据本身照常出（truncated 是附加信息，不是把内容替换成降级态）
    expect(body.cohortReturns?.days.length).toBeGreaterThan(0)
  })

  test('恰好一页（PAGE_SIZE 行）→ 翻第二页拿到空页判到底，truncated 仍为假', async () => {
    wire({
      cohort:   { rows: Array.from({ length: PAGE_SIZE }, (_, i) => flowRow({ user_id: `u${i}` })) },
      users:    [authUser(1)],
    })
    const body = await callDashboard()

    expect(body.cohortReturns?.truncated).toBe(false)
    expect(flowRequests.cohort).toBe(2)
  })

  test('注册名册分页跑满（2000 名注册用户）→ cohort 同样置 truncated（注册分母偏低）', async () => {
    wire({
      cohort:   { rows: [] },
      // listUsers 每页 200、上限 10 页：2000 名恰好把页数吃满，还有没拉到的人
      users:    Array.from({ length: 2000 }, (_, i) => authUser(i)),
    })
    const body = await callDashboard()

    expect(body.cohortReturns?.truncated).toBe(true)
  })

  test('触顶时打错误日志（「不静默」的另一半：界面之外，日志里也要留痕）', async () => {
    wire({ cohort: hugeTable('flow.ai_call'), users: [authUser(1)] })
    await callDashboard()

    const msgs = mockLogErr.mock.calls.map(c => (c[1] instanceof Error ? c[1].message : String(c[1])))
    expect(msgs.some(m => m.includes('cohort') && m.includes('偏低'))).toBe(true)
  })

  test('QA 行与无归属行不进 cohort 回访口径（下推 user_id IS NOT NULL 后，剔除口径一字未变）', async () => {
    wire({
      cohort: { rows: [
        flowRow({ user_id: 'reg-1' }),                      // 真回访
        flowRow({ user_id: 'reg-1', is_qa: true }),         // 自测：不算回访信号
        flowRow({ user_id: null }),                         // 无归属：归不到人
        flowRow({ user_id: 'reg-2', is_qa: null }),         // is_qa=NULL 的历史行：照常算数
      ] },
      // 注册日 = 香港 08-10，回访行落在 08-11（注册日+1）→ 次日回来
      users: [
        { id: 'reg-1', email: 'a@example.com', is_anonymous: false, created_at: '2026-08-10T01:00:00Z' },
        { id: 'reg-2', email: 'b@example.com', is_anonymous: false, created_at: '2026-08-10T01:00:00Z' },
      ],
    })
    const body = await callDashboard()

    const day = body.cohortReturns?.days.find(d => d.dateLabel === '8/10')
    expect(day).toBeDefined()
    expect(day?.registered).toBe(2)
    // reg-1（真回访）+ reg-2（NULL 历史行）都算回来；QA 行与无归属行不产生任何回访
    expect(day?.d1Returned).toBe(2)
  })
})

describe('二 · 展示层：界面必须说出「不完整」且说明方向是偏低', () => {
  /** 造一块 cohort 数据（displayDays 刻意取 31 而非 7：钉住「窗口天数来自数据、不是组件写死」） */
  function cohort(truncated: boolean, displayDays = 31): CohortReturns {
    return {
      days: [{ dateLabel: '8/10', registered: 3, d1Pending: false, d1Returned: 1, totalReturned: 2 }],
      emptyDays: 0,
      displayDays,
      truncated,
    }
  }

  test('cohort 触顶 → 表上方出现 role="alert" 警示，并写明「偏低」', () => {
    const html = renderToStaticMarkup(<CohortReturnTable cohort={cohort(true)} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('取数触顶')
    expect(html).toContain('偏低')
    // 方向必须是确定的：不许只说「数据不全」让人以为也可能偏高
    expect(html).toContain('不会偏高')
    // 警示在表格【之前】出现（数字的可信度是读表的前提）
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('<table'))
  })

  test('cohort 未触顶 → 没有任何警示（不制造狼来了）', () => {
    const html = renderToStaticMarkup(<CohortReturnTable cohort={cohort(false)} />)
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('取数触顶')
  })

  test('读取失败降级（cohort=null）时不炸、也不假装有数据', () => {
    const html = renderToStaticMarkup(<CohortReturnTable cohort={null} />)
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('<table')
  })

  // 【2026-08-15】窗口天数必须来自数据、不是组件写死 —— 否则「徽标近 31 天 / 表里 7 天」那类同屏打架会复发
  test('「近 N 天」读的是 cohort.displayDays，不是组件里写死的 7', () => {
    expect(renderToStaticMarkup(<CohortReturnTable cohort={cohort(false, 31)} />)).toContain('近 31 天注册分组')
    expect(renderToStaticMarkup(<CohortReturnTable cohort={cohort(false, 8)} />)).toContain('近 8 天注册分组')
    // 反向：组件里不许再有任何写死的天数漏出来
    expect(renderToStaticMarkup(<CohortReturnTable cohort={cohort(false, 31)} />)).not.toContain('近 7 天')
  })

  test('空态文案的天数同样来自数据（空态是最容易漏改文案的那条路径）', () => {
    const empty: CohortReturns = { days: [], emptyDays: 31, displayDays: 31, truncated: false }
    const html = renderToStaticMarkup(<CohortReturnTable cohort={empty} />)
    expect(html).toContain('近 31 天无新注册')
  })
})

describe('三 · 端到端：接口的标志原样喂给组件，中间没有哪段吞掉它', () => {
  test('触顶响应 → 组件渲染出警示', async () => {
    wire({ cohort: hugeTable('flow.ai_call'), users: [authUser(1)] })
    const body = await callDashboard()

    const cohortHtml = renderToStaticMarkup(<CohortReturnTable cohort={body.cohortReturns} />)

    expect(cohortHtml).toContain('取数触顶')
  })

  test('正常响应 → 组件不出警示', async () => {
    wire({
      cohort:   { rows: [flowRow()] },
      users:    [authUser(1)],
    })
    const body = await callDashboard()

    const cohortHtml = renderToStaticMarkup(<CohortReturnTable cohort={body.cohortReturns} />)

    expect(cohortHtml).not.toContain('取数触顶')
  })
})

describe('四 · 分页参数的判停不变式（改坏它 = 静默少报无声复活）', () => {
  test('PAGE_SIZE 必须严格小于 PostgREST 的 db-max-rows', () => {
    // 相等或更大时：满页会被 db-max-rows 削成「不满页」→ fetchAllRows 误判到底、truncated 恒假
    expect(PAGE_SIZE).toBeLessThan(PG_MAX_ROWS)
  })
})
