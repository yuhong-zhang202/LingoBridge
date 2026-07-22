/**
 * @module   jwt-verify
 * @desc     【仅服务端】本地验签 Supabase access token —— 替代 auth.getUser(token) 的网络验证。
 *           省掉每个登录后接口一次「香港→新加坡」的 GoTrue 往返（getUser 每调必发一次网络请求）。
 *
 *           本项目 Supabase 用非对称 ES256 签发 access token（2025-10 后新项目默认），公钥在 JWKS 端点。
 *           `createRemoteJWKSet` 首用拉一次 JWKS、进程内缓存、遇未知 kid（密钥轮换）自动刷新，
 *           故稳态零网络往返、无需任何密钥入 env。
 *
 *           【安全边界】本地验签只证 token「签名有效 + 未过期 + issuer/aud 相符」，
 *           【不查服务端吊销/封号】。这对内测可接受：access token 默认 1 小时过期（封号最多 1 小时后失效），
 *           且封人主闸在 DB 触发器白名单（enforce_beta_allowlist_trg）+ 应用层白名单兜底，未依赖 getUser。
 *           上线放量若需即时吊销，再在此叠加一层。
 * @author   LingoBridge
 * @created  2026-07-23
 */
import 'server-only'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { env } from './env-server'

/** GoTrue 的 issuer 与 JWKS 地址均基于 <supabaseUrl>/auth/v1（已用真 token 核对：iss=此值、aud=authenticated、alg=ES256） */
const AUTH_BASE = `${env.supabaseUrl}/auth/v1`
const JWKS = createRemoteJWKSet(new URL(`${AUTH_BASE}/.well-known/jwks.json`))

/** Supabase access token 载荷中本鉴权用到的字段（其余字段忽略） */
export interface SupabaseJwtPayload extends JWTPayload {
  sub: string
  email?: string | null
  is_anonymous?: boolean
  role?: string
}

/**
 * 本地验签 Supabase access token（不联网调 getUser）。校验：ES256 签名 + 过期(jwtVerify 默认) + issuer + audience。
 * @param  token  Authorization: Bearer 里的 access token
 * @returns       验签通过的载荷（含 sub / email / is_anonymous）
 * @throws        验签失败 / 过期 / iss|aud 不符 / 缺 sub 时抛错（调用方转 401）
 */
export async function verifyAccessToken(token: string): Promise<SupabaseJwtPayload> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: AUTH_BASE,
    audience: 'authenticated',
  })
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    throw new Error('access token 缺 sub')
  }
  return payload as SupabaseJwtPayload
}
