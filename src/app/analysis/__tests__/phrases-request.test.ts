/**
 * @module   phrases-request.test
 * @desc     换档词组请求封装的超时判定单测：按时返回原样透传且定时器必清、
 *           20s 超时抛 kind='timeout'、网络 reject 抛 kind='network'（不误记成对方桶）、
 *           非 2xx 响应不算传输失败。
 * @author   LingoBridge
 * @created  2026-08-04
 */
import { fetchPhrasesWithTimeout, PhrasesRequestError, PHRASES_TIMEOUT_MS } from '../phrases-request'

afterEach(() => {
  jest.useRealTimers()
})

test('按时返回：响应原样透传，定时器已清、超时点过后不再 abort', async () => {
  jest.useFakeTimers()
  let seen: AbortSignal | undefined
  const res = { ok: true, status: 200 } as Response
  const out = await fetchPhrasesWithTimeout((signal) => { seen = signal; return Promise.resolve(res) })
  expect(out).toBe(res)
  // 定时器若没清，这里推进时间会 abort 已完成的请求信号
  jest.advanceTimersByTime(PHRASES_TIMEOUT_MS + 1_000)
  expect(seen?.aborted).toBe(false)
})

test('20s 未返回 → 主动 abort → 抛 kind=timeout（不落 network 桶）', async () => {
  jest.useFakeTimers()
  // 模拟真实 fetch 行为：挂起不 resolve，signal abort 时才 reject
  const doFetch = (signal: AbortSignal): Promise<Response> =>
    new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')))
    })
  const p = fetchPhrasesWithTimeout(doFetch)
  const assertion = expect(p).rejects.toMatchObject({ name: 'PhrasesRequestError', kind: 'timeout' })
  jest.advanceTimersByTime(PHRASES_TIMEOUT_MS)
  await assertion
})

test('网络层 reject → 抛 kind=network（非超时不误记 timeout）', async () => {
  const p = fetchPhrasesWithTimeout(() => Promise.reject(new TypeError('fetch failed')))
  await expect(p).rejects.toBeInstanceOf(PhrasesRequestError)
  await expect(p).rejects.toMatchObject({ kind: 'network' })
})

test('非 2xx 响应不算传输失败：原样 resolve，状态码分流归调用方', async () => {
  const res = { ok: false, status: 500 } as Response
  await expect(fetchPhrasesWithTimeout(() => Promise.resolve(res))).resolves.toBe(res)
})
