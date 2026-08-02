/**
 * @module   qa-traffic
 * @desc     【仅服务端】判定一次请求是否属于「QA 流量」（= 产品方自测），供各埋点写入点标 is_qa。
 *           抽成单一入口的理由：共 4 处调用（events / consent / corpus / matching），
 *           而这里的 fail-closed 写法一旦在某一处抄错，就是「全站流量被标成 QA、统计整段作废」。
 *           一处实现、一处校验，不给复制粘贴留机会（ENGINEERING §1）。
 *
 *   ⚠️ X-QA-Traffic 头来自客户端可控输入（URL 参数 → localStorage → 请求头），**可伪造**。
 *   **永久禁止**用于额度 / 权限 / 计费 / RLS 判定，只可写入统计列。
 *   额度判定一律走 isInternalAccount(userId)。
 *   一旦把它接上业务闸，「加个 URL 参数就能无限白嫖」立即成立。
 *
 * @author   LingoBridge
 * @created  2026-08-02
 */
import 'server-only'
import { env } from '@/lib/env-server'
import { isInternalAccount } from '@/lib/internal-accounts'

/**
 * 判定本次请求是否记作 QA 流量。
 * 两条独立来源，任一命中即真：
 *   ① 请求头 X-QA-Traffic 与服务端 QA_TRAFFIC_TOKEN 【严格 ===】相等（token 未配置时恒不匹配 = fail-closed）；
 *   ② userId 在内部账户名册里（服务端权威、不可伪造）。
 * @param  req     本次请求（只读 header，不消费 body）
 * @param  userId  已鉴权的用户 id（可空）
 * @returns        记作 QA 流量则 true
 */
export function isQaRequest(req: Request, userId: string | null | undefined): boolean {
  const configured = env.qaTrafficToken
  // 先判 configured 非空：未配 token 时必须任何头都不匹配，绝不允许 ''==='' / undefined===undefined 判真
  const headerHit = configured !== '' && req.headers.get('x-qa-traffic') === configured
  return headerHit || isInternalAccount(userId)
}
