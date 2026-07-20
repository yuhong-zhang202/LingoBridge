/**
 * @module   consent-audit
 * @desc     【仅服务端】同意记录的「最小化审计痕迹」—— 删号时在硬删 consent_records 之前，
 *           先把每条同意折算成一行【不含任何可识别信息】的痕迹写入 consent_audit（migration 0025），
 *           用于日后向监管自证「该用户确实看过并同意过某版本的披露范围」。
 *           唯一的比对入口是加盐邮箱哈希：申诉者报得出自己的邮箱、报不出 uuid，
 *           我们同法哈希一次即可比对 —— 能被验证，这条痕迹才有举证价值。
 *           ⚠️ 依赖环境变量 CONSENT_HASH_SALT，未配置时本模块抛错（见 writeConsentAuditTrace）。
 * @author   LingoBridge
 * @created  2026-07-20
 */
import 'server-only'
import { createHash } from 'node:crypto'
import { getSupabaseServer } from '@/lib/supabase-server'
import { env } from '@/lib/env-server'

/** 缺 salt 时抛出的错误消息前缀，供路由与单测识别（不含 salt 值本身） */
export const CONSENT_SALT_MISSING = 'CONSENT_HASH_SALT_MISSING'

/**
 * 把邮箱算成加盐 sha256 十六进制串（审计痕迹里唯一的比对字段）。
 *
 * 规范化口径与 SQL 侧一致：`lower(btrim(email))` —— 大小写/首尾空白不同的同一邮箱必须算出同一哈希，
 * 否则日后申诉者报的邮箱会比不中自己的痕迹。加盐是必须的：邮箱空间小，裸 sha256 可被彩虹表反查回明文。
 * @param  email 明文邮箱（调用方保证非空）
 * @param  salt  服务端哈希盐（调用方保证非空；本函数不做兜底默认值，绝不硬编码任何 salt）
 * @returns      64 位十六进制哈希串
 */
export function hashEmailForAudit(email: string, salt: string): string {
  return createHash('sha256').update(`${email.trim().toLowerCase()}${salt}`).digest('hex')
}

/**
 * 读取该用户的全部同意记录，逐条写入去标识化审计痕迹。
 *
 * ⚠️ 调用方必须在【硬删 consent_records 之前】调用本函数：顺序反了会在写入失败时既没证据也没记录。
 * ⚠️ 本函数【不吞异常】—— 写失败即抛，由删号路由中止整个删号流程（与 deleteUserRawLogs 同款纪律）。
 *
 * 匿名账号（从未注册、无邮箱）直接跳过：无邮箱即无从比对，写一行空壳痕迹既无举证价值也无必要。
 * @param  userId 待注销用户的 id
 * @param  email  该账号的邮箱（须在 admin.deleteUser 之前从 auth 取得；匿名账号传 null）
 * @throws        salt 未配置、查 consent_records 出错、或写 consent_audit 出错时抛出
 * @sideEffect    读 consent_records 一次；有记录时往 consent_audit 批量插入等量行
 */
export async function writeConsentAuditTrace(userId: string, email: string | null): Promise<void> {
  const salt = env.consentHashSalt
  if (!salt) {
    // 故意做响：静默跳过会让「凭据一直没在写」拖到监管来问才暴露，那时已无法补救。
    throw new Error(`${CONSENT_SALT_MISSING}: 未配置 CONSENT_HASH_SALT，无法写入同意审计痕迹`)
  }
  if (!email || !email.trim()) return

  const admin = getSupabaseServer()
  const { data: records, error: readErr } = await admin
    .from('consent_records')
    .select('consent_version, agreed_at')
    .eq('user_id', userId)
  if (readErr) throw readErr

  const rows = (records ?? []) as { consent_version: number | null; agreed_at: string }[]
  if (rows.length === 0) return

  // 撤回时刻 = 删号时刻（删号即撤回同意，0022 决策5）；同一次删号的所有痕迹共用同一时间戳。
  const revokedAt = new Date().toISOString()
  const emailHash = hashEmailForAudit(email, salt)

  const { error: writeErr } = await admin.from('consent_audit').insert(
    rows.map((r) => ({
      email_hash: emailHash,
      consent_version: r.consent_version,
      granted_at: r.agreed_at,
      revoked_at: revokedAt,
    })),
  )
  if (writeErr) throw writeErr
}
