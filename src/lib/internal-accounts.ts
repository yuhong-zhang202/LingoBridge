/**
 * @module   internal-accounts
 * @desc     产品方自用/内部账户名册 —— 这些 user_id 豁免所有产品限额（日额度 + 月额度闸），
 *           且从 Dashboard 全部经营指标中排除，避免自用测试污染成本/活跃/故障口径。
 *           client 与 server 均可 import（【刻意不加 'server-only'】：额度卡等客户端组件也要据此改显示）。
 * @author   LingoBridge
 * @created  2026-08-01
 */

/**
 * 内部账户 user_id 白名单（安全边界：豁免只对此集合内的 id 生效，普通用户口径一字不变）。
 * 将来新增内部账户，直接往这个 Set 里加一行 user_id 即可 —— 用 id 不用 email，
 * 免去到 auth.users 做 join、client 端也拿得到。
 */
export const INTERNAL_ACCOUNT_IDS: ReadonlySet<string> = new Set<string>([
  'a1af125c-9446-4a7c-aa5d-aea09cf9e798', // bujishanchuan@gmail.com（产品方自用测试账户）
])

/**
 * 判断某 user_id 是否为内部账户（null/undefined 一律非内部，避免匿名/未登录误命中）。
 * @param  userId  待判定的用户 id（可空）
 * @returns        是内部账户 true，否则 false
 */
export function isInternalAccount(userId: string | null | undefined): boolean {
  return !!userId && INTERNAL_ACCOUNT_IDS.has(userId)
}
