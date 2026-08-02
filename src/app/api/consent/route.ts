/**
 * @module   api/consent
 * @desc     【仅服务端】「真捕获同意」落库唯一入口 —— 首次使用同意闸点击「同意并开始」时调本端点，
 *           由 service_role 往 consent_records 插一条不可变同意记录。客户端持 anon key 无法直连
 *           （RLS 只给 SELECT-own、无 insert 策略），写入必须经此端点，防伪造/篡改同意记录。
 *           放行匿名与注册用户（决策2 允许匿名同意，uid 注册后不变、同意延续），只挡无效 token。
 *           数据最小化：不记 ip / user_agent（决策3）。consent_version / scope_snapshot / consent_type
 *           全由服务端从 privacy-copy 构造，不接受客户端传入（防注入伪造）。
 * @author   LingoBridge
 * @created  2026-07-18
 */
import 'server-only'
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getSupabaseServer } from '@/lib/supabase-server'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { BETA_PRIVACY_VERSION, CONSENT_SCOPE_SNAPSHOT } from '@/lib/privacy-copy'
import { logEvent } from '@/lib/events'
import { isQaRequest } from '@/lib/qa-traffic'

export async function POST(req: Request): Promise<NextResponse> {
  // 性能取证：把「验 token」与「插库」两段耗时经 Server-Timing 头暴露到浏览器 DevTools。
  // 用于定位同意慢在哪一段（getUser vs 插库/冷连接）；轻量、可长期保留作性能观测。
  const t0 = performance.now()
  try {
    // 鉴权：放行匿名与注册用户，拿 uid + isAnonymous（缺/无效 token 抛 ApiAuthError(401)）
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    const t1 = performance.now()

    // 本轮只落「内测总体同意」（beta_general）。benchmark 型二次同意仅靠表列预留，本端点不处理。
    // consent_version / scope_snapshot 均取服务端权威值，客户端 body 一律忽略（防伪造）。
    const { error } = await getSupabaseServer().from('consent_records').insert({
      user_id: userId,
      consent_version: BETA_PRIVACY_VERSION,
      consent_type: 'beta_general',
      scope_snapshot: CONSENT_SCOPE_SNAPSHOT,
      is_anonymous: isAnonymous,
    })
    if (error) throw error
    const t2 = performance.now()

    // 漏斗 D0：同意即成为漏斗第一级，与 D1–D5 同走 flow_events，同源同口径（一张表一把尺）。
    // 刻意【不给 consent_records 加 is_qa 列】：那是合规证据表，多一个客户端可控列就多一份举证成本，
    // 且会经 own_consent_records_select 回显给用户本人。QA 标记只落 flow_events 这张统计表。
    // 补这条事件还顺带补上一类此前完全看不见的用户：「点了同意就退出」的人，在 flow_events 里
    // 必然有且仅有这一条记录。logEvent 内部已吞异常，不阻断同意返回。
    await logEvent({
      event: 'flow.consent_granted',
      flowId: req.headers.get('x-flow-id'),
      userId,
      isQa: isQaRequest(req, userId),
    })

    const authMs = Math.round(t1 - t0)
    const insertMs = Math.round(t2 - t1)
    // 性能埋点（fire-and-forget，绝不 await/不阻塞同意响应）：把验签/插库耗时落 perf_samples，
    // 供事后直接 SQL 查「冷 vs 热」分布，免手动 DevTools 截图。写失败仅告警、不影响同意。
    void getSupabaseServer()
      .from('perf_samples')
      .insert([
        { label: 'consent', phase: 'auth', ms: authMs, meta: { is_anonymous: isAnonymous } },
        { label: 'consent', phase: 'insert', ms: insertMs, meta: { is_anonymous: isAnonymous } },
      ])
      .then(({ error: perfErr }) => { if (perfErr) logErr('[perf] consent 埋点写入失败', perfErr) })

    return NextResponse.json(
      { ok: true },
      { headers: { 'Server-Timing': `auth;dur=${authMs}, insert;dur=${insertMs}` } },
    )
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[consent API]', e)
    return NextResponse.json({ error: '同意记录保存失败，请重试' }, { status: 500 })
  }
}
