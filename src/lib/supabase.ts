/**
 * @module   supabase
 * @desc     Supabase 客户端单例 + 开发阶段匿名登录，保证 RLS auth.uid() 有值
 * @author   LingoBridge
 * @created  2026-06-02
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey)
  }
  return client
}

// 开发阶段：没有 session 就匿名登录，保证 RLS 的 auth.uid() 有值
export async function ensureSession(): Promise<string> {
  const supabase = getSupabase()
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user) return session.user.id

  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw new Error(`匿名登录失败：${error.message}`)
  if (!data.user) throw new Error('匿名登录未返回用户')
  return data.user.id
}
