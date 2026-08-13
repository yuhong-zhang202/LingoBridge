/**
 * @module   matching-inflight.test
 * @desc     匹配整跑单飞的单元测 —— 守的是命根：【同键在飞时，真正干活的那趟只发生一次】。
 *           另覆盖：不同键互不阻塞、失败共享且槽位清干净（下一次是全新一趟）、晚订阅者回放、
 *           订阅者抛错不拖垮整趟、回放缓冲存的是拷贝（leader 就地改题对象不会污染晚到者）。
 * @author   LingoBridge
 * @created  2026-08-12
 */
jest.mock('server-only', () => ({}))

import { runMatchOnce, matchRunKey, __resetMatchInflightForTest, type MatchRunEvents } from '@/lib/matching-inflight'
import type { FunnelMatchResult, FunnelMatchedQuestion } from '@/lib/types'
import type { FunnelStreamMeta } from '@/services/matching'

/** 造一份最小合法结果（tag 用于分辨是哪一趟产出的） */
function makeResult(tag: string): FunnelMatchResult {
  return {
    primary: { pointCode: 'SPA_03', pointName: '自然的地方', dimension: '空间感知', reason: 'r' },
    secondary: null,
    questions: [makeQuestion(`q-${tag}`)],
    count: 1, matchedViaSecondary: false, matchedViaNeighbor: false, neighborPointsUsed: [], noMatch: false,
  }
}

/** 造一道最小合法召回题 */
function makeQuestion(id: string): FunnelMatchedQuestion {
  return {
    id, part: 1, question_text: 't', question_text_zh: null,
    cue_card_title: null, cue_card_title_zh: null, is_new: false, topic_only: false,
    matched_point: 'SPA_03', pointName: '自然的地方', dimension: '空间感知', isPrimaryMatch: true,
  }
}

const META: FunnelStreamMeta = {
  primary: null, secondary: null, matchedViaSecondary: false, matchedViaNeighbor: false, candidateCount: 1,
}

/** 一个可手动放行的 Promise（用来把「一趟正在飞」这个状态钉住） */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** 让微任务/宏任务队列跑空 */
async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

/** 记录一个订阅者收到的事件序列 */
function recorder(): { events: MatchRunEvents; log: string[] } {
  const log: string[] = []
  return {
    log,
    events: {
      onMeta: () => log.push('meta'),
      onItem: (q) => log.push(`item:${q.id}`),
    },
  }
}

beforeEach(() => {
  __resetMatchInflightForTest()
})

describe('matching-inflight · 单飞命根', () => {
  test('同键并发两次：真正干活的那趟只跑一次，两边拿同一份结果，角色一 leader 一搭车', async () => {
    const gate = deferred<FunnelMatchResult>()
    const start = jest.fn(() => gate.promise)
    const key = matchRunKey('c1', 'h1')

    const p1 = runMatchOnce(key, {}, start)
    const p2 = runMatchOnce(key, {}, start)
    await tick()

    // 核心：两个请求都已在飞，而「花钱那步」只发生了一次
    expect(start).toHaveBeenCalledTimes(1)

    gate.resolve(makeResult('one'))
    const [a, b] = await Promise.all([p1, p2])

    expect(start).toHaveBeenCalledTimes(1)
    expect(a.result).toBe(b.result)          // 同一份对象，不是两趟各自算的
    expect([a.leader, b.leader].sort()).toEqual([false, true])
  })

  test('不同键并发：各跑各的，互不阻塞（后释放的先返回也不影响先发起的）', async () => {
    const g1 = deferred<FunnelMatchResult>()
    const g2 = deferred<FunnelMatchResult>()
    const s1 = jest.fn(() => g1.promise)
    const s2 = jest.fn(() => g2.promise)

    const p1 = runMatchOnce(matchRunKey('c1', 'h1'), {}, s1)
    const p2 = runMatchOnce(matchRunKey('c2', 'h1'), {}, s2)
    await tick()

    expect(s1).toHaveBeenCalledTimes(1)
    expect(s2).toHaveBeenCalledTimes(1)

    // c2 先完成：不必等 c1（若两键串行/共用槽位，这里会挂住）
    g2.resolve(makeResult('two'))
    expect((await p2).result.questions[0].id).toBe('q-two')
    expect((await p2).leader).toBe(true)

    g1.resolve(makeResult('one'))
    expect((await p1).result.questions[0].id).toBe('q-one')
  })

  test('同一 corpusId 但正文变了（hash 不同）→ 不同键，绝不复用别人的结果', async () => {
    const s1 = jest.fn(async () => makeResult('old'))
    const s2 = jest.fn(async () => makeResult('new'))
    const p1 = runMatchOnce(matchRunKey('c1', 'hash-old'), {}, s1)
    const p2 = runMatchOnce(matchRunKey('c1', 'hash-new'), {}, s2)
    const [a, b] = await Promise.all([p1, p2])

    expect(a.result.questions[0].id).toBe('q-old')
    expect(b.result.questions[0].id).toBe('q-new')
    expect(s1).toHaveBeenCalledTimes(1)
    expect(s2).toHaveBeenCalledTimes(1)
  })

  test('第一趟失败：搭车者跟着失败（不各自重跑），且槽位清干净——下一次是全新一趟', async () => {
    const gate = deferred<FunnelMatchResult>()
    const failing = jest.fn(() => gate.promise)
    const key = matchRunKey('c1', 'h1')

    const p1 = runMatchOnce(key, {}, failing)
    const p2 = runMatchOnce(key, {}, failing)
    await tick()
    gate.reject(new Error('上游 5xx'))

    await expect(p1).rejects.toThrow('上游 5xx')
    await expect(p2).rejects.toThrow('上游 5xx')
    expect(failing).toHaveBeenCalledTimes(1)   // 失败也不许放大成两趟

    // 槽位必须已清：失败不清 = 这条语料永久返回那个失败的 Promise
    const after = jest.fn(async () => makeResult('retry'))
    const out = await runMatchOnce(key, {}, after)
    expect(after).toHaveBeenCalledTimes(1)
    expect(out.leader).toBe(true)
    expect(out.result.questions[0].id).toBe('q-retry')
  })

  test('成功后槽位同样清干净：下一次请求重新跑（不会拿到上一趟的陈旧 Promise）', async () => {
    const key = matchRunKey('c1', 'h1')
    const s1 = jest.fn(async () => makeResult('first'))
    const s2 = jest.fn(async () => makeResult('second'))

    expect((await runMatchOnce(key, {}, s1)).result.questions[0].id).toBe('q-first')
    expect((await runMatchOnce(key, {}, s2)).result.questions[0].id).toBe('q-second')
    expect(s2).toHaveBeenCalledTimes(1)
  })
})

describe('matching-inflight · 事件扇出与回放', () => {
  test('晚订阅者回放：加入前已发生的 meta 补齐，之后的 item 续收（帧序与 leader 一致）', async () => {
    const gate = deferred<void>()
    const leaderRec = recorder()
    const followerRec = recorder()
    const key = matchRunKey('c1', 'h1')

    const start = (emit: MatchRunEvents): Promise<FunnelMatchResult> => (async () => {
      emit.onMeta?.(META)              // follower 加入【之前】就发生
      await gate.promise
      emit.onItem?.(makeQuestion('q1'))  // follower 加入【之后】才发生
      return makeResult('one')
    })()

    const p1 = runMatchOnce(key, leaderRec.events, start)
    await tick()
    expect(followerRec.log).toEqual([])

    const p2 = runMatchOnce(key, followerRec.events, start)
    // 回放是同步完成的：await 一下只是为了对齐时序，回放本身不依赖它
    expect(followerRec.log).toEqual(['meta'])

    gate.resolve()
    await Promise.all([p1, p2])

    expect(leaderRec.log).toEqual(['meta', 'item:q1'])
    expect(followerRec.log).toEqual(['meta', 'item:q1'])
  })

  test('搭车者的回调抛错（断连的 SSE）不许拖垮整趟，leader 照常跑完收帧', async () => {
    const key = matchRunKey('c1', 'h1')
    const leaderRec = recorder()
    const boom: MatchRunEvents = {
      onMeta: () => { throw new Error('客户端已断连') },
      onItem: () => { throw new Error('客户端已断连') },
    }
    const gate = deferred<void>()
    const start = (emit: MatchRunEvents): Promise<FunnelMatchResult> => (async () => {
      emit.onMeta?.(META)
      await gate.promise
      emit.onItem?.(makeQuestion('q1'))
      return makeResult('one')
    })()

    const p1 = runMatchOnce(key, leaderRec.events, start)
    await tick()
    const p2 = runMatchOnce(key, boom, start)   // 回放时就会抛
    gate.resolve()

    const [a, b] = await Promise.all([p1, p2])
    expect(a.result.questions[0].id).toBe('q-one')
    expect(b.result).toBe(a.result)
    expect(leaderRec.log).toEqual(['meta', 'item:q1'])   // leader 一帧没少
  })

  test('回放缓冲存的是拷贝：leader 之后就地改题对象，晚到者回放到的仍是发出那一刻的值', async () => {
    const key = matchRunKey('c1', 'h1')
    const q = makeQuestion('q1')
    const gate = deferred<void>()
    const start = (emit: MatchRunEvents): Promise<FunnelMatchResult> => (async () => {
      q.relevanceScore = 90
      emit.onItem?.(q)          // 发出那一刻是 90 分
      q.relevanceScore = 10     // matchByStory 是在【同一个对象上】就地回填的，模拟发出之后又被改写
      await gate.promise        // 晚到者在这个窗口里加入 —— 回放到的必须还是 90
      return makeResult('one')
    })()

    const seen: (number | null | undefined)[] = []
    const p1 = runMatchOnce(key, {}, start)
    await tick()
    const p2 = runMatchOnce(key, { onItem: (item) => seen.push(item.relevanceScore) }, start)
    gate.resolve()
    await Promise.all([p1, p2])

    expect(seen).toEqual([90])
  })
})
