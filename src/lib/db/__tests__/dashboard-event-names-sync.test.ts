/**
 * @module   dashboard-event-names-sync.test
 * @desc     守卫：看板的事件名清单（dashboard-flow-events.ts 的 FLOW_EVENT_NAMES）必须与埋点契约
 *           （event-schema.ts 的 FlowEventName）【双向一致】—— 契约里有的看板必须登记，
 *           看板里列的契约里必须存在。
 *
 *   【为什么需要这条守卫】FLOW_EVENT_NAMES 是与契约手工对齐的一份副本（不 import 的理由见该文件
 *   顶注：观测面本就该允许与被观测对象短暂不一致）。代价是「加了新事件、忘了同步看板」不会报错。
 *   该文件注释说这种漏改「是可发现的、不是静默的」（看板会把新值显示成 known=false），
 *   但那要求有人天天去看板上对——2026-08-07 一天之内就漏了两次：
 *     · 上午：auth.goal_saved / auth.goal_save_failed / flow.phrase_collected /
 *       flow.phrase_collect_failed 四个漏登记（前两个当时【已经上线】）；
 *     · 下午：补完分母事件后，flow.feedback_rendered / flow.practice_ended /
 *       auth.goal_editor_opened 三个又漏了。
 *   两次都是靠人肉比对才发现的。靠人记 = 一定会再犯，所以钉成机器检查。
 *
 *   【为什么主检查放在编译期而不是运行时】下面两条类型断言在 `npx tsc --noEmit` 阶段就会失败，
 *   比跑测试更早、也更难被绕过：新增事件名的人在本地敲完 tsc 就能看见，不必等 CI 跑到测试那步。
 *   运行时那几条是补充——它们守的是「清单本身被写坏」（清空 / 重复 / 形态不合 DB CHECK）这类
 *   类型系统看不见的问题。
 *
 *   【触发本守卫后怎么办】去 src/lib/db/dashboard-flow-events.ts：
 *     · FLOW_EVENT_NAMES 数组里补上缺的事件名；
 *     · EVENT_LABEL 里补一条中文说明（看板只给 admin 看，仍写人话）。
 *   不要反过来从契约里删事件来「修」这个测试。
 *
 * @author   LingoBridge
 * @created  2026-08-07
 */
// dashboard-flow-events 顶上有 `import 'server-only'`（它是纯观测面、只在服务端跑）。
// 该包在非 Server Component 环境里会直接抛错，故与本仓库其它服务端模块测试同款处理：替身掉。
// ⚠️ 缺了这一行，套件会【加载失败】而非报错失败 —— jest 输出是 "Tests: 0 total"，
//    长得很像「没事」，实际是这条守卫压根没跑。
jest.mock('server-only', () => ({}))

import { FLOW_EVENT_NAMES } from '@/lib/db/dashboard-flow-events'
import type { FlowEventName } from '@/lib/events'

/** 看板清单里出现过的事件名（由数组字面量推出的联合类型） */
type DashboardEventName = (typeof FLOW_EVENT_NAMES)[number]

// ── 编译期双向等价（任一方向缺失都会让 tsc 报错，早于测试）────────────────────────
// 用 [T] extends [never] 而非 T extends never：后者对联合类型会分发，一个都不缺时才成立的判断
// 会在「缺多个」时被拆成多个分支各自求值，反而可能歪打正着通过。加中括号关掉分发。

/** 契约里有、看板清单漏登记的事件名。正常应为 never —— 不是 never 时下一行 tsc 报错。 */
type MissingInDashboard = Exclude<FlowEventName, DashboardEventName>
/** 看板清单里有、契约里已不存在的事件名（改名/删事件时会出现）。正常应为 never。 */
type ExtraInDashboard = Exclude<DashboardEventName, FlowEventName>

/**
 * tsc 报错即代表：有新事件名没登记进 FLOW_EVENT_NAMES。
 * 错误信息会把缺的名字直接列在类型里，照着补到 dashboard-flow-events.ts 即可。
 */
const _noMissingInDashboard: [MissingInDashboard] extends [never] ? true : never = true
/**
 * tsc 报错即代表：看板清单里列了契约里没有的名字（多半是事件被改名/删除后忘了同步看板）。
 * 这一侧同样要管——留着一个永远不会有数据的名字，看板上就是一格恒为 0，看起来像埋点坏了。
 */
const _noExtraInDashboard: [ExtraInDashboard] extends [never] ? true : never = true

// 上面两个常量只为触发类型检查，运行时不用；显式 void 掉，免得被 lint 判成未使用。
void _noMissingInDashboard
void _noExtraInDashboard

// ── 运行时补充：守类型系统看不见的那几种写坏方式 ──────────────────────────────────

/** 事件名形态闸（同 0053 的 DB CHECK 正则）：前缀不在白名单内的名字 insert 会被拒、且被 logEvent 静默吞。 */
const EVENT_NAME_RE = /^(flow|match|quota|auth|page)\./

describe('看板事件名清单 · 与埋点契约同步', () => {
  it('清单非空 —— 防止有人把数组清空后测试照样全绿（编译期检查对空数组无感）', () => {
    expect(FLOW_EVENT_NAMES.length).toBeGreaterThan(0)
  })

  it('清单无重复 —— 重复名会让看板同一个事件出现两行、占比重复计算', () => {
    const seen = new Set<string>()
    const dup = FLOW_EVENT_NAMES.filter((n) => (seen.has(n) ? true : (seen.add(n), false)))
    expect(dup).toEqual([])
  })

  it('清单里每个名字都过 0053 的 DB CHECK 前缀正则 —— 否则该事件写库会被拒且异常被静默吞掉', () => {
    const bad = FLOW_EVENT_NAMES.filter((n) => !EVENT_NAME_RE.test(n))
    expect(bad).toEqual([])
  })
})
