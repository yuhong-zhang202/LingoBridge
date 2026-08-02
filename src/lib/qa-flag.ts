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
 *   校验分两层，别混为一谈：
 *   · **语义校验（这个 token 对不对）在服务端**——判定权全在服务端（与 consent 同款纪律：客户端给的一律不信），
 *     本模块绝不判断 token 是否有效、也不因此少带一个头。
 *   · **形态校验（这串能不能当 HTTP header 值）在客户端**——这是自保，与上一条不冲突。
 *     `?qa=` 的值会被写进 localStorage 并由 apiFetch 塞进 X-QA-Traffic 头，而 fetch 的 Headers 只接受
 *     ByteString：非 ASCII（如 `?qa=中`）或含换行的值会让 Headers 构造直接抛 TypeError，
 *     **请求根本发不出去** → 受害者的同意/转写/整理/建语料/匹配/练习全线报错；又因本模块刻意不自动过期，
 *     这一状态会永久卡住（除非知道 `?qa=0`）。一条链接即可让人全站瘫痪，故写入/读出两处都过白名单。
 *
 *   白名单取 URL 安全字符集 [A-Za-z0-9._~-]、长度 1..64：真 token 由产品方配置、本就是这个形态，
 *   收窄不影响任何正常用法；不命中即当作「没有这个标记」，宁可少标一条自测流量，绝不让页面瘫痪。
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
 * QA token 的【形态】白名单（不是语义校验，见顶注）：URL 安全字符集，长度 1..64。
 * 只要不命中，就说明这串当不了合法的 HTTP header 值（或长得不像 token），一律当作没有标记。
 */
const QA_TOKEN_RE = /^[A-Za-z0-9._~-]{1,64}$/

/**
 * 从当前 URL 的 `?qa=` 参数同步 QA 标记到 localStorage。
 *   · `?qa=<合法形态值>` → 写入（形态白名单见 QA_TOKEN_RE；是否有效仍由服务端判）；
 *   · `?qa=0`            → 清除标记（唯一的关闭路径）；
 *   · `?qa=<非法形态值>` → 当作没这个标记，一个字都不写（防「一条链接瘫痪全站」，见顶注）；
 *   · 无 `qa` 参数        → 一个字都不动（保住此前标记，不因普通导航被冲掉）。
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
    if (QA_TOKEN_RE.test(v)) localStorage.setItem(KEY, v)
  } catch {
    // 隐私模式 / storage 被禁用等：标记只影响统计，绝不因它打断任何用户流程
  }
}

/**
 * 读本地 QA token，供 apiFetch 注入 X-QA-Traffic 头、以及 QaBadge 判断要不要显示。
 * 读出口【再过一遍】同一形态白名单：本次修复之前写进去的历史脏值（含非 ASCII / 换行）
 * 仍躺在受害者的 localStorage 里，只在写入侧拦截救不了他们 —— 那些设备会一直发不出请求。
 * @returns    本地存的 token；无窗口 / 未标记 / 形态非法 / storage 异常一律 null
 */
export function qaToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const v = localStorage.getItem(KEY)
    return v !== null && QA_TOKEN_RE.test(v) ? v : null
  } catch {
    return null
  }
}
