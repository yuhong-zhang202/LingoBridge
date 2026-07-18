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
import { NextResponse } from 'next/server'
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

/**
 * 同意闸「共用前置」——所有把用户数据（原文/录音/故事）发往第三方 AI 的下游出口路由，
 * 在 AI 调用前调用本工具做硬校验：未签当前版本同意 → 返回标准 403 供路由直接 return，
 * 绝不把数据外发。抽出此工具令 6+ 处出口复用同一句校验与同一 403 形状（code=CONSENT_REQUIRED），
 * 不必各写一遍、也杜绝措辞漂移。
 * @param userId  requireUser* 反查出的当前调用者 id
 * @returns       已签 → null（放行，路由继续）；未签 → NextResponse(403, {code:'CONSENT_REQUIRED'})
 * @throws        查库出错时向上抛（由路由落入 500 分支）——不静默当作「未同意」，避免误导性提示
 * @sideEffect    透过 hasRecordedConsent 查一次 consent_records
 */
export async function requireConsent(userId: string): Promise<NextResponse | null> {
  if (await hasRecordedConsent(userId)) return null
  return NextResponse.json(
    { error: '请先在首页阅读并同意隐私说明', code: 'CONSENT_REQUIRED' },
    { status: 403 },
  )
}
