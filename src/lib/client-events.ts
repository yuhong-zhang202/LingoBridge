/**
 * @module   client-events
 * @desc     客户端埋点上报的【唯一】封装 —— 页面/hook 一律经 track() 上报，不再各写各的 fetch。
 *           走 apiFetch → POST /api/events → 服务端 sanitize 白名单 → logEvent 落 flow_events。
 *           仅供 'use client' 链路引用：禁止 import 'server-only'、禁止引用 supabase-server。
 *
 *   ⚠️⚠️ 绝对不要改用 navigator.sendBeacon ⚠️⚠️
 *   sendBeacon **无法设置任何请求头**，而 /api/events 第一行就是 requireUserAllowAnon(req)、读
 *   Authorization: Bearer。用它 = 100% 收 401、数据全丢；又因 fire-and-forget 吞掉错误，
 *   本地测不出来、只会以为埋成功了。页面离开时的上报一律用 fetch keepalive（opts.keepalive）。
 *
 *   ⚠️⚠️ keepalive 生效的前提：**fetch 必须在页面卸载【之前】就被创建出来** ⚠️⚠️
 *   keepalive 保的是「已发出的请求在页面消失后继续跑完」，它保不了「还没发出的请求」。
 *   故本文件的 keepalive 路径（sendKeepalive）【不允许出现任何 await / then / 异步取值】：
 *   Authorization 走下面的模块级缓存同步取，flow_id / QA token 走同步 storage 读。
 *   原实现是「先 await authHeaders()（内部 supabase getSession()）再 fetch」——本地 session 命中时它很快，
 *   但 getSession 可能要抢 navigator 锁、token 过期时还会发网络刷新，卸载窗口里跑不完就等于请求根本没发出。
 *   这里不赌它快，直接把这条路上的异步全部消掉。
 *
 *   ⚠️ 2026-08-02 实测澄清（别把下面这条当成「已经修好了」）：改成同步发之后，整页离开的
 *   capture_abandoned 送达率**没有可测改善**（同条件 A/B：改前 6/10 落库、改后 7/9、复测 4/7 与 2/8）。
 *   受控取证结论是丢失点不在这段 await：
 *     · 「DB 侧 pagehide 0/5」的直接原因是 **pagehide 的 e.persisted=1（bfcache）**，
 *       而 recording/write 两页刻意「persisted=true 不报」（见各自 useEffect 注释）—— 代码根本没走到 track。
 *     · 关掉 bfcache 后（真卸载），改前也照样创建出了带 Authorization 的 keepalive fetch（页面内 fetch 包装探针）。
 *     · 前置代理取证：一次 8 个已创建的 keepalive 请求只有 2 个到达服务端，而**到达的 100% 落库**
 *       （代理 200 → flow_events 行数一一对应）。⇒ 残余丢失在「浏览器已创建 → 请求真的发出去」这段，
 *       服务端与落库没有问题。
 *   所以「关标签页/地址栏跳走的放弃事件偏低」这个指标问题仍然开着，需要重新归因（bfcache 口径 + keepalive
 *   在导航中的丢包），不是本文件能解决的。别因为这里改成了同步就以为漏斗「放弃」那一格已经准了。
 *
 *   ⚠️ 数据口径警告：【分析 P0 事件时必须忽略 flow_id，一律按 user_id 聚合】—— 用 flow_id 串会串错流程。
 *   理由（2026-08-02 更新，原写的「newFlowId() 位于早退分支之后」已被 commit 3e07e53 修掉、不再成立）：
 *   capture_started / capture_abandoned 是在页面【挂载/卸载】时报的，早于本次流程的任何 newFlowId()
 *   调用（那是在点「完成」/「提交」时才换的）。故这两条事件携带的是 sessionStorage 里【上一次流程】
 *   的 flow_id —— 事件本身没错，错的是拿它当本次流程的 join key。结论未变，别因为原理由已过期就推翻它。
 *
 * @author   LingoBridge
 * @created  2026-08-02
 */
import { apiFetch, authHeaders } from '@/lib/api-client'
import { currentFlowId } from '@/lib/flow-id'
import { qaToken } from '@/lib/qa-flag'
import { QUEUE_DELAY_SEC_KEY, QUEUE_DELAY_SEC_MAX } from '@/lib/event-schema'
import type { ClientEventName, ClientEventPropsMap } from '@/lib/event-schema'

// 事件名与各事件的 props 契约【一律来自 lib/event-schema.ts】，本文件不再手抄一份。
// 转出 ClientEventName 是为了让既有调用方（含测试）继续从这里 import，不改它们的引用路径。
export type { ClientEventName }

/** 事件 props：只允许枚举串 / 数字 / 布尔；undefined 视为「本次没这个字段」直接丢弃。绝不放原文（隐私铁律）。 */
export type ClientEventProps = Record<string, string | number | boolean | undefined>

/**
 * 规范化 props：丢 undefined、数字统一 Math.round、非有限数（NaN/Infinity）直接丢。
 * 取整的理由：服务端 sanitize 用 Number.isInteger 校验，浮点会被静默丢弃 —— 与其到服务端丢，
 * 不如在源头取整，免得「上报了但库里没有」这种查不出来的空洞。
 * @param  props  原始 props
 * @returns       规范化后的 props
 */
function normalize(props: ClientEventProps): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out[k] = Math.round(v)
      continue
    }
    out[k] = v
  }
  return out
}

/**
 * 最近一次成功取到的 Authorization 头值（模块级缓存），仅供 keepalive 卸载路径【同步】取用。
 * 由正常上报路径每次 authHeaders() 成功后顺手写入 —— 卸载前页面上必已发过至少一条埋点
 * （capture_started 在采集开始时就报了），故缓存到那时几乎必然是热的。
 * 空串 = 还没热起来，此时 keepalive 路径退回 await 版（那种情况本来也丢，不算退步）。
 * 【刻意不做刷新】：token 过期会让偶尔一条埋点收 401 丢掉，可接受——埋点本就不保证送达；
 * 为它引入刷新逻辑就等于在卸载路径上加异步，正是顶注那个坑。
 */
let cachedAuthorization = ''

/**
 * 清空上面那个缓存 **以及本地补发队列**。
 * **登录成功后与登出时都必须调用**（`lib/auth.ts` 的 `loginWithPassword()` / `logout()` 里，与 clearFlowId 并排）。
 *
 * 【为什么必须清缓存】Supabase `signOut` 之后，已签发的 access_token 作为无状态 JWT 到 exp 前【仍然验得过】，
 * 不会自然 401 失效。A 登出后模块不卸载、缓存仍是 A 的 Bearer，此时同一标签页里谁再写点东西然后关掉，
 * keepalive 路径就会带着【A 的 token】把这条 capture_abandoned 发出去 —— 这条「放弃」被记到 A 头上；
 * A 若是内部账户，还会连带被标成 is_qa。只污染埋点归属、不构成越权，但正是本批一直在修的那类静默偏差。
 *
 * 【为什么必须【同时】清队列·这是补发队列最危险的一条】队列里躺的是「A 在场时没发出去的事件」，
 * 补发是在【补发那一刻的身份】下发生的 —— 共用设备上 A 登出、B 登录，A 的队列就会被原样记到 B 头上。
 * 这比丢事件坏得多：丢是分母小一点，记错人是把两个人的行为搅在一起，事后无法分离、也无法发现。
 * ⇒ 立场固定为【宁可丢，不可记错人】：身份一变，队列整个扔掉，不做任何「尽量抢救」。
 * ⚠️ 将来若新增别的身份切换入口（换号、删号、recovery 会话等），必须一并调用本函数。
 * @returns    无
 * @sideEffect 清模块级 Authorization 缓存 + 删除 localStorage 里的补发队列（存储不可用时静默跳过）
 */
export function clearAuthCache(): void {
  cachedAuthorization = ''
  dropOutbox()
}

/** /api/events 的请求体形态（keepalive 路径与常规路径共用同一份，避免两路字段分叉）。 */
interface EventBody {
  event: ClientEventName
  storyId: string | null
  props: Record<string, string | number | boolean>
}

// ── 补发队列（outbox）─────────────────────────────────────────────────────────────────
//
// 【它解决什么】track 此前对两类失败一律【直接丢弃】：拿不到 token（`if (!headers.Authorization) return`）
//   与请求失败。而「拿不到 token」恰恰与最要命的一档失败强相关 —— flow.phrase_collect_failed 的
//   reason='session_failed' 就是「没有会话」，那一档很可能连上报都发不出去，导致它在库里【系统性偏低】。
//   本队列把这类事件暂存本地，下次有会话时补发，把偏差收窄。
//
// 【它明确不解决什么·别把它当「送达保证」】
//   · 用户再也没回来过 → 队列永远没有下一次 track，事件跟着设备一起消失；
//   · 用户清了浏览器数据 / 用隐私模式 / 浏览器策略禁用存储 → 队列本身就存不下来，退回今天的行为（丢弃）；
//   · 卸载路径（keepalive）失败无从得知，不进队列。
//   ⇒ 它只把「有会话时的重试」补上，方向是【只减少低估、不会造成高估】，但不消除低估。
//
// 【为什么这不违背 track 顶注「刻意不做本地队列、不做重试」】那条立场反对的是【重复计数】：
//   同一次动作被计多次会让 distinct 与转化率失真。本实现用「取走即清空、补发失败不再回队」保证
//   每条事件最多被投递两次（首发一次 + 补发一次），且首发只在【确知没送到】时才入队：
//     · 拿不到 token（请求根本没发出）、
//     · fetch 抛错（网络层失败）、
//     · 401 / 5xx（服务端明确没记账）。
//   4xx（除 401）不入队：那是事件本身不合契约，重发一万次也是同样结果，只会白打接口。

/** 补发队列在 localStorage 的键（与 flow-id / qa-flag 同款 `lingobridge:` 前缀）。 */
const OUTBOX_KEY = 'lingobridge:event_outbox'
/**
 * 队列条数上限，满了【丢最旧的】。
 * 20 条的依据：埋点在真实链路上是几秒一条的量级，攒到 20 条还没有会话，说明这台设备处在
 * 「长时间没有会话」的异常态，再攒下去只是把 localStorage 当垃圾桶；且丢旧留新更贴近
 * 「补发是为了看清最近发生了什么」。⚠️ 必须封顶：无上限的本地队列会被异常态无限撑大。
 */
const OUTBOX_MAX = 20

/** 队列里的一条：事件体 + 入队时刻（补发时据此算 queueDelaySec）。 */
interface OutboxItem {
  body: EventBody
  /** Date.now()，毫秒 */
  at: number
}

/**
 * 读队列。存储不可用 / 内容被外部改坏（非数组、条目缺字段）一律当【空队列】并把脏值删掉 ——
 * 绝不让一段坏 JSON 把后续所有补发永久堵死。
 * @returns 队列条目数组（异常时为空数组）
 */
function readOutbox(): OutboxItem[] {
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) { dropOutbox(); return [] }
    return parsed.filter((it): it is OutboxItem => {
      if (typeof it !== 'object' || it === null) return false
      const { body, at } = it as { body?: unknown; at?: unknown }
      if (typeof at !== 'number' || !Number.isFinite(at)) return false
      if (typeof body !== 'object' || body === null) return false
      return typeof (body as { event?: unknown }).event === 'string'
    })
  } catch {
    // 存储被禁用 / JSON 坏了：当作没有队列，绝不外抛（调用方全在埋点路径上）
    return []
  }
}

/**
 * 删除整个队列。存储不可用时静默跳过。
 * @returns 无
 * @sideEffect localStorage.removeItem
 */
function dropOutbox(): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(OUTBOX_KEY)
  } catch {
    /* 存储不可用：本来也没存进去，无事可做 */
  }
}

/**
 * 事件入队（发不出去时调用）。超过 OUTBOX_MAX 丢最旧的。
 * 写入失败（存储被禁 / 配额满）一律吞掉 —— 退回本次改动前的行为：这条事件就此丢弃。
 * @param  body  已规范化的事件体
 * @returns      无
 * @sideEffect   localStorage 写入一条
 */
function enqueue(body: EventBody): void {
  try {
    const next = [...readOutbox(), { body, at: Date.now() }].slice(-OUTBOX_MAX)
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(next))
  } catch {
    /* 存储不可用 / 写满：静默丢弃这条事件（= 本次改动前的既有行为，不是退步） */
  }
}

/**
 * 取走并清空队列（读 + 删是一个【同步】动作，故不存在两个 flush 拿到同一批的竞态）。
 * @returns 取走的条目（可能为空数组）
 * @sideEffect 清空 localStorage 里的队列
 */
function takeOutbox(): OutboxItem[] {
  const items = readOutbox()
  if (items.length > 0) dropOutbox()
  return items
}

/**
 * 补发队列里的全部事件。**只在已确认拿到 token 之后调用**（否则补发必然 401、白打一轮接口）。
 *
 * 【每条最多补发一次】队列在开头就被整个取走清空，失败【不回队】。这是「绝不无限重试打爆接口」
 * 与「绝不重复计数」两条约束的共同实现方式，也让最坏情况有个死上界：一次 flush 最多 OUTBOX_MAX 个请求。
 * 【超龄丢弃】躺过 QUEUE_DELAY_SEC_MAX 的条目直接扔（越老越可能跨过一次账号切换，理由见该常量）。
 * 【不阻塞】调用方不 await 本函数；本函数内部也不 await 各条请求，失败一律吞掉。
 * @returns    无
 * @sideEffect 清空本地队列并对每条发一次 POST /api/events（带上 queueDelaySec 元字段）
 */
function flushOutbox(): void {
  const now = Date.now()
  for (const item of takeOutbox()) {
    const delaySec = Math.round((now - item.at) / 1000)
    // 负数（用户改过系统时钟 / 跨设备同步来的脏值）按 0 记：宁可说「没延迟」，也不写一个服务端会丢掉的非法值。
    if (delaySec > QUEUE_DELAY_SEC_MAX) continue
    const body: EventBody = {
      ...item.body,
      props: { ...item.body.props, [QUEUE_DELAY_SEC_KEY]: delaySec > 0 ? delaySec : 0 },
    }
    // 补发失败【不回队】：这条就此丢弃（见上方「每条最多补发一次」）。
    void apiFetch('/api/events', { method: 'POST', json: body }).catch(() => {})
  }
}

/**
 * 这次上报失败要不要留着下次补发。
 * 只有「服务端明确没记这一笔、而且下次可能就好了」的状态才值得留：401（token 过期/掉了）与 5xx（服务端故障）。
 * 其余 4xx 是事件本身不合契约（事件名没注册 / body 不合法），重发多少次都一样，留着只是白打接口。
 * @param  status  本次响应的 HTTP 状态码
 * @returns        true = 入队等下次补发
 */
function shouldRequeue(status: number): boolean {
  return status === 401 || status >= 500
}

/**
 * 卸载路径专用发送：**全同步**组头 + 立即创建 fetch(keepalive)，中途不 await 任何东西。
 * 头部字段与 apiFetch 注入的保持一致（Authorization / Content-Type / X-Flow-Id / X-QA-Traffic），
 * 之所以不复用 apiFetch：它内部 `await authHeaders()`，一 await 就回到本文件顶注记的那个坑。
 * @param  body  已规范化的事件体
 * @returns      无
 * @sideEffect   同步读 sessionStorage(flow_id) / localStorage(QA token) 并发出 POST；任何失败一律吞掉
 */
function sendKeepalive(body: EventBody): void {
  try {
    // 这两行【必须在 try 内】：flow-id 读 sessionStorage、qaToken 读 localStorage，
    // 浏览器策略禁用存储时会同步抛出，而本函数跑在 pagehide 监听器里 —— 抛出去就成了用户可见的报错。
    const flowId = currentFlowId()
    const qa = qaToken()
    void fetch('/api/events', {
      method: 'POST',
      keepalive: true,
      headers: {
        Authorization: cachedAuthorization,
        'Content-Type': 'application/json',
        ...(flowId ? { 'X-Flow-Id': flowId } : {}),
        ...(qa ? { 'X-QA-Traffic': qa } : {}),
      },
      body: JSON.stringify(body),
    }).catch(() => {})
  } catch {
    // Headers 构造 / JSON 序列化等同步抛错：埋点失败必须对用户完全无感
  }
}

/**
 * 上报一条客户端埋点事件。事件名与 props 由 event-schema 的契约收窄：key 写错 / 枚举值写错 /
 * 漏传必填字段一律【tsc 编译报错】—— 挡的正是「事件照常落库、只有那一个字段静默消失」这类
 * 本地测不出来、几周后才发现某维度全空的哑故障。
 *
 * fire-and-forget：不返回 Promise、绝不 await、绝不进任何 if 条件、
 * 不影响任何调用方的返回值或跳转 —— 埋点失败必须对用户完全无感（沿用 matching/page.tsx 已验证的范式）。
 *
 * ⚠️【2026-08-07 修正】原注释写的是「刻意不做本地队列、不做重试」，理由是重试会让同一次动作被计多次、
 * 把 distinct 与转化率算错。**那条理由仍然成立，被推翻的只是「所以什么都不做」这个结论**：
 * 无会话时直接丢弃，恰好把「没有会话」这一档失败（collect 的 session_failed）系统性抹掉。
 * 现在走本地补发队列（见下方 outbox 段），并用「取走即清空 + 失败不回队」把投递次数钉死在
 * 最多两次、且只在【确知没送到】时才留 —— 重复计数这条红线没有放松。
 *
 * @param  event  事件名（须在服务端分发表里注册）
 * @param  props  事件字段（枚举串/数字/布尔，无原文）
 * @param  opts   storyId = corpus.id（有则带）；keepalive = 页面离开时上报（pagehide/卸载路径必须传 true）
 * @returns       无
 * @sideEffect    POST /api/events；无 session 时【不发、转入本地补发队列】（全新访客首页尚无 session，
 *                当场发只会打出一串 401 噪音）；顺带补发队列里的旧事件；任何失败一律吞掉
 */
export function track<E extends ClientEventName>(
  event: E,
  props: ClientEventPropsMap[E],
  opts?: { storyId?: string; keepalive?: boolean },
): void {
  if (typeof window === 'undefined') return
  const body: EventBody = { event, storyId: opts?.storyId ?? null, props: normalize(props) }
  // 卸载路径：缓存里有 token 就【同步】发，一个 await 都不许有（理由见顶注「keepalive 生效的前提」）。
  if (opts?.keepalive && cachedAuthorization) {
    sendKeepalive(body)
    return
  }
  // 常规路径。
  void (async () => {
    const headers = await authHeaders()
    // 取不到 token（未登录/已登出）时【也要清缓存】：不清的话，登出后缓存仍是上一个账号的 Bearer，
    // 卸载路径会拿它继续发事件、把归属记错人（见 clearAuthCache 顶注）。
    if (!headers.Authorization) {
      cachedAuthorization = ''
      // 【改动前是直接 return 丢弃】而「没有会话」正是最要命的那一档失败的成因本身
      //（collect 的 reason='session_failed'），丢弃 = 那一档在库里系统性偏低。改为暂存待补发。
      enqueue(body)
      return
    }
    cachedAuthorization = headers.Authorization
    try {
      const res = await apiFetch('/api/events', {
        method: 'POST',
        keepalive: opts?.keepalive,
        json: body,
      })
      // 这一条都没送到，说明「有 token」只是表象（token 过期 / 服务端故障）。
      // 此时【绝不能去补发】：队列是「取走即清空、失败不回队」的，在这一刻烧掉等于把攒下的事件
      // 全部丢光，正好挑在最不该丢的时候。留到下一次真的发成功了再补。
      if (shouldRequeue(res.status)) { enqueue(body); return }
    } catch {
      // fetch 抛错 = 网络层失败，服务端一定没记这一笔 → 留着下次补；同样不在此刻补发（理由同上）
      enqueue(body)
      return
    }
    // 【补发时机】刚刚**实测**这条发成功了 —— 这是全流程里唯一一个「已经证明现在发得出去、
    // 又不用额外花一次 getSession」的点，补发成功率最高。
    // 不另设定时器 / 不挂 online 事件 / 不在模块加载时跑：那些时机都得自己再问一次会话
    //（可能没有 → 整队列立刻全数失败又不回队 = 白丢），还多一份生命周期要维护。
    // 不 await：补发绝不许拖慢本条事件，更不许拖住调用方（fire-and-forget 纪律）。
    flushOutbox()
  })().catch(() => {})
}
