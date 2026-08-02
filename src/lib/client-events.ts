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

/** 客户端可上报的事件名（须与 /api/events 的分发表逐一对应，服务端未注册即 400） */
export type ClientEventName =
  | 'flow.story_entry'
  | 'flow.mic_permission'
  | 'flow.capture_started'
  | 'flow.capture_submitted'
  | 'flow.capture_abandoned'
  | 'flow.ai_call'
  | 'match.view_rendered'
  | 'match.question_opened'

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
 * 清空上面那个缓存。**登出时必须调用**（`lib/auth.ts` 的 `logout()` 里与 clearFlowId 并排）。
 *
 * 【为什么必须清】Supabase `signOut` 之后，已签发的 access_token 作为无状态 JWT 到 exp 前【仍然验得过】，
 * 不会自然 401 失效。A 登出后模块不卸载、缓存仍是 A 的 Bearer，此时同一标签页里谁再写点东西然后关掉，
 * keepalive 路径就会带着【A 的 token】把这条 capture_abandoned 发出去 —— 这条「放弃」被记到 A 头上；
 * A 若是内部账户，还会连带被标成 is_qa。只污染埋点归属、不构成越权，但正是本批一直在修的那类静默偏差。
 */
export function clearAuthCache(): void {
  cachedAuthorization = ''
}

/** /api/events 的请求体形态（keepalive 路径与常规路径共用同一份，避免两路字段分叉）。 */
interface EventBody {
  event: ClientEventName
  storyId: string | null
  props: Record<string, string | number | boolean>
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
 * 上报一条客户端埋点事件。fire-and-forget：不返回 Promise、绝不 await、绝不进任何 if 条件、
 * 不影响任何调用方的返回值或跳转 —— 埋点失败必须对用户完全无感（沿用 matching/page.tsx 已验证的范式）。
 *
 * 刻意【不做本地队列、不做重试】：重试会让同一次动作被计多次，distinct 计数与漏斗转化率随即失真；
 * 埋点丢几条只是分母略小，重复计数则是把结论算错 —— 后者坏得多。
 *
 * @param  event  事件名（须在服务端分发表里注册）
 * @param  props  事件字段（枚举串/数字/布尔，无原文）
 * @param  opts   storyId = corpus.id（有则带）；keepalive = 页面离开时上报（pagehide/卸载路径必须传 true）
 * @returns       无
 * @sideEffect    POST /api/events；无 session 时静默不发（全新访客首页尚无 session，
 *                不短路会打出一串 401 噪音）；任何失败一律吞掉
 */
export function track(
  event: ClientEventName,
  props: ClientEventProps,
  opts?: { storyId?: string; keepalive?: boolean },
): void {
  if (typeof window === 'undefined') return
  const body: EventBody = { event, storyId: opts?.storyId ?? null, props: normalize(props) }
  // 卸载路径：缓存里有 token 就【同步】发，一个 await 都不许有（理由见顶注「keepalive 生效的前提」）。
  if (opts?.keepalive && cachedAuthorization) {
    sendKeepalive(body)
    return
  }
  // 常规路径：行为与改动前逐字一致，仅多一句「顺手把 token 存进缓存」（无可观察副作用）。
  void (async () => {
    const headers = await authHeaders()
    // 取不到 token（未登录/已登出）时【也要清缓存】：不清的话，登出后缓存仍是上一个账号的 Bearer，
    // 卸载路径会拿它继续发事件、把归属记错人（见 clearAuthCache 顶注）。
    if (!headers.Authorization) { cachedAuthorization = ''; return }
    cachedAuthorization = headers.Authorization
    await apiFetch('/api/events', {
      method: 'POST',
      keepalive: opts?.keepalive,
      json: body,
    })
  })().catch(() => {})
}
