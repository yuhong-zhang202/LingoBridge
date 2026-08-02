/**
 * @module   client-events
 * @desc     客户端埋点上报的【唯一】封装 —— 页面/hook 一律经 track() 上报，不再各写各的 fetch。
 *           走 apiFetch → POST /api/events → 服务端 sanitize 白名单 → logEvent 落 flow_events。
 *           仅供 'use client' 链路引用：禁止 import 'server-only'、禁止引用 supabase-server。
 *
 *   ⚠️⚠️ 绝对不要改用 navigator.sendBeacon ⚠️⚠️
 *   sendBeacon **无法设置任何请求头**，而 /api/events 第一行就是 requireUserAllowAnon(req)、读
 *   Authorization: Bearer。用它 = 100% 收 401、数据全丢；又因 fire-and-forget 吞掉错误，
 *   本地测不出来、只会以为埋成功了。页面离开时的上报一律用 fetch keepalive（opts.keepalive）。
 *
 *   ⚠️ 数据口径警告：recording/page.tsx 的 newFlowId() 位于两个早退分支之后，早退时 sessionStorage
 *   里可能残留上一次流程的 flow_id，并被 apiFetch 自动注入到本次上报。故【分析 P0 事件时必须忽略
 *   flow_id，一律按 user_id 聚合】—— 用 flow_id 串会串错人/串错流程。
 *
 * @author   LingoBridge
 * @created  2026-08-02
 */
import { apiFetch, authHeaders } from '@/lib/api-client'

/** 客户端可上报的事件名（须与 /api/events 的分发表逐一对应，服务端未注册即 400） */
export type ClientEventName =
  | 'flow.story_entry'
  | 'flow.mic_permission'
  | 'flow.capture_started'
  | 'flow.capture_submitted'
  | 'flow.capture_abandoned'
  | 'flow.ai_call'
  | 'match.view_rendered'
  | 'match.question_opened'

/** 事件 props：只允许枚举串 / 数字 / 布尔；undefined 视为「本次没这个字段」直接丢弃。绝不放原文（隐私铁律）。 */
export type ClientEventProps = Record<string, string | number | boolean | undefined>

/**
 * 规范化 props：丢 undefined、数字统一 Math.round、非有限数（NaN/Infinity）直接丢。
 * 取整的理由：服务端 sanitize 用 Number.isInteger 校验，浮点会被静默丢弃 —— 与其到服务端丢，
 * 不如在源头取整，免得「上报了但库里没有」这种查不出来的空洞。
 * @param  props  原始 props
 * @returns       规范化后的 props
 */
function normalize(props: ClientEventProps): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out[k] = Math.round(v)
      continue
    }
    out[k] = v
  }
  return out
}

/**
 * 上报一条客户端埋点事件。fire-and-forget：不返回 Promise、绝不 await、绝不进任何 if 条件、
 * 不影响任何调用方的返回值或跳转 —— 埋点失败必须对用户完全无感（沿用 matching/page.tsx 已验证的范式）。
 *
 * 刻意【不做本地队列、不做重试】：重试会让同一次动作被计多次，distinct 计数与漏斗转化率随即失真；
 * 埋点丢几条只是分母略小，重复计数则是把结论算错 —— 后者坏得多。
 *
 * @param  event  事件名（须在服务端分发表里注册）
 * @param  props  事件字段（枚举串/数字/布尔，无原文）
 * @param  opts   storyId = corpus.id（有则带）；keepalive = 页面离开时上报（pagehide/卸载路径必须传 true）
 * @returns       无
 * @sideEffect    异步 POST /api/events；无 session 时静默不发（全新访客首页尚无 session，
 *                不短路会打出一串 401 噪音）；任何失败一律吞掉
 */
export function track(
  event: ClientEventName,
  props: ClientEventProps,
  opts?: { storyId?: string; keepalive?: boolean },
): void {
  if (typeof window === 'undefined') return
  void (async () => {
    const headers = await authHeaders()
    if (!headers.Authorization) return
    await apiFetch('/api/events', {
      method: 'POST',
      keepalive: opts?.keepalive,
      json: {
        event,
        storyId: opts?.storyId ?? null,
        props: normalize(props),
      },
    })
  })().catch(() => {})
}
