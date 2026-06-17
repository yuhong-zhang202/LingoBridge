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

export async function POST(req: Request): Promise<NextResponse> {
  // 1) 鉴权：从 Authorization 头取用户 access token，反查 user.id
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) {
    return NextResponse.json({ error: '未授权' }, { status: 401 })
  }
  const admin = getSupabaseServer()
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData.user) {
    return NextResponse.json({ error: '未授权' }, { status: 401 })
  }
  const userId = userData.user.id

  // 2) 删业务数据（service_role 绕 RLS）。
  // 外键顺序：先删 corpus_point_links（按该用户的 corpus.id 反查，本表无 user_id 列），
  //   再删各 user_id 表；最后 admin.deleteUser 触发 auth.users → profiles cascade。
  try {
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

    for (const table of ['corpus', 'phrase_cards', 'feedback'] as const) {
      const { error } = await admin.from(table).delete().eq('user_id', userId)
      if (error) throw error
    }
    const { error: profErr } = await admin.from('profiles').delete().eq('id', userId)
    if (profErr) throw profErr

    // 3) 删账号本体
    const { error: delErr } = await admin.auth.admin.deleteUser(userId)
    if (delErr) throw delErr

    return NextResponse.json({ ok: true })
  } catch (e) {
    logErr('[account/delete]', e)
    return NextResponse.json({ error: '删除失败，请稍后再试' }, { status: 500 })
  }
}
