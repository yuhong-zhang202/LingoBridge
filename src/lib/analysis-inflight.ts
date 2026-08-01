/**
 * @module   analysis-inflight
 * @desc     【客户端】analysis 在飞请求注册表 —— 让「点击即发」与「预取」跨路由（匹配页 ↔ 分析页）
 *           共享/复用同一个在飞的 /api/analysis 请求，避免双发双计。按 (questionId, storyId) 键。
 *
 *           生命周期（关键，见任务约束）：
 *             · 只登记【在飞(pending)】请求；promise settle（成功或失败）即从表中移除 —— 成功也移除：
 *               服务端已把结果写进 (题,语料) 缓存，用户点进去走缓存命中即可，无需长留（故「采纳」只对
 *               仍在飞的请求生效）。
 *             · takeAnalysis 取走 = 移交所有权给分析页（撤销兜底定时器，abort 归其掌管）。
 *             · abortAll：新匹配结果渲染 / 离开匹配页时清空，防拿到指向【旧语料】的过期 promise。
 *             · 每条兜底 SAFETY_TTL_MS 未 settle 即强制 abort+移除，防长会话/网络挂起下无限累积。
 *
 *           ⚠️ abort 语义：仅切断【客户端等待】。/api/analysis 不监听 req.signal、且缓存 upsert 在返回
 *             之前 —— 服务端会跑完、照计费、把结果写进缓存。故 abort 不减计数、不减成本；扔掉的只是
 *             客户端的等待，付过费的结果留作下次秒开。绝不为省钱加 req.signal 提前中止。
 * @author   LingoBridge
 * @created  2026-08-01
 */
'use client'
import { apiFetch } from '@/lib/api-client'

/** 兜底清理：单条在飞请求超过此时长仍未 settle 即强制 abort+移除（防挂起累积）。 */
const SAFETY_TTL_MS = 90_000

/** 供调用方消费的在飞条目句柄。 */
export interface InflightEntry {
  readonly key: string
  readonly promise: Promise<Response>
  /** 中止客户端等待（不影响服务端跑完/计费/写缓存，见模块头）。 */
  readonly abort: () => void
}

interface Rec { promise: Promise<Response>; controller: AbortController; timer: ReturnType<typeof setTimeout> }
const registry = new Map<string, Rec>()

export function inflightKey(questionId: string, storyId: string): string {
  return `${questionId}::${storyId}`
}

function remove(key: string, abort: boolean): void {
  const r = registry.get(key)
  if (!r) return
  clearTimeout(r.timer)
  if (abort) r.controller.abort()
  registry.delete(key)
}

/**
 * 发起（或复用）一次 analysis 请求。已在飞则返回既有条目（去重：点了正在预取的题不重发、不双计）。
 * @param questionId  题 id
 * @param storyId     语料 id
 * @param prefetch    true=后台预取（服务端走预取闸 + 标 metadata.prefetch:true）；false=真实用户请求
 * @returns           在飞条目句柄
 */
export function requestAnalysis(questionId: string, storyId: string, prefetch: boolean): InflightEntry {
  const key = inflightKey(questionId, storyId)
  const existing = registry.get(key)
  if (existing) return { key, promise: existing.promise, abort: () => remove(key, true) }
  const controller = new AbortController()
  const promise = apiFetch('/api/analysis', {
    method: 'POST',
    json: { questionId, storyId, prefetch },
    signal: controller.signal,
  })
  const timer = setTimeout(() => remove(key, true), SAFETY_TTL_MS)
  registry.set(key, { promise, controller, timer })
  // settle（成功/失败）即移除（abort=false：自然结束无需再切）。服务端不受影响、缓存已写。
  void promise.then(() => remove(key, false), () => remove(key, false))
  return { key, promise, abort: () => remove(key, true) }
}

/**
 * 分析页挂载时取走该题的在飞请求（点击即发/预取采纳）；取走即脱离注册表，abort 归调用方掌管。
 * @returns 在飞条目；无（未在飞/已 settle）则 null，分析页据此回退到新发一次。
 */
export function takeAnalysis(questionId: string, storyId: string): InflightEntry | null {
  const key = inflightKey(questionId, storyId)
  const r = registry.get(key)
  if (!r) return null
  clearTimeout(r.timer)     // 取走后由分析页掌管其生命周期，撤销兜底清理
  registry.delete(key)
  return { key, promise: r.promise, abort: () => r.controller.abort() }
}

/**
 * 中止并清空全部在飞请求。except 保留（点某题时保它、abort 其余预取；换季/离开匹配页时不传 except 全清）。
 * @param exceptKey  要保留的键（通常是刚点击的题，供分析页采纳）
 */
export function abortAll(exceptKey?: string): void {
  for (const key of [...registry.keys()]) {
    if (key === exceptKey) continue
    remove(key, true)
  }
}
