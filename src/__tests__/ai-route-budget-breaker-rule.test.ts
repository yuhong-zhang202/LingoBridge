/**
 * @module   ai-route-budget-breaker-rule.test
 * @desc     全站规则守卫（静态扫描源码，不发请求）：
 *           规则一 —— 凡是【会记 api_usage_logs（= 会花钱）】且【允许匿名会话进入】的 API 路由，
 *                     必须接上全局预算熔断（import 且调用 requireGlobalBudget）。
 *           规则二 —— 熔断调用必须出现在该路由第一处「计次」之前（没花钱就不该扣人额度）。
 *           规则三 —— 迁移 0063 的取数函数必须同时具备三条口径：东八区日界 / 剔 is_qa / 剔内部账户名册。
 *
 *           为什么要立规则一（而不是只给现有 8 条路由写断言）：
 *           熔断是「全站今天烧超了就停」的最后一道止损，它的价值恰恰在于**无论对方从哪条路进来都拦得住**。
 *           明天有人加第 N+1 条花钱的匿名可达路由、忘了接熔断，这道闸就漏了一个口子，而 tsc / eslint /
 *           build / 全部单测都会是绿的 —— 少接一处在类型上完全合法，功能也一切正常，只有真被刷的那天才知道。
 *           本项目已有多次同类教训（GradientButton 默认 type、看板事件名手抄副本、SwipeToDelete 调用方）。
 *           针对现有 8 条路由的行为断言在 api/__tests__/global-budget-breaker-routes.test.ts；
 *           本文件守的是那条通行规则本身。
 *
 *           扫描器的已知边界写在文件末尾的「已知漏判 / 误报」注释里，改动本文件前请先读那段。
 * @author   LingoBridge
 * @created  2026-08-12
 */
import fs from 'fs'
import path from 'path'

/** 扫描根：本文件在 src/__tests__/ 下，上一级即 src/ */
const SRC_DIR = path.resolve(__dirname, '..')
const API_DIR = path.join(SRC_DIR, 'app', 'api')
const MIGRATION_FILE = path.resolve(__dirname, '../../supabase/migrations/0063_global_ai_cost_today.sql')

/** 一条路由的静态画像 */
interface RouteProfile {
  /** 相对 src/app/api/ 的路径，如 'transcribe/route.ts' */
  file: string
  /** 会写 api_usage_logs = 会花钱 */
  billsCost: boolean
  /** 走 requireUserAllowAnon = 匿名会话能进来 */
  allowsAnon: boolean
  /** 接了熔断（import + 调用，两者都要） */
  hasBreaker: boolean
  /** 第一处 requireGlobalBudget( 的字符下标；未接为 -1 */
  breakerAt: number
  /** 第一处「计次」调用的字符下标；无计次为 -1 */
  countAt: number
}

/**
 * 递归收集 src/app/api 下的 route.ts
 * @param dir 起始目录（绝对路径）
 * @returns   route.ts 绝对路径数组；跳过 __tests__（夹具不是产品代码）
 */
function collectRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      out.push(...collectRouteFiles(full))
    } else if (entry.name === 'route.ts') {
      out.push(full)
    }
  }
  return out
}

/** 「计次」的三个入口：日额度原子递增、整理专用递增、以及 transcribe 的只读早退。 */
const COUNT_CALLS = ['bumpDailyUsageServer(', 'bumpAnonRestructureTodayServer(', 'readDailyUsageServer(']

/**
 * 读一条路由的静态画像
 * @param  full  route.ts 绝对路径
 * @returns      画像
 */
function profile(full: string): RouteProfile {
  const src = fs.readFileSync(full, 'utf8')
  const firstOf = (needles: string[]): number => {
    const hits = needles.map((n) => src.indexOf(n)).filter((i) => i >= 0)
    return hits.length > 0 ? Math.min(...hits) : -1
  }
  return {
    file: path.relative(API_DIR, full),
    billsCost: src.includes("from '@/lib/api-logger'"),
    allowsAnon: src.includes('requireUserAllowAnon'),
    hasBreaker: src.includes("from '@/lib/global-budget-breaker'") && src.includes('requireGlobalBudget('),
    breakerAt: src.indexOf('requireGlobalBudget('),
    countAt: firstOf(COUNT_CALLS),
  }
}

const PROFILES = collectRouteFiles(API_DIR).map(profile).sort((a, b) => a.file.localeCompare(b.file))

describe('规则一：会花钱 + 允许匿名 ⇒ 必须接全局预算熔断', () => {
  it('扫描器没有空转（扫到了足够多的 route.ts，且识别出了记账路由）', () => {
    // 扫描器一旦因为目录改名/正则失配而扫到 0 个文件，下面所有断言都会「因为没有反例」而变绿。
    expect(PROFILES.length).toBeGreaterThanOrEqual(20)
    expect(PROFILES.filter((p) => p.billsCost).length).toBeGreaterThanOrEqual(9)
  })

  it('每一条【会花钱且匿名可达】的路由都接了熔断', () => {
    const missing = PROFILES.filter((p) => p.billsCost && p.allowsAnon && !p.hasBreaker).map((p) => p.file)
    expect(missing).toEqual([])
  })

  it('命中集合就是当前这 8 条（新增花钱的匿名路由必须在这里显式登记）', () => {
    const hit = PROFILES.filter((p) => p.billsCost && p.allowsAnon).map((p) => p.file)
    expect(hit).toEqual([
      'analysis/phrases/route.ts',
      'analysis/route.ts',
      'matching/route.ts',
      'practice/polish/route.ts',
      'practice/route.ts',
      'pronounce/route.ts',
      'restructure/route.ts',
      'transcribe/route.ts',
    ])
  })

  it('会花钱但【匿名进不来】的路由只有 anki drain（cron 端点，其花费全部归属注册用户）', () => {
    // 熔断只对匿名生效（产品方拍板），故 drain 接上去恒不触发 = 死代码，刻意不接。
    // 这条断言的作用：哪天有人给一条 cron/内部端点开了匿名入口，或新增一条不走 requireUserAllowAnon
    // 的花钱路由，这里会变红，逼作者当场说清「它该不该被熔断挡住」，而不是默默漏掉。
    const billedNoAnon = PROFILES.filter((p) => p.billsCost && !p.allowsAnon).map((p) => p.file)
    expect(billedNoAnon).toEqual(['anki/generate/drain/route.ts'])
  })
})

describe('规则二：熔断必须拦在「计次」之前', () => {
  it.each(PROFILES.filter((p) => p.hasBreaker && p.countAt >= 0).map((p) => [p.file, p] as const))(
    '%s 的第一处熔断调用出现在第一处计次之前',
    (_file, p) => {
      // 顺序守的是【结构】不是执行序：源码里靠前不等于运行时先执行。真正的「被拦下时一次都没计次」
      // 由 api/__tests__/global-budget-breaker-routes.test.ts 的行为断言把关，本条只防「位置写错」。
      expect(p.breakerAt).toBeGreaterThanOrEqual(0)
      expect(p.breakerAt).toBeLessThan(p.countAt)
    },
  )
})

describe('规则三：取数口径三条都在迁移里', () => {
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8')

  it('日界是东八区（不是 current_date / UTC）', () => {
    expect(sql).toContain("now() at time zone 'Asia/Shanghai'")
    expect(sql).not.toContain('current_date')
  })

  it('剔除 QA 自测流量，且用 is not true（保住 NULL 行，宁可少剔绝不错剔）', () => {
    expect(sql).toContain('is_qa is not true')
    expect(sql).not.toContain('is_qa = false')
  })

  it('内部账户名册由调用方传参（SQL 里不另抄一份 id）', () => {
    expect(sql).toContain('p_exclude_user_ids')
    // 名册里的真实 id 只应出现在 TS 的 internal-accounts.ts，SQL 里出现即是抄了第二份、必然漂移
    expect(sql).not.toMatch(/a1af125c-9446-4a7c-aa5d-aea09cf9e798/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 已知漏判 / 误报（改本文件前先读）：
//
// 【漏判】① 判「会花钱」用的是 `from '@/lib/api-logger'`。若将来有人绕过 api-logger 直接
//   insert api_usage_logs，或新起一个记账模块，本规则认不出来 —— 那属于「记账入口分叉」，
//   本身就该被拦下（api-logger 顶注写明它是唯一入口），届时应先修那件事，而不是放宽这里。
// 【漏判】② 判「匿名可达」用的是 `requireUserAllowAnon`。若有路由自行解析 JWT 判匿名，同样认不出来。
//   全仓当前只有 api-auth 一处出口，同上：分叉了先修分叉。
// 【漏判】③ 只看「有没有调用」，不看「调用在哪个分支里」。例如把熔断塞进一个永远进不去的
//   if 里，本规则照样判绿 —— 行为面由 global-budget-breaker-routes.test.ts 的 10 个入口守。
// 【误报】④ 规则一命中集合是硬编码快照。**新增花钱的匿名路由时它必然变红，这是设计意图**：
//   逼作者回来把新路由登记进来，顺便确认熔断真的接上了。改这个数组前先确认新路由已接熔断。
// ─────────────────────────────────────────────────────────────────────────────
