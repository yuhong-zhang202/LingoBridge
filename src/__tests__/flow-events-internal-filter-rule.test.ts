/**
 * @module   flow-events-internal-filter-rule.test
 * @desc     全站规则守卫（静态扫描源码，不连库、不发请求）：
 *           规则一 —— 凡是【读 flow_events 用于产出看板数字】的取数点，select 列表必须同时带
 *                     `is_qa` 与 `user_id`（后者是剔除内部账户名册的唯一依据）。
 *           规则二 —— 命中集合硬编码成快照：新增一个读 flow_events 的取数点必须回来显式登记，
 *                     顺便当场说清它属于「要两道过滤」还是「登记在案的豁免」。
 *           规则三 —— 消费侧：dashboard-flow-events 里每个吃 FlowEventRow[] 的导出函数都必须走
 *                     唯一判定入口 isSelfTestRow，且该入口同时含 is_qa 与内部账户名册两道；
 *                     文件里不许出现 isSelfTestRow 之外的裸 `is_qa === true`（绕过入口 = 少一道过滤）。
 *           规则四 —— 另外两个已经做对的模块（growth-funnel / cohort 回访）不许退回去。
 *           规则五 —— 迁移里读 flow_events 的 RPC 必须同时具备 `is_qa` 与 `p_exclude_user_ids` 两道。
 *
 *           【为什么要有这道守卫】「少一道过滤」这类缺陷 tsc / eslint / build / 全部单测【一律绿】：
 *           少剔一批行在类型上完全合法，页面照常渲染，只有真去拉数据、并且恰好有人去核对的那天
 *           才会发现——2026-08-19 就是这么发现的：flow-health 那条取数连 user_id 都没 select，
 *           产品方自己的测试流量占了近 60 天 match.result 主口径的 24%，看板上完全看不出来。
 *           单给当时那一处补过滤挡不住下一处：本文件守的是「读 flow_events 就得两道过滤」这条通行规则。
 *           行为面的断言在 src/lib/db/__tests__/dashboard-flow-events.test.ts（内部账户不进主口径那组）。
 *
 *           ⚠️ 单靠 is_qa 一道为什么不够，见 dashboard-flow-events.ts 的 isSelfTestRow 注释
 *              （要点：is_qa 是 2026-08-02 迁移 0053 才加的列，此前的行一律 false 且无法回溯标记）。
 *
 *           扫描器的已知漏判 / 误报写在文件末尾，改本文件前先读那段。
 * @author   LingoBridge
 * @created  2026-08-19
 */
import fs from 'fs'
import path from 'path'

/** 仓库根：本文件在 src/__tests__/ 下，上两级即仓库根 */
const REPO_ROOT = path.resolve(__dirname, '../..')
/** 扫描根：产品代码 + 离线脚本（两边都可能读 flow_events 算数） */
const SCAN_ROOTS = [path.join(REPO_ROOT, 'src'), path.join(REPO_ROOT, 'scripts')]
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations')
const FLOW_MODULE = path.join(REPO_ROOT, 'src', 'lib', 'db', 'dashboard-flow-events.ts')
const FUNNEL_MODULE = path.join(REPO_ROOT, 'src', 'lib', 'db', 'dashboard-growth-funnel.ts')
const METRICS_MODULE = path.join(REPO_ROOT, 'src', 'lib', 'db', 'dashboard-metrics.ts')

/** 一个 flow_events 取数点的静态画像 */
interface FlowReadSite {
  /** 相对仓库根的路径 */
  file: string
  /**
   * 取数形态：
   *   write        —— insert/update/delete，本规则不管（写入侧的 is_qa 由 qa-traffic.isQaRequest 决定）
   *   select-head  —— 只要计数不取行（`head: true`），拿不到列、也就无从在 JS 侧过滤
   *   select-rows  —— 取行回来在 JS 侧聚合，本规则的正主
   */
  kind: 'write' | 'select-head' | 'select-rows'
  /** select 的列清单原文（非 select 形态为 ''） */
  cols: string
  /** 稳定 key：`file::kind`（刻意不含列清单——加一列不该让守卫无故变红） */
  key: string
}

/**
 * 递归收集一个目录下的源码文件
 * @param dir 起始目录（绝对路径）
 * @returns   源码文件绝对路径数组；跳过 node_modules / .next / .claude / 测试夹具
 */
function collectSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // __tests__ 里的 supabase mock 会大量出现 'flow_events' 字面量，那是夹具不是取数点
      if (['node_modules', '.next', '.claude', '__tests__'].includes(entry.name)) continue
      out.push(...collectSourceFiles(full))
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * 从一个源码文件里读出全部 flow_events 取数点
 * @param full 文件绝对路径
 * @returns    该文件里的取数点画像（没有则空数组）
 */
function readSitesOf(full: string): FlowReadSite[] {
  const src = fs.readFileSync(full, 'utf8')
  const file = path.relative(REPO_ROOT, full)
  const sites: FlowReadSite[] = []
  // .from('flow_events') / .from("flow_events") 两种写法都认
  const fromRe = /\.from\(\s*['"]flow_events['"]\s*\)/g
  let m: RegExpExecArray | null
  while ((m = fromRe.exec(src)) !== null) {
    // 只看紧跟其后的一小段：链式调用的第一个动作决定这是读还是写
    const tail = src.slice(m.index, m.index + 500)
    const op = /\.\s*(select|insert|upsert|update|delete)\s*\(/.exec(tail)?.[1]
    if (op !== undefined && op !== 'select') {
      sites.push({ file, kind: 'write', cols: '', key: `${file}::write` })
      continue
    }
    const cols = /\.select\(\s*['"]([^'"]*)['"]/.exec(tail)?.[1] ?? ''
    const head = /\.select\([^)]*head:\s*true/.test(tail)
    const kind = head ? 'select-head' : 'select-rows'
    sites.push({ file, kind, cols, key: `${file}::${kind}` })
  }
  return sites
}

const SITES: FlowReadSite[] = SCAN_ROOTS
  .flatMap(collectSourceFiles)
  .flatMap(readSitesOf)
  .sort((a, b) => a.key.localeCompare(b.key))

/**
 * 【豁免登记簿】key → 为什么这一处不必带两道过滤。
 * 登记一条 = 声明「我想清楚了，这处的数不是拿来当指标看的」。加条目前请先自问：
 * 它的输出会不会出现在任何一块看板 / 报告 / 比例里？会 ⇒ 不该豁免，去补过滤。
 */
const EXEMPTIONS: Record<string, string> = {
  'src/lib/events.ts::write':
    '写入点（logEvent）。is_qa 在写入时由 qa-traffic.isQaRequest 决定（内部账户即 QA），与读侧无关。',
  'src/lib/db/dashboard-flow-events.ts::select-head':
    'everSeen 的全库存在性 head 查询：回答「这条埋点被触发过没有」，自测触发同样证明链路是通的；' +
    '刻意与窗口侧 everSeen=count+qaCount>0 同口径（两边都含自测），剔了反而会误报「埋点坏了」。',
  'scripts/analysis/ranking-latency-probe.ts::select-rows':
    '2026-08-01 的一次性探针：只列举库里有哪些事件名与 props 键（形态发现），不产出任何比率/口径数字。',
}

describe('规则一 + 二：读 flow_events 算数 ⇒ select 必须带 is_qa 与 user_id', () => {
  it('扫描器没有空转（真的扫到了取数点，且识别出了取行的那一类）', () => {
    // 目录改名 / 正则失配会让扫描结果变空，那样下面所有断言都会「因为没有反例」而假绿。
    expect(SITES.length).toBeGreaterThanOrEqual(5)
    expect(SITES.filter(s => s.kind === 'select-rows').length).toBeGreaterThanOrEqual(3)
  })

  it('命中集合就是当前这几处（新增读 flow_events 的取数点必须在这里显式登记）', () => {
    expect([...new Set(SITES.map(s => s.key))]).toEqual([
      'scripts/analysis/ranking-latency-probe.ts::select-rows',
      'src/lib/db/dashboard-flow-events.ts::select-head',
      'src/lib/db/dashboard-flow-events.ts::select-rows',
      'src/lib/db/dashboard-growth-funnel.ts::select-rows',
      'src/lib/db/dashboard-metrics.ts::select-rows',
      'src/lib/events.ts::write',
    ])
  })

  it('每一处取行的取数点都 select 了 is_qa 与 user_id（豁免项除外）', () => {
    const missing = SITES
      .filter(s => s.kind === 'select-rows' && !(s.key in EXEMPTIONS))
      .filter(s => !s.cols.includes('is_qa') || !s.cols.includes('user_id'))
      .map(s => `${s.key} → select('${s.cols}')`)
    expect(missing).toEqual([])
  })

  it('豁免簿里没有过期条目（登记了却已经不存在的 key = 该清理了）', () => {
    const stale = Object.keys(EXEMPTIONS).filter(k => !SITES.some(s => s.key === k))
    expect(stale).toEqual([])
  })
})

// ── 消费侧：取回来了不等于过滤了 ────────────────────────────────────────────────

/**
 * 取一个模块里某个导出函数的函数体（到第一行顶格 `}` 为止）。
 * @param src   模块源码
 * @param name  函数名
 * @returns     函数体源码；找不到该函数时 null
 */
function bodyOf(src: string, name: string): string | null {
  const head = new RegExp(`\\n(?:export )?(?:async )?function ${name}\\s*[(<]`).exec(src)
  if (head === null) return null
  const rest = src.slice(head.index + 1)
  const end = rest.indexOf('\n}')
  return end === -1 ? rest : rest.slice(0, end)
}

/**
 * 列出模块里所有【吃 FlowEventRow[] 的导出函数】名 —— 它们就是必须过滤的消费点。
 * @param src 模块源码
 * @returns   函数名数组（源码顺序）
 */
function rowConsumers(src: string): string[] {
  const out: string[] = []
  const re = /\nexport (?:async )?function (\w+)\(([\s\S]*?)\)\s*:/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    if (m[2].includes('FlowEventRow[]')) out.push(m[1])
  }
  return out
}

describe('规则三：dashboard-flow-events 的每个消费点都走唯一过滤入口', () => {
  const src = fs.readFileSync(FLOW_MODULE, 'utf8')

  it('模块引入了内部账户名册（不许手抄 id）', () => {
    expect(src).toContain("from '@/lib/internal-accounts'")
    // 名册的真源只有 internal-accounts.ts；这里出现真实 id 即是抄了第二份、必然漂移
    expect(src).not.toMatch(/a1af125c-9446-4a7c-aa5d-aea09cf9e798/)
  })

  it('唯一入口 isSelfTestRow 同时具备两道过滤（is_qa + 内部账户名册）', () => {
    const body = bodyOf(src, 'isSelfTestRow')
    expect(body).not.toBeNull()
    expect(body).toContain('is_qa')
    expect(body).toContain('isInternalAccount(')
  })

  it('吃 FlowEventRow[] 的导出函数就是这 5 个（新增消费点必须显式登记）', () => {
    expect(rowConsumers(src)).toEqual([
      'aggregateAiCall',
      'aggregateEventCounts',
      'aggregateEnumCoverage',
      'latestOursFailure',
      'aggregateFlowHealth',
    ])
  })

  it.each(rowConsumers(src))('%s 的函数体里调用了 isSelfTestRow', (name) => {
    const body = bodyOf(src, name)
    expect(body).not.toBeNull()
    expect(body).toContain('isSelfTestRow')
  })

  it('没有绕过入口的裸 `is_qa === true`（绕过 = 只剩一道过滤，且看不出来）', () => {
    const helper = bodyOf(src, 'isSelfTestRow') ?? ''
    const helperAt = src.indexOf(helper)
    const strays: number[] = []
    for (let i = src.indexOf('is_qa === true'); i !== -1; i = src.indexOf('is_qa === true', i + 1)) {
      if (i < helperAt || i > helperAt + helper.length) strays.push(i)
    }
    // 落在 isSelfTestRow 之外的都是绕过入口的写法；报出行号方便定位
    expect(strays.map(i => `第 ${src.slice(0, i).split('\n').length} 行`)).toEqual([])
  })

  it('取数点把 user_id 一起 select 回来了（不取 = 无从剔内部账户）', () => {
    expect(src).toContain("select('event, props, is_qa, user_id, created_at')")
  })
})

describe('规则四：已经做对的两处不许退回去', () => {
  it('growth-funnel 的质量注脚同时剔 is_qa 与内部账户', () => {
    const body = bodyOf(fs.readFileSync(FUNNEL_MODULE, 'utf8'), 'aggregateFunnelQuality')
    expect(body).not.toBeNull()
    expect(body).toContain('is_qa')
    expect(body).toContain('isInternalAccount(')
  })

  it('cohort 回访聚合同时剔 is_qa 与内部账户', () => {
    const body = bodyOf(fs.readFileSync(METRICS_MODULE, 'utf8'), 'aggregateCohortReturns')
    expect(body).not.toBeNull()
    expect(body).toContain('is_qa')
    expect(body).toContain('isInternalAccount(')
  })
})

describe('规则五：迁移里读 flow_events 的 RPC 也要两道过滤', () => {
  /** 去掉整行 `--` 注释后再匹配：注释里提到表名不算取数 */
  const sqlBodies = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .map(f => ({
      file: f,
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')
        .split('\n').filter(l => !l.trim().startsWith('--')).join('\n'),
    }))
  // schema 前缀可省（本仓库现状全带 public.，但规则不该依赖书写习惯）；
  // `create index ... on public.flow_events` 用的是 on，不会误命中
  const readers = sqlBodies.filter(x => /\b(from|join)\s+(public\.)?flow_events\b/i.test(x.sql))

  it('命中集合就是这两个迁移（新增读 flow_events 的函数必须回来登记）', () => {
    expect(readers.map(r => r.file).sort()).toEqual([
      '0064_growth_metrics_funnel.sql',
      '0065_growth_metrics_cohorts.sql',
    ])
  })

  it.each(readers.map(r => [r.file, r.sql] as const))('%s 同时具备 is_qa 与 p_exclude_user_ids', (_f, sql) => {
    expect(sql).toContain('is_qa')
    expect(sql).toContain('p_exclude_user_ids')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 已知漏判 / 误报（改本文件前先读）：
//
// 【漏判】① 只认 `.from('flow_events')` 这一种取数写法。若将来有人把表名放进变量、或改走 RPC
//   （supabase.rpc(...)）读 flow_events，本规则认不出来。RPC 那条路由规则五在 SQL 侧兜着；
//   表名变量化属于「取数入口分叉」，届时应先修分叉，而不是放宽这里。
// 【漏判】② 规则三只看「函数体里有没有调用 isSelfTestRow」，不看它是不是套在了正确的分支上。
//   把调用塞进一个永远进不去的 if 里照样判绿 —— 行为面由 dashboard-flow-events.test.ts
//   的「内部账户不进主口径」那组用例把关，两者缺一不可。
// 【漏判】③ bodyOf 以「第一行顶格 }」判函数结束，依赖本仓库的常规缩进格式；若有人写出顶格 } 的
//   多行字符串/模板，函数体会被截短（结果是【偏严】：截短后找不到调用会变红，不会假绿）。
// 【漏判】④ 扫描跳过 __tests__ 与 *.test.ts。测试夹具里的 flow_events 查询不受本规则约束——
//   它们不产出任何看板数字。
// 【误报】⑤ 三处「命中集合快照」都是硬编码。**新增取数点 / 新增消费函数 / 新增读表迁移时它必然变红，
//   这是设计意图**：逼作者回来登记，顺便当场说清新增的这处该不该带两道过滤。改快照前先确认
//   新增点真的过滤了（或者在 EXEMPTIONS 里写清为什么不用）。
// 【口径】⑥ 本规则只管「剔得掉的」两类。产品方用无痕窗口自测建的匿名账号既不在名册、
//   0053 之前也没有 is_qa 可标，两道过滤都拦不住且无从识别 —— 已知残余，本守卫不假装能挡住。
// ─────────────────────────────────────────────────────────────────────────────
