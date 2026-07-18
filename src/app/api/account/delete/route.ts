/**
 * @module   api/account/delete
 * @desc     【仅服务端】GDPR 被遗忘权 — 用 Authorization 头里的用户 access token 反查 user.id，
 *           再用 service_role 删该用户的所有业务数据并 admin.deleteUser；客户端不得直接传 user_id。
 * @author   LingoBridge
 * @created  2026-06-17
 */
import 'server-only'
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getSupabaseServer } from '@/lib/supabase-server'
import { requireUser, authErrorResponse } from '@/lib/api-auth'
import { deleteUserRawLogs } from '@/lib/raw-log'

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // 1) 鉴权：复用 requireUser 从 Authorization 头反查 user.id（缺/无效 token 抛 ApiAuthError(401)）
    const { userId } = await requireUser(req)
    const admin = getSupabaseServer()

    // 2) 删业务数据（service_role 绕 RLS）。
    // 外键顺序：先删 corpus_point_links（按该用户的 corpus.id 反查，本表无 user_id 列），
    //   再删各 user_id 表；最后 admin.deleteUser 触发 auth.users → profiles cascade。
    const { data: corpusRows, error: cListErr } = await admin
      .from('corpus')
      .select('id')
      .eq('user_id', userId)
    if (cListErr) throw cListErr
    const corpusIds = (corpusRows ?? []).map((r) => (r as { id: string }).id)
    if (corpusIds.length > 0) {
      const { error } = await admin.from('corpus_point_links').delete().in('corpus_id', corpusIds)
      if (error) throw error
    }

    // practice_sessions 显式删（防御性）：schema drift 期间线上真实 FK 是否 on delete cascade 不确定，显式删一行最稳（与 corpus/phrase_cards/feedback 同理）。
    // corpus_match_snapshots（0019）对 corpus 有 on delete cascade，但按本端点「不信 FK cascade、显式删每张表」纪律，须排在 corpus 之前先删；
    // flow_events（0018）埋点，无原文但 GDPR 完整性须删，无跨表依赖、位置随意。
    // consent_records（0022）同意记录：删号=撤回同意（决策5），本表硬删（决策4）；user_id 无外键、无跨表依赖，位置随意。
    for (const table of ['corpus_match_snapshots', 'flow_events', 'consent_records', 'corpus', 'phrase_cards', 'feedback', 'practice_sessions'] as const) {
      const { error } = await admin.from(table).delete().eq('user_id', userId)
      if (error) throw error
    }
    const { error: profErr } = await admin.from('profiles').delete().eq('id', userId)
    if (profErr) throw profErr

    // 头像 storage 清理（best-effort）：avatars 桶公开读，删号后残留文件凭旧 URL 仍可被任何人访问，属被遗忘权缺口。
    // 单独 try/catch、只 logErr 不中断——账号与数据库数据的删除是核心，头像清理是补充，不能因它失败导致删不掉号。
    try {
      const { data: avatarObjs, error: listErr } = await admin.storage.from('avatars').list(userId)
      if (listErr) throw listErr
      // 头像按 {user_id}/xxx.ext 存放（见 migration 0008），拼完整路径后整批删除
      const paths = (avatarObjs ?? []).map((o) => `${userId}/${o.name}`)
      if (paths.length > 0) {
        const { error: rmErr } = await admin.storage.from('avatars').remove(paths)
        if (rmErr) throw rmErr
      }
    } catch (e) {
      logErr('[account/delete] 头像清理失败（不中断删号）', e)
    }

    // 原始留证彻底清理（best-effort）：llm_raw_logs / asr_raw_logs 含用户原文（prompt / 转写），
    // 被遗忘权须一并删。故意【不带 retained 过滤】= 连金标保留批也删（产品方 2026-07-17 拍定）。
    // 单独 try/catch、只 logErr 不中断——留证清理是补充，不能因它失败导致删不掉号（仿头像清理）。
    try {
      await deleteUserRawLogs(userId)
    } catch (e) {
      logErr('[account/delete] 原始留证清理失败（不中断删号）', e)
    }

    // 费用日志去标识化（best-effort，非硬删）：api_usage_logs（0021 起带 user_id/corpus_id）是聚合用量/成本、
    // 不含用户原文——被遗忘权靠断掉个人链接即满足，而非删行。硬删会让离职用户的成本从总额蒸发、账目失真。
    // 故只把 user_id / corpus_id 置 null，保留 is_anonymous / cost / 其余字段供成本统计。
    // 这与上面 raw_logs 的「彻底删」口径不同是有意的：原文该彻底删，聚合成本该去标识化保留。
    // 单独 try/catch、只 logErr 不中断——同头像/留证清理的补充性纪律。
    try {
      const { error: anonErr } = await admin
        .from('api_usage_logs')
        .update({ user_id: null, corpus_id: null })
        .eq('user_id', userId)
      if (anonErr) throw anonErr
    } catch (e) {
      logErr('[account/delete] 费用日志去标识化失败（不中断删号）', e)
    }

    // 3) 删账号本体
    const { error: delErr } = await admin.auth.admin.deleteUser(userId)
    if (delErr) throw delErr

    return NextResponse.json({ ok: true })
  } catch (e) {
    // 鉴权错误（requireUser 抛的 401）映射为标准响应；非鉴权错误保留原有 500 分支
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[account/delete]', e)
    return NextResponse.json({ error: '删除失败，请稍后再试' }, { status: 500 })
  }
}
