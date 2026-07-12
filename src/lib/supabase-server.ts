/**
 * @module   supabase-server
 * @desc     【仅服务端】Supabase 管理员 client — 使用 service_role key，完全绕过 RLS。
 *           含管理员级密钥，禁止被任何 'use client' 文件或前端 import 链路引用。
 * @author   LingoBridge
 * @created  2026-06-06
 */
import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env-server'

// 直接读取 service_role key，不经过 env.ts（env.ts 被客户端链路 import，字符串会泄漏进 bundle）
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

let serverClient: SupabaseClient | null = null

/**
 * 返回使用 service_role key 的 Supabase 单例 client。
 * 不需要用户 session — service_role 完全绕过 RLS。
 * @returns SupabaseClient（管理员权限）
 */
export function getSupabaseServer(): SupabaseClient {
  if (!serverClient) {
    serverClient = createClient(env.supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }
  return serverClient
}
