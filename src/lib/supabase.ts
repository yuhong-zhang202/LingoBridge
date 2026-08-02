/**
 * @module   supabase
 * @desc     Supabase 客户端单例 + 匿名登录（单飞防重入），保证 RLS auth.uid() 有值
 *
 *           【为什么 ensureSession 必须单飞】
 *           原实现是「await getSession() → 没有就 signInAnonymously()」，两步之间有一个异步窗口，
 *           且没有任何防重入。首屏有多个模块并发调用（全站 48 处调用点，集中在 lib/db/*），
 *           它们同时落进这个窗口、都看到「无 session」，于是各自建号——一个人被建成好几个匿名账号。
 *
 *           生产实测（2026-08-02，已排除自测污染）：266 个匿名账号只对应 191 个不同的创建分钟，
 *           虚增约 1.39 倍；同一分钟内成簇的 3~7 个账号，created_at 首尾仅相差 0.00~0.05 秒——
 *           正是同一次首屏并发的指纹。当天仍在发生。
 *           后果：所有按 distinct user_id 计的指标（尤其新上线的漏斗）每一级都虚高、转化率算错。
 *
 *           单飞两个必守点：成功后清缓存（后续调用要走 getSession 快速路径，不能永远返回旧 Promise）；
 *           失败也必须清（否则一次网络抖动会让 ensureSession 永久失败——单飞最常见的坑）。
 *
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

/** 正在进行中的会话解析 Promise；并发调用共享它，settle 后立即清空 */
let inflightSession: Promise<string> | null = null

/**
 * 真正干活的一次会话解析：有 session 用之，没有才匿名建号。
 * 仅供 ensureSession 在持有单飞槽位时调用，不直接对外暴露。
 * @returns  当前用户 id
 */
async function resolveSession(): Promise<string> {
  const supabase = getSupabase()
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user) return session.user.id

  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw new Error(`匿名登录失败：${error.message}`)
  if (!data.user) throw new Error('匿名登录未返回用户')
  return data.user.id
}

/**
 * 保证存在可用 session：没有就匿名登录。并发调用共享同一次解析（单飞），不会重复建号。
 * @returns           当前用户 id
 * @sideEffect        无 session 时会调用 signInAnonymously 创建匿名账号并写入本地存储
 */
export async function ensureSession(): Promise<string> {
  // 已有在飞的解析：直接复用，绝不再发一次 signInAnonymously
  if (inflightSession) return inflightSession

  const pending = resolveSession()
  inflightSession = pending
  try {
    return await pending
  } finally {
    // 成功/失败都要清：成功后让后续调用走 getSession 快速路径，失败后允许重试（否则一次抖动永久失败）。
    // 身份判断防的是「本次的槽位已被后来者覆盖」的极端交错，只清自己那次。
    if (inflightSession === pending) inflightSession = null
  }
}
