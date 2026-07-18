/**
 * @module   consent-server
 * @desc     【仅服务端】「真捕获同意」的服务端校验 —— 供第三方 AI 入口路由在把用户数据发出前，
 *           用 service_role 查 consent_records 确认调用者已对【当前披露版本】签过同意。
 *           客户端的同意闸（FirstUseConsent）只挂首页、可被深链绕过，故录音/文字直发第三方 AI 的
 *           首个入口（/api/transcribe、/api/restructure）必须在服务端再校验一次，杜绝未同意即外发。
 *           读逻辑与客户端 src/lib/consent.ts 的 hasRecordedConsent 同口径（同版本、SELECT-own 等价），
 *           但走 service_role（不依赖用户 session），且供 route 直接用 userId 校验。
 * @author   LingoBridge
 * @created  2026-07-18
 */
import 'server-only'
import { getSupabaseServer } from '@/lib/supabase-server'
import { BETA_PRIVACY_VERSION } from '@/lib/privacy-copy'

/**
 * 校验某用户是否已对【当前披露版本】签过同意（服务端权威判断，走 service_role 绕 RLS）。
 * @param userId  经 requireUser* 反查出的当前调用者 id
 * @returns       true=已签当前版本同意（可放行 AI 调用）；false=无当前版本同意记录（须拒绝）
 * @throws        查库出错时抛出原始错误 —— 交由路由落入 500 分支（宁可报「稍后再试」，
 *                也不在查不到时误判为「未同意」而回一句误导性的「请先去首页同意」）
 * @sideEffect    查一次 consent_records（user_id + consent_version=当前版本）
 */
export async function hasRecordedConsent(userId: string): Promise<boolean> {
  const { data, error } = await getSupabaseServer()
    .from('consent_records')
    .select('id')
    .eq('user_id', userId)
    .eq('consent_version', BETA_PRIVACY_VERSION)
    .limit(1)
  if (error) throw error
  return (data?.length ?? 0) > 0
}
