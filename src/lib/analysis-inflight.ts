/**
 * @module   analysis-inflight
 * @desc     【客户端】analysis 在飞请求注册表 —— 让「点击即发」与「预取」跨路由（匹配页 ↔ 分析页）
 *           共享/复用同一个在飞的 /api/analysis 请求，避免双发双计。按 (questionId, storyId) 键。
 *
 *           统一流式模型（2026-08-01 阶段二）：
 *             · prefetch=false（点击即发 / 分析页自取）→ 发【流式】请求（/api/analysis，走 handleStreaming）。
 *               注册表【居中读 SSE、把流抽干】，把已到的 meta / section / final 累进 entry 的 snapshot；
 *               订阅者（分析页）通过 subscribe 拿到「立即回放当前态 + 后续增量」——晚挂载 200ms 的分析页
 *               据此也能拿到已到的全部段（本改造命根）。条目【存活到流结束】（done / error），非 headers 到达。
 *             · prefetch=true（后台预取）→ 发 ?stream=0【缓冲】请求（body.prefetch:true → 服务端 handleBuffered，
 *               走预取闸 + metadata.prefetch:true 成本归因），纯暖缓存：无逐段，只在缓冲响应到达时把整份 final
 *               填进 snapshot。匹配页预取【不订阅】（只读 .promise 判 !res.ok 中断串行）。
 *
 *           两种 entry 共用同一 snapshot + subscribe 接口（差别仅「逐段填」还是「一次性填 final」）：
 *             这样「点击时该题正被预取（缓冲在飞）」的碰撞场景下，点击即发复用同一条缓冲请求（不双发不双计），
 *             分析页 subscribe 到 final（缓冲完成即定稿，无逐段但结果正确，仍省一次 AI 调用）。
 *
 *           生命周期：
 *             · 条目登记到【流结束/缓冲 settle】即从表移除（服务端已把结果写进 (题,语料) 缓存，下次点进走命中）。
 *               移除只是「未来 requestAnalysis 不再复用」；已持有引用的订阅者仍会收到最终 snapshot。
 *             · abortAll：新匹配结果渲染 / 离开匹配页时清空（except 保留刚点击的题），防拿到指向【旧语料】的过期条目。
 *             · 每条兜底 SAFETY_TTL_MS 未结束即强制 abort+移除，防长会话/网络挂起下无限累积。
 *
 *           ⚠️ abort 语义：仅切断【客户端等待/读流】。/api/analysis 不监听 req.signal、且缓存 upsert 在流末
 *             （返回之前）—— 服务端会跑完、照计费、把结果写进缓存。故 abort 不减计数、不减成本；扔掉的只是
 *             客户端的等待，付过费的结果留作下次秒开。用户中途离开可能落在缓存写之前（极窄窗口）→ 下次重算，
 *             这是可接受的边缘语义。绝不为省钱加 req.signal 提前中止。
 * @author   LingoBridge
 * @created  2026-08-01
 */
'use client'
import { apiFetch } from '@/lib/api-client'
import type { AnalysisResponse } from '@/lib/types'
import type { AnalysisStreamSection } from '@/lib/analysis-stream-parse'

/** 兜底清理：单条在飞请求超过此时长仍未结束即强制 abort+移除（防挂起累积）。 */
const SAFETY_TTL_MS = 90_000

/**
 * 订阅者看到的增量快照（同一对象引用被就地更新，订阅回调每次读当前字段值即可）：
 *  · meta   —— meta 帧的题目展示信息（id/part/en/zh/dimension/isNew），AI 前即到，用于渲题头；
 *  · sections —— 逐段累积（structureLabel / focusPoint / phraseGroup 自然序）；缓冲路恒空；
 *  · final  —— 权威定稿（完整 AnalysisResponse），done 帧 / 缓冲响应到达时填；
 *  · error  —— 流断 / 无 done / error 帧 / 缓冲失败（供订阅者据此降级 ?stream=0）；
 *  · done   —— 终态标志（final 或 error 均置 true）。
 */
export interface AnalysisSnapshot {
  meta: AnalysisResponse['question'] | null
  sections: AnalysisStreamSection[]
  final: AnalysisResponse | null
  error: boolean
  done: boolean
}

/** 供调用方消费的在飞条目句柄。 */
export interface InflightEntry {
  readonly key: string
  /**
   * 底层请求的初始 Response promise。
   *  · 预取(缓冲)：匹配页据此判 `!res.ok` 中断串行预取；
   *  · 流式：暴露开流 Response（其 body 已被注册表【居中抽干】，勿再读；仅供读 status/ok）；
   *  · 终态状态码（402/403/429）与开流前 5xx 均从此取。
   */
  readonly promise: Promise<Response>
  /**
   * 订阅增量快照：立即以【当前 buffered 态】回放一次（含已到的 meta + sections + 若已 final/error），
   * 之后每次更新再回放一次；返回 unsubscribe。
   */
  subscribe: (onUpdate: (snap: AnalysisSnapshot) => void) => () => void
  /** 中止客户端等待/读流（不影响服务端跑完/计费/写缓存，见模块头）。 */
  readonly abort: () => void
}

interface Rec {
  key: string
  promise: Promise<Response>
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  snap: AnalysisSnapshot
  subscribers: Set<(snap: AnalysisSnapshot) => void>
  handle: InflightEntry
}
const registry = new Map<string, Rec>()

export function inflightKey(questionId: string, storyId: string): string {
  return `${questionId}::${storyId}`
}

/** 从表移除一条（可选顺带 abort 客户端等待）。移除后已持有 handle 的订阅者仍能收到最终 snapshot。 */
function remove(key: string, abort: boolean): void {
  const r = registry.get(key)
  if (!r) return
  clearTimeout(r.timer)
  if (abort) r.controller.abort()
  registry.delete(key)
}

/** 把当前 snapshot 回放给全部订阅者（订阅者读到的是同一对象、当前字段值）。 */
function notify(rec: Rec): void {
  for (const fn of [...rec.subscribers]) fn(rec.snap)
}

/** 一帧 SSE 里取 event/data 两行（与 handleStreaming 的 sseFrame 编码对称）。 */
function parseSseBlock(block: string): { event: string; data: string } {
  let event = ''
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data = line.slice(5).trim()
  }
  return { event, data }
}

/**
 * 居中抽干一条【流式】entry 的 SSE，把 meta / section / done / error 累进 snapshot 并回放订阅者。
 * 终态/非流 JSON（402/403/429/5xx，非 event-stream）不在此处理错误态——消费方读 entry.promise.status 处理，
 * 故此处仅清理登记、不误标 snap.error（避免订阅者把终态误当「流断」去降级）。
 * @param rec  已登记的流式条目
 */
async function driveStreaming(rec: Rec): Promise<void> {
  let res: Response
  try {
    res = await rec.promise
  } catch {
    // 初始 fetch 失败（网络/被 abort）：标错误终态让订阅者降级；消费方 promise 亦 reject、由其 catch 兜。
    rec.snap.error = true; rec.snap.done = true; notify(rec)
    remove(rec.key, false)
    return
  }
  const ct = res.headers.get('content-type') ?? ''
  if (!res.ok || !ct.includes('text/event-stream')) {
    // 终态/非流响应：不读体、不标 snap.error（终态由消费方读 promise.status 分流），仅清理登记。
    remove(rec.key, false)
    return
  }
  try {
    const reader = res.body?.getReader()
    if (!reader) throw new Error('analysis SSE: 无响应体')
    const decoder = new TextDecoder()
    let buf = ''
    let sawTerminal = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let sep: number
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const { event, data } = parseSseBlock(buf.slice(0, sep))
        buf = buf.slice(sep + 2)
        if (!event || !data) continue
        if (event === 'meta') {
          rec.snap.meta = (JSON.parse(data) as { question: AnalysisResponse['question'] }).question
          notify(rec)
        } else if (event === 'section') {
          rec.snap.sections.push(JSON.parse(data) as AnalysisStreamSection)
          notify(rec)
        } else if (event === 'done') {
          rec.snap.final = JSON.parse(data) as AnalysisResponse
          rec.snap.done = true; sawTerminal = true; notify(rec)
        } else if (event === 'error') {
          rec.snap.error = true; rec.snap.done = true; sawTerminal = true; notify(rec)
        }
      }
    }
    // 流正常结束却没有 done/error 帧：视为流式失败，让订阅者降级到 ?stream=0。
    if (!sawTerminal) { rec.snap.error = true; rec.snap.done = true; notify(rec) }
  } catch {
    // 读流中断（含 abort）：标错误终态让订阅者降级（未离页的订阅者据此重发 ?stream=0）。
    if (!rec.snap.done) { rec.snap.error = true; rec.snap.done = true; notify(rec) }
  } finally {
    remove(rec.key, false)
  }
}

/**
 * 消费一条【缓冲(预取)】entry：等 ?stream=0 响应，ok 则把整份 final 填进 snapshot（供碰撞采纳的订阅者定稿），
 * 非 ok（402/403/429/5xx）只标 done（终态由消费方读 promise.status 处理，不误标 error）。纯预取无订阅者时
 * snapshot 填了也无人读，settle 即移除。
 * @param rec  已登记的缓冲条目
 */
async function driveBuffered(rec: Rec): Promise<void> {
  let res: Response
  try {
    res = await rec.promise
  } catch {
    rec.snap.error = true; rec.snap.done = true; notify(rec)
    remove(rec.key, false)
    return
  }
  try {
    if (res.ok) {
      rec.snap.final = (await res.json()) as AnalysisResponse
      rec.snap.done = true; notify(rec)
    } else {
      rec.snap.done = true; notify(rec)
    }
  } catch {
    rec.snap.error = true; rec.snap.done = true; notify(rec)
  } finally {
    remove(rec.key, false)
  }
}

/**
 * 发起（或复用）一次 analysis 请求。已在飞则返回既有条目（去重：点了正在预取/流式的题不重发、不双计）。
 * @param questionId  题 id
 * @param storyId     语料 id
 * @param prefetch    true=后台预取（?stream=0 缓冲、暖缓存、匹配页不订阅）；false=真实用户流式请求（居中抽干、可订阅）
 * @returns           在飞条目句柄
 */
export function requestAnalysis(questionId: string, storyId: string, prefetch: boolean): InflightEntry {
  const key = inflightKey(questionId, storyId)
  const existing = registry.get(key)
  if (existing) return existing.handle
  const controller = new AbortController()
  // 预取带 ?stream=0（服务端 handleBuffered）+ body.prefetch:true（预取闸 + 成本归因）；流式走默认路（handleStreaming）。
  const url = prefetch ? '/api/analysis?stream=0' : '/api/analysis'
  const promise = apiFetch(url, {
    method: 'POST',
    json: prefetch ? { questionId, storyId, prefetch: true } : { questionId, storyId },
    signal: controller.signal,
  })
  const timer = setTimeout(() => remove(key, true), SAFETY_TTL_MS)
  const snap: AnalysisSnapshot = { meta: null, sections: [], final: null, error: false, done: false }
  const subscribers = new Set<(snap: AnalysisSnapshot) => void>()
  const handle: InflightEntry = {
    key,
    promise,
    subscribe: (onUpdate) => {
      subscribers.add(onUpdate)
      onUpdate(snap)   // 立即回放当前 buffered 态（晚订阅者据此拿到已到的全部段）
      return () => { subscribers.delete(onUpdate) }
    },
    abort: () => remove(key, true),
  }
  const rec: Rec = { key, promise, controller, timer, snap, subscribers, handle }
  registry.set(key, rec)
  if (prefetch) void driveBuffered(rec)
  else void driveStreaming(rec)
  return handle
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
