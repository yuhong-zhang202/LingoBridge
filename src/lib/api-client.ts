/**
 * @module   api-client
 * @desc     前端调用受保护 API 的公共工具。集中鉴权头逻辑（原在 8 个文件里逐字复制，违反 §1 模块化）。
 *           仅供 'use client' 组件 / hook 引用 —— 禁止 import 'server-only'，也绝不引用 supabase-server
 *           （service_role 只能在服务端，进前端 bundle 即泄露）。
 * @author   LingoBridge
 * @created  2026-07-12
 */
import { getSupabase } from '@/lib/supabase'

/**
 * 取当前 Supabase session 的 Bearer 鉴权头，供受保护 API 的 fetch 使用。
 * @returns 含 Authorization 头的对象；无 session（未登录/未建匿名会话）时返回空对象
 * @sideEffect 读一次本地 session（getSession 读本地缓存，不发网络请求）
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await getSupabase().auth.getSession()
  const token = session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}
