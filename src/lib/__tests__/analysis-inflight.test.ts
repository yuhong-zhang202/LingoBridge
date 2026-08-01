/**
 * @module   analysis-inflight.test
 * @desc     统一流式在飞注册表单测 —— 守卫本改造命根：【晚订阅者回放】。订阅前已到 N 段，订阅即拿到全 N 段
 *           + 续收 done/final。另覆盖：流结束无 done → snap.error（降级信号）、预取走 ?stream=0 缓冲、
 *           同键去重（不双发）、abortAll。apiFetch 全 mock，不发真实请求。
 * @author   LingoBridge
 * @created  2026-08-01
 */
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn() }))

import { requestAnalysis, abortAll, inflightKey, type AnalysisSnapshot } from '@/lib/analysis-inflight'
import { apiFetch } from '@/lib/api-client'
import type { AnalysisResponse } from '@/lib/types'

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>

const ENC = new TextEncoder()
function frame(event: string, data: unknown): Uint8Array {
  return ENC.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

const META = { id: 'q1', part: 1 as const, en: 'Q?', zh: '题', dimension: null, isNew: false }
const SEC_SL = { kind: 'structureLabel' as const, value: '标签' }
const SEC_FP = { kind: 'focusPoint' as const, value: { title: 't', desc: 'd' } }
const FINAL: AnalysisResponse = { question: META, analysis: { structureLabel: '标签', focusPoints: [{ title: 't', desc: 'd' }], phrases: [] } }

/**
 * 让 apiFetch 返回手动可控的 SSE Response，暴露其 controller 供逐帧 enqueue。
 * 关键：读取 init.signal 并接线 —— abort 时 error 掉流，真实模拟 fetch 被 abort 后 body 读取抛错，
 * 这样 abortAll 的中止才会传导到 driveStreaming 的 reader.read()（生产里由 fetch/undici 提供，mock 须补齐）。
 * 支持多次调用：按调用序把各自 controller 推进 ctrls，测试按序取用。
 */
function mountControllableSSE(): { ctrls: ReadableStreamDefaultController<Uint8Array>[] } {
  const ctrls: ReadableStreamDefaultController<Uint8Array>[] = []
  mockApiFetch.mockImplementation((_url, init) => {
    let ref!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(c) { ref = c } })
    ctrls.push(ref)
    const signal = (init as { signal?: AbortSignal } | undefined)?.signal
    signal?.addEventListener('abort', () => { try { ref.error(new DOMException('aborted', 'AbortError')) } catch { /* 已关 */ } })
    return Promise.resolve(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
  })
  return { ctrls }
}

/** 让微任务队列跑空（驱动 driveStreaming 的 reader.read() 消化已 enqueue 的帧）。 */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

/** 订阅并把每次回放的 snapshot 快照（浅拷贝 sections）记进数组，便于断言各时点所见。 */
function record(entry: ReturnType<typeof requestAnalysis>): { seen: AnalysisSnapshot[]; unsub: () => void } {
  const seen: AnalysisSnapshot[] = []
  const unsub = entry.subscribe((s) => seen.push({ meta: s.meta, sections: [...s.sections], final: s.final, error: s.error, done: s.done }))
  return { seen, unsub }
}

beforeEach(() => {
  jest.clearAllMocks()
  abortAll()   // 清空跨用例残留
})

describe('analysis-inflight · 晚订阅者回放（命根）', () => {
  test('订阅前已到 meta+2 段，订阅即拿全部 + 续收 final', async () => {
    const { ctrls } = mountControllableSSE()
    const entry = requestAnalysis('q1', 'c1', false)

    // 订阅前：meta + 两段先到
    ctrls[0].enqueue(frame('meta', { question: META }))
    ctrls[0].enqueue(frame('section', SEC_SL))
    ctrls[0].enqueue(frame('section', SEC_FP))
    await flush()

    // 晚订阅：立即回放当前 buffered 态 —— 必须拿到已到的全部段
    const { seen } = record(entry)
    expect(seen[0].meta).toEqual(META)
    expect(seen[0].sections).toEqual([SEC_SL, SEC_FP])
    expect(seen[0].done).toBe(false)

    // 续收：done → final 定稿
    ctrls[0].enqueue(frame('done', FINAL))
    ctrls[0].close()
    await flush()

    const last = seen[seen.length - 1]
    expect(last.final).toEqual(FINAL)
    expect(last.done).toBe(true)
    expect(last.error).toBe(false)
  })

  test('流结束但无 done 帧 → snap.error（降级信号）', async () => {
    const { ctrls } = mountControllableSSE()
    const entry = requestAnalysis('q1', 'c1', false)
    const { seen } = record(entry)

    ctrls[0].enqueue(frame('meta', { question: META }))
    ctrls[0].close()   // 无 done 即结束
    await flush()

    const last = seen[seen.length - 1]
    expect(last.error).toBe(true)
    expect(last.done).toBe(true)
    expect(last.final).toBeNull()
  })

  test('error 帧 → snap.error（降级信号）', async () => {
    const { ctrls } = mountControllableSSE()
    const entry = requestAnalysis('q1', 'c1', false)
    const { seen } = record(entry)

    ctrls[0].enqueue(frame('error', { error: 'x' }))
    ctrls[0].close()
    await flush()

    const last = seen[seen.length - 1]
    expect(last.error).toBe(true)
    expect(last.done).toBe(true)
  })
})

describe('analysis-inflight · 预取 / 去重 / abort', () => {
  test('prefetch=true → 发 ?stream=0 缓冲请求（body.prefetch:true），final 从缓冲响应填', async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify(FINAL), { status: 200, headers: { 'content-type': 'application/json' } }))
    const entry = requestAnalysis('q1', 'c1', true)

    expect(mockApiFetch).toHaveBeenCalledWith('/api/analysis?stream=0', expect.objectContaining({
      method: 'POST',
      json: { questionId: 'q1', storyId: 'c1', prefetch: true },
    }))

    const res = await entry.promise
    expect(res.ok).toBe(true)
    const { seen } = record(entry)
    await flush()
    const last = seen[seen.length - 1]
    expect(last.final).toEqual(FINAL)
    expect(last.done).toBe(true)
  })

  test('流式请求发到 /api/analysis（无 stream 参数），body 不带 prefetch', async () => {
    mountControllableSSE()
    requestAnalysis('q1', 'c1', false)
    expect(mockApiFetch).toHaveBeenCalledWith('/api/analysis', expect.objectContaining({
      method: 'POST',
      json: { questionId: 'q1', storyId: 'c1' },
    }))
  })

  test('同键去重：二次 requestAnalysis 复用同一在飞条目，apiFetch 只发一次', async () => {
    mountControllableSSE()
    const a = requestAnalysis('q1', 'c1', false)
    const b = requestAnalysis('q1', 'c1', false)
    expect(b).toBe(a)
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
    expect(a.key).toBe(inflightKey('q1', 'c1'))
  })

  test('abortAll(except) 保留指定键、清其余；被清条目 abort 后订阅者收到 error', async () => {
    const { ctrls } = mountControllableSSE()   // ctrls[0]=keep(q1)、ctrls[1]=drop(q2)
    const keep = requestAnalysis('q1', 'c1', false)
    const drop = requestAnalysis('q2', 'c1', false)
    const dropSeen = record(drop)
    await flush()

    abortAll(keep.key)
    await flush()

    // drop 被 abort → 流 error → 读流中断 → snap.error（降级信号）
    expect(dropSeen.seen[dropSeen.seen.length - 1].error).toBe(true)

    // keep 未被清、仍在飞：可续收 done → final
    ctrls[0].enqueue(frame('done', FINAL))
    ctrls[0].close()
    await flush()
    const keepSeen = record(keep)
    expect(keepSeen.seen[keepSeen.seen.length - 1].final).toEqual(FINAL)
  })
})
