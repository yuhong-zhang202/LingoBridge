/**
 * @module   qa-flag
 * @desc     QA 流量标记（客户端）—— 把产品方自测流量标出来，好在漏斗统计里把它剔掉。
 *           链路：URL 上带 `?qa=<token>` → 写入 localStorage → apiFetch 每次请求注入 X-QA-Traffic 头
 *           → 服务端拿它与 QA_TRAFFIC_TOKEN 严格比对，命中才把 flow_events.is_qa 标真。
 *
 *   ⚠️ 本标记来自客户端可控输入（URL 参数 → localStorage → 请求头），**可伪造**。
 *   **永久禁止**用于额度 / 权限 / 计费 / RLS 判定，只可写入统计列。
 *   额度判定一律走服务端 `isInternalAccount(userId)`。
 *   一旦把它接上业务闸，「加个 URL 参数就能无限白嫖」立即成立。
 *
 *   本模块【刻意不做任何校验】：token 长什么样、对不对，判定权全在服务端（与 consent 同款纪律 ——
 *   客户端给的一律不信）。客户端只负责原样携带。
 *
 *   本模块【刻意不做自动过期】：忘记关只是少统计一点自己的流量，代价有限且看得见；
 *   静默失效则是「以为标记还在、其实统计已被自测流量污染」，人不会察觉 —— 后者坏得多。
 *   要关就显式关：访问 `?qa=0`。
 *
 * @author   LingoBridge
 * @created  2026-08-02
 */

const KEY = 'lingobridge:qa'

/**
 * 从当前 URL 的 `?qa=` 参数同步 QA 标记到 localStorage。
 *   · `?qa=<非空值>` → 原样写入（不校验，判定权在服务端）；
 *   · `?qa=0`        → 清除标记（唯一的关闭路径）；
 *   · 无 `qa` 参数    → 一个字都不动（保住此前标记，不因普通导航被冲掉）。
 * @returns    无
 * @sideEffect 读 window.location.search，写/删 localStorage；无窗口或 storage 异常时静默跳过
 */
export function syncQaFlagFromUrl(): void {
  if (typeof window === 'undefined') return
  try {
    const v = new URLSearchParams(window.location.search).get('qa')
    if (v === null) return
    if (v === '0') {
      localStorage.removeItem(KEY)
      return
    }
    if (v !== '') localStorage.setItem(KEY, v)
  } catch {
    // 隐私模式 / storage 被禁用等：标记只影响统计，绝不因它打断任何用户流程
  }
}

/**
 * 读本地 QA token，供 apiFetch 注入 X-QA-Traffic 头、以及 QaBadge 判断要不要显示。
 * @returns    本地存的 token 原文；无窗口 / 未标记 / storage 异常一律 null
 */
export function qaToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const v = localStorage.getItem(KEY)
    return v && v !== '' ? v : null
  } catch {
    return null
  }
}
