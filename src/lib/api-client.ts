/**
 * @module   api-client
 * @desc     前端调用受保护 API 的公共工具。集中鉴权头逻辑（原在 8 个文件里逐字复制，违反 §1 模块化）。
 *           仅供 'use client' 组件 / hook 引用 —— 禁止 import 'server-only'，也绝不引用 supabase-server
 *           （service_role 只能在服务端，进前端 bundle 即泄露）。
 * @author   LingoBridge
 * @created  2026-07-12
 */
import { getSupabase } from '@/lib/supabase'
import { currentFlowId } from '@/lib/flow-id'

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

/** apiFetch 的 init：在 RequestInit 基础上把 body 收敛为两种明确形态，headers 收窄为普通对象。 */
export interface ApiFetchInit extends Omit<RequestInit, 'body' | 'headers'> {
  /** JSON 请求体：自动 JSON.stringify 并设 Content-Type: application/json。与 body 互斥。 */
  json?: unknown
  /** 原始 body（FormData / Blob / string 等）。用于 multipart 等场景——不会被设 Content-Type。 */
  body?: BodyInit
  /** 追加/覆盖请求头（会与自动注入的 Authorization / Content-Type 合并）。 */
  headers?: Record<string, string>
}

/**
 * 受保护 API 的 fetch 封装：自动带上当前 session 的 Bearer 鉴权头，并规范请求体序列化。
 * - 传 json：JSON.stringify 之，并设 Content-Type: application/json；
 * - 传 body（如 FormData）：不设 Content-Type，交浏览器自动带 multipart boundary（切勿手动设，否则丢 boundary）。
 * 只负责鉴权与请求体，返回原始 Response——响应状态（含 402 QUOTA_EXCEEDED、ok 判定、错误文案）由调用方处理，
 * 因各接口的 402/错误呈现差异大（弹配额层 / toast / 放行兜底），不在此集中。
 * @param  input  请求 URL
 * @param  init   ApiFetchInit（method / json 或 body / signal / headers 等）
 * @returns       原始 Response
 * @sideEffect    读一次本地 session 取鉴权头（不发网络请求）
 */
/**
 * 服务端配额 402 的 reason 值 —— 与 QuotaReached 的 variant 1:1 对应（reason 即 variant）：
 *   trial=匿名试用用尽（引导注册）· story=注册故事月额度用完 · ielts=注册复练月额度用完。
 */
export type QuotaReason = 'trial' | 'story' | 'ielts'

/**
 * 从 402 响应体读出配额 reason，供前端确定性选 QuotaReached 变体（取代异步 isAnon 竞态推导）。
 * 用 clone() 读，不消费原 Response（调用方仍可再读）；解析失败/字段缺失/非法值一律返回 null，
 * 调用方自行兜底默认 'trial'（匿名 only 的 402——如 /api/restructure、/api/transcribe——不带 reason，走此默认，语义正确）。
 * @param res  某次 apiFetch 拿到的 Response（通常已判定 status===402）
 * @returns    合法 reason 或 null
 */
export async function readQuotaReason(res: Response): Promise<QuotaReason | null> {
  try {
    const body = (await res.clone().json()) as { reason?: unknown }
    const r = body?.reason
    return r === 'trial' || r === 'story' || r === 'ielts' ? r : null
  } catch {
    return null
  }
}

export async function apiFetch(input: string, init: ApiFetchInit = {}): Promise<Response> {
  const { json, body, headers, ...rest } = init
  // 全链路 flow_id 走 X-Flow-Id 头透传（非 URL / 非 body）：一处注入，transcribe / restructure /
  // corpus / matching / events 全覆盖；无 flow_id（如浏览页请求）时不带，服务端读到 null 即可。
  const flowId = currentFlowId()
  const merged: Record<string, string> = {
    ...(await authHeaders()),
    ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(flowId ? { 'X-Flow-Id': flowId } : {}),
    ...headers,
  }
  return fetch(input, {
    ...rest,
    headers: merged,
    body: json !== undefined ? JSON.stringify(json) : body,
  })
}
