/**
 * @module   consent
 * @desc     首次使用「真捕获同意」闸的核心逻辑（读路径查库判是否已签 / 写路径落库）。
 *           从 FirstUseConsent 组件抽出为纯函数，便于在 node 环境下单测（组件本身依赖 DOM 不可测）。
 *           读路径：先看 localStorage 缓存（省一次查询/防闪弹），未命中则查 consent_records 库
 *           （RLS SELECT-own，靠当前 session 的 auth.uid()）；无当前版本记录 → 需弹窗。
 *           写路径：确保有 session（无则匿名登录，决策2 允许匿名同意）→ 调 /api/consent 落库 → 成功才放行。
 *           localStorage 仅作缓存，不再是同意的凭据（凭据在库里）。
 * @author   LingoBridge
 * @created  2026-07-18
 */
import { getSupabase, ensureSession } from '@/lib/supabase'
import { apiFetch } from '@/lib/api-client'
import { BETA_PRIVACY_VERSION } from '@/lib/privacy-copy'

/**
 * 同意缓存的 localStorage key —— 从版本常量派生（别再手维两套版本）。
 * 前缀改用 'lb-consent-'（区别于旧的 'lb-ai-consent-'）：旧 key 只写过 localStorage、无库记录，
 * 换前缀让旧用户此版视为「未签」→ 重新弹窗并真正落库（人读披露亦属实质新增，本就该重签）。
 */
export const CONSENT_CACHE_KEY = `lb-consent-v${BETA_PRIVACY_VERSION}`

/** 读同意缓存：命中（'1'）表示本版本已同意；无痕/SSR/异常一律当未命中（宁可多问一次）。 */
export function readConsentCache(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(CONSENT_CACHE_KEY) === '1'
  } catch {
    return false
  }
}

/** 写同意缓存：仅作下次免查缓存；无痕/配额耗尽时静默（下次再查库即可）。 */
export function writeConsentCache(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CONSENT_CACHE_KEY, '1')
  } catch {
    /* 静默：缓存写不进不影响正确性，库里已有记录 */
  }
}

/**
 * 判断当前用户是否已对「本版本披露」签过同意。
 * @returns true=已签（无需弹窗）；false=未签（需弹同意闸）
 * @sideEffect 读 localStorage 缓存；未命中则读一次 session 并查 consent_records（走 RLS SELECT-own）；查到则回写缓存
 */
export async function hasRecordedConsent(): Promise<boolean> {
  // 先看缓存：命中即免查（也避免每次进首页闪一下弹窗）
  if (readConsentCache()) return true

  // 未命中：查库。需已有 session（全新访客尚无 session → 天然未签 → 弹窗）。
  const supabase = getSupabase()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return false

  const { data, error } = await supabase
    .from('consent_records')
    .select('id')
    .eq('user_id', session.user.id)
    .eq('consent_version', BETA_PRIVACY_VERSION)
    .limit(1)
  // 查库失败：保守起见当作未签（宁可多弹一次，不冒「漏捕获同意」的风险）
  if (error || !data || data.length === 0) return false

  writeConsentCache()
  return true
}

/**
 * 记录一次同意（点击「同意并开始」= 明示同意的 affirmative action）。
 * @returns true=落库成功（可放行关弹窗）；false=失败（留弹窗 + 重试，绝不只写缓存就放行）
 * @sideEffect 确保有 session（无则匿名登录）→ POST /api/consent 由服务端 service_role 落一条记录 → 成功才回写缓存
 */
export async function recordConsent(): Promise<boolean> {
  // 确保有 session：匿名同意允许（决策2），且 uid 注册后不变、同意延续。无 session 会导致 /api/consent 401。
  await ensureSession()
  // consent_version / scope_snapshot / consent_type 全由服务端从 privacy-copy 构造（防客户端伪造），本请求无需 body。
  const res = await apiFetch('/api/consent', { method: 'POST' })
  if (!res.ok) return false
  writeConsentCache()
  return true
}
