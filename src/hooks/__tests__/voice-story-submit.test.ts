/**
 * @module   voice-story-submit.test
 * @desc     语音提交流程（runVoiceStorySubmit）的场景回归 —— 钉死那几条
 *           **坏了不会报错、只会让数据悄悄错**的埋点不变式：
 *             1. 每条执行路径恰好一条 flow.capture_submitted（throw 出去的早退会被 catch 再兜一次）；
 *             2. 每次 AI 调用每个 stage 至多一条 flow.ai_call，且请求没发出过就一条都不许有
 *                （否则「没录到声音」会凭空造出一次 network 故障）；
 *             3. newFlowId() 早于本次流程的任何一条埋点（晚了就把事件挂到上一次流程的 flow_id 上）；
 *             4. 「失败但放行」不是失败：整理的非 402 失败与网络失败都记 ai_call 失败码 + capture_submitted proceed。
 *
 *   做法：把流程的全部可观察动作（newFlowId / track / 跳转 / 四个 setter / markSubmitted / stop /
 *   额度守卫 / 两次 apiFetch）按发生顺序记进一条 trace 再断言。latencyMs 归一成 '<num>' 但
 *   【保留有无】—— 「有没有这个字段」正是不变式 2 的观测点。
 *
 *   ⚠️ 每个场景都带 reach 声明并被校验：不写这条的话，一个「其实在前面就早退了」的场景会全程空转、
 *   却照样全绿（本测试第一版就踩过：OK_TEXT 只有 39 个有效字符，差 1 个字触发 text_too_short，
 *   整理段的全部场景形同虚设）。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
import type { VoiceStorySubmitDeps } from '@/hooks/useVoiceStorySubmit'

const trace: unknown[] = []

jest.mock('@/lib/client-events', () => ({
  track: (event: string, props: Record<string, unknown>) => {
    const p: Record<string, unknown> = { ...props }
    if ('latencyMs' in p) p.latencyMs = '<num>'
    trace.push(['track', event, p])
  },
}))
jest.mock('@/lib/flow-id', () => ({ newFlowId: () => { trace.push(['newFlowId']); return 'f1' } }))
// ⚠️ 必须 mock：node 环境无 window，真实 putHandoff/putHandoffJson 一律返回空串，
// 「带整理结果跳转」与「只带原文跳转」会长得一模一样（变异测试实测过，不 mock 就抓不住）。
jest.mock('@/lib/handoff', () => ({
  putHandoff: (t: string) => `H(${t})`,
  putHandoffJson: (v: unknown) => `J(${JSON.stringify(v)})`,
}))

let fetchScript: (url: string) => Promise<Response>
jest.mock('@/lib/api-client', () => ({
  apiFetch: (url: string) => { trace.push(['apiFetch', url]); return fetchScript(url) },
}))

import { runVoiceStorySubmit } from '@/hooks/useVoiceStorySubmit'

type Reply = { kind: 'res'; status: number; body?: unknown; raw?: string } | { kind: 'throw' }

interface Scenario {
  name: string
  seconds?: number
  quotaBlocked?: boolean
  /** null = 没录到声音；number = blob 字节数 */
  blobBytes?: number | null
  qid?: string | null
  transcribe?: Reply
  restructure?: Reply
  /** 在哪一次请求【返回之后】把 signal 置为已中断 */
  abortAfter?: 'transcribe' | 'restructure'
  /** 本场景【预期跑到】哪一段 —— 防「其实在前面就早退了、后半条流程空转还全绿」 */
  reach: 'early' | 'transcribe' | 'restructure'
}

// 有效字符须 ≥ MIN_CORPUS_CHARS(40)，否则会在 text_too_short 早退（见顶注 ⚠️）
const OK_TEXT = '上周我在公司做了一次汇报，准备了整整三天，中途投影仪突然坏了，我只好临时改成口头讲，结果反响还算不错。'

function toResponse(r: Reply): Promise<Response> {
  if (r.kind === 'throw') return Promise.reject(new Error('network down'))
  return Promise.resolve(new Response(r.raw !== undefined ? r.raw : JSON.stringify(r.body ?? {}), { status: r.status }))
}

/** 造一次运行的依赖：所有动作按发生顺序记进 trace */
function makeDeps(sc: Scenario): VoiceStorySubmitDeps {
  const state = { aborted: false }
  const signal = { get aborted(): boolean { return state.aborted } } as AbortSignal
  fetchScript = (url: string): Promise<Response> => {
    const isTranscribe = url.includes('transcribe')
    const reply: Reply = isTranscribe
      ? (sc.transcribe ?? { kind: 'res', status: 200, body: { text: OK_TEXT } })
      : (sc.restructure ?? { kind: 'res', status: 200, body: { cleanedText: '整理稿', usable: true, summary: '概括' } })
    const stage = isTranscribe ? 'transcribe' : 'restructure'
    return toResponse(reply).then(
      (res) => { if (sc.abortAfter === stage) state.aborted = true; return res },
      (e: unknown) => { if (sc.abortAfter === stage) state.aborted = true; throw e },
    )
  }
  return {
    qid: sc.qid ?? null,
    stop: async () => {
      trace.push(['stop'])
      if (sc.blobBytes === null) return null
      const size = sc.blobBytes ?? 1024
      // 超 10MB 的场景不必真造 10MB 内存：流程只读 blob.size
      const blob = size > 1024 ? ({ size } as Blob) : new Blob(['x'.repeat(size)])
      return { blob, peakLevel: 0.42, durationMs: 12345 }
    },
    getSeconds: () => sc.seconds ?? 12,
    checkQuota: async () => { trace.push(['checkQuota']); return sc.quotaBlocked ?? false },
    markSubmitted: () => trace.push(['markSubmitted']),
    beginAbort: () => { trace.push(['beginAbort']); return signal },
    push: (href) => trace.push(['push', href]),
    setError: (m) => trace.push(['setError', m]),
    setTranscribing: (v) => trace.push(['setTranscribing', v]),
    setToastMsg: (m) => trace.push(['setToastMsg', m]),
    setQuotaReached: (v) => trace.push(['setQuotaReached', v]),
  }
}

async function run(sc: Scenario): Promise<Row[]> {
  trace.length = 0
  await runVoiceStorySubmit(makeDeps(sc))
  return JSON.parse(JSON.stringify(trace)) as Row[]
}

type Row = [string, ...unknown[]]

const SCENARIOS: Scenario[] = [
  { name: '录太短', reach: 'early', seconds: 3 },
  { name: '额度守卫拦截', reach: 'early', quotaBlocked: true },
  { name: '没录到声音', reach: 'early', blobBytes: null },
  { name: '录音过长', reach: 'early', blobBytes: 11 * 1024 * 1024 },
  { name: '转写 403', reach: 'transcribe', transcribe: { kind: 'res', status: 403 } },
  { name: '转写 402', reach: 'transcribe', transcribe: { kind: 'res', status: 402 } },
  { name: '转写 503 ASR_BUSY', reach: 'transcribe', transcribe: { kind: 'res', status: 503, body: { code: 'ASR_BUSY' } } },
  { name: '转写 422 EMPTY_TRANSCRIPT', reach: 'transcribe', transcribe: { kind: 'res', status: 422, body: { code: 'EMPTY_TRANSCRIPT' } } },
  { name: '转写 422 豆包静音码 20000003（走 status 兜底）', reach: 'transcribe', transcribe: { kind: 'res', status: 422, body: { code: '20000003' } } },
  { name: '转写 422 无 code（体解析不出 code 也走 status 兜底）', reach: 'transcribe', transcribe: { kind: 'res', status: 422, body: {} } },
  { name: '转写 429', reach: 'transcribe', transcribe: { kind: 'res', status: 429, body: {} } },
  { name: '转写 400', reach: 'transcribe', transcribe: { kind: 'res', status: 400, body: {} } },
  { name: '转写 401', reach: 'transcribe', transcribe: { kind: 'res', status: 401, body: {} } },
  { name: '转写 500', reach: 'transcribe', transcribe: { kind: 'res', status: 500, body: {} } },
  { name: '转写 418（other）', reach: 'transcribe', transcribe: { kind: 'res', status: 418, body: {} } },
  { name: '转写失败体不是 JSON', reach: 'transcribe', transcribe: { kind: 'res', status: 500, raw: '<html>' } },
  { name: '转写网络失败', reach: 'transcribe', transcribe: { kind: 'throw' } },
  { name: '转写中途 abort', reach: 'transcribe', transcribe: { kind: 'throw' }, abortAfter: 'transcribe' },
  { name: '转写成功后 abort', reach: 'transcribe', abortAfter: 'transcribe' },
  { name: '转写文本 garbage', reach: 'transcribe', transcribe: { kind: 'res', status: 200, body: { text: 'ab' } } },
  { name: '转写文本 too_short', reach: 'transcribe', transcribe: { kind: 'res', status: 200, body: { text: '还行吧' } } },
  { name: '整理成功（无 qid）', reach: 'restructure' },
  { name: '整理成功（带 qid）', reach: 'restructure', qid: 'Q123' },
  { name: '整理成功但无 summary', reach: 'restructure', restructure: { kind: 'res', status: 200, body: { cleanedText: '整理稿', usable: true } } },
  { name: '整理 usable=false', reach: 'restructure', restructure: { kind: 'res', status: 200, body: { cleanedText: '整理稿', usable: false } } },
  { name: '整理 402', reach: 'restructure', restructure: { kind: 'res', status: 402 } },
  { name: '整理 403（与文字路径的已知分叉：语音侧不走同意闸）', reach: 'restructure', restructure: { kind: 'res', status: 403 } },
  { name: '整理 429', reach: 'restructure', restructure: { kind: 'res', status: 429 } },
  { name: '整理 400', reach: 'restructure', restructure: { kind: 'res', status: 400 } },
  { name: '整理 401', reach: 'restructure', restructure: { kind: 'res', status: 401 } },
  { name: '整理 500', reach: 'restructure', restructure: { kind: 'res', status: 500 } },
  { name: '整理 418（other）', reach: 'restructure', restructure: { kind: 'res', status: 418 } },
  { name: '整理成功体不是 JSON', reach: 'restructure', restructure: { kind: 'res', status: 200, raw: '<html>' } },
  { name: '整理网络失败', reach: 'restructure', restructure: { kind: 'throw' } },
  { name: '整理中途 abort（抛错）', reach: 'restructure', restructure: { kind: 'throw' }, abortAfter: 'restructure' },
  { name: '整理成功后 abort', reach: 'restructure', abortAfter: 'restructure' },
  { name: '整理 402 且已 abort', reach: 'restructure', restructure: { kind: 'res', status: 402 }, abortAfter: 'restructure' },
  { name: '整理 500 且已 abort', reach: 'restructure', restructure: { kind: 'res', status: 500 }, abortAfter: 'restructure' },
]

const tracks = (t: Row[], event: string): Record<string, unknown>[] =>
  t.filter((r) => r[0] === 'track' && r[1] === event).map((r) => r[2] as Record<string, unknown>)

describe('runVoiceStorySubmit · 埋点不变式（每条场景都要成立）', () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))('%s', async (_n, sc) => {
    const t = await run(sc)

    // 场景真的跑到了预期那一段（否则后面的断言只是在验一条没跑的路）
    const fetched = t.filter((r) => r[0] === 'apiFetch').map((r) => r[1])
    expect(fetched).toEqual(
      { early: [], transcribe: ['/api/transcribe'], restructure: ['/api/transcribe', '/api/restructure'] }[sc.reach],
    )

    // 不变式 1：恰好一条 capture_submitted
    expect(tracks(t, 'flow.capture_submitted')).toHaveLength(1)

    // 不变式 2：每个 stage 至多一条 ai_call；且请求没发出过就一条都没有
    const ai = tracks(t, 'flow.ai_call')
    for (const stage of ['transcribe', 'restructure']) {
      expect(ai.filter((p) => p.stage === stage).length).toBeLessThanOrEqual(1)
    }
    if (sc.reach === 'early') expect(ai).toHaveLength(0)

    // 不变式 3：newFlowId 早于本次流程的任何一条埋点
    const flowIdx = t.findIndex((r) => r[0] === 'newFlowId')
    const trackIdx = t.findIndex((r) => r[0] === 'track')
    expect(flowIdx).toBeGreaterThanOrEqual(0)
    expect(flowIdx).toBeLessThan(trackIdx)
  })
})

describe('runVoiceStorySubmit · 关键场景的完整动作序列', () => {
  it('录太短：不停录、不发请求、只报 too_short', async () => {
    expect(await run({ name: '', reach: 'early', seconds: 3 })).toEqual([
      ['setError', null],
      ['newFlowId'],
      ['track', 'flow.capture_submitted', { mode: 'voice', outcome: 'too_short', durationSec: 3 }],
      ['setError', '还想再说点什么吗？目前语料可能有点短哦'],
    ])
  })

  it('额度守卫拦截：报 quota_blocked 之后才停录，且一条 ai_call 都不许有', async () => {
    expect(await run({ name: '', reach: 'early', quotaBlocked: true })).toEqual([
      ['setError', null],
      ['newFlowId'],
      ['checkQuota'],
      ['track', 'flow.capture_submitted', { mode: 'voice', outcome: 'quota_blocked', durationSec: 12 }],
      ['stop'],
    ])
  })

  it('没录到声音：ai_call 一条都没有（t0 未置位，不许凭空记 network）', async () => {
    const t = await run({ name: '', reach: 'early', blobBytes: null })
    expect(tracks(t, 'flow.ai_call')).toEqual([])
    expect(tracks(t, 'flow.capture_submitted')).toEqual([{ mode: 'voice', outcome: 'no_audio', durationSec: 12 }])
    expect(t.filter((r) => r[0] === 'setError').map((r) => r[1])).toEqual([null, '没有录到声音，请重试'])
  })

  it('整理成功：ai_call 两条 ok + proceed + 带整理结果跳转（qid 透传）', async () => {
    const t = await run({ name: '', reach: 'restructure', qid: 'Q1' })
    expect(tracks(t, 'flow.ai_call')).toEqual([
      { stage: 'transcribe', result: 'ok', httpStatus: 200, latencyMs: '<num>' },
      { stage: 'restructure', mode: 'voice', result: 'ok', httpStatus: 200, latencyMs: '<num>' },
    ])
    expect(tracks(t, 'flow.capture_submitted')).toEqual([{ mode: 'voice', outcome: 'proceed', durationSec: 12 }])
    expect(t.at(-1)).toEqual([
      'push',
      `/restructure?h=J(${JSON.stringify({ rawText: OK_TEXT, cleanedText: '整理稿', summary: '概括' })})&qid=Q1`,
    ])
  })

  it('整理 500：「失败但放行」—— ai_call 记失败码、capture_submitted 记 proceed，只带原文跳转', async () => {
    const t = await run({ name: '', reach: 'restructure', restructure: { kind: 'res', status: 500 } })
    expect(tracks(t, 'flow.ai_call').at(-1))
      .toEqual({ stage: 'restructure', mode: 'voice', result: 'server_5xx', httpStatus: 500, latencyMs: '<num>' })
    expect(tracks(t, 'flow.capture_submitted')).toEqual([{ mode: 'voice', outcome: 'proceed', durationSec: 12 }])
    expect(t.at(-1)).toEqual(['push', `/restructure?h=H(${OK_TEXT})`])
  })

  it('整理网络失败：同样是「失败但放行」', async () => {
    const t = await run({ name: '', reach: 'restructure', restructure: { kind: 'throw' } })
    expect(tracks(t, 'flow.ai_call').at(-1))
      .toEqual({ stage: 'restructure', mode: 'voice', result: 'network', httpStatus: 0, latencyMs: '<num>' })
    expect(tracks(t, 'flow.capture_submitted')).toEqual([{ mode: 'voice', outcome: 'proceed', durationSec: 12 }])
  })

  it('整理 402：不跳转，弹试用结束覆盖层', async () => {
    const t = await run({ name: '', reach: 'restructure', restructure: { kind: 'res', status: 402 } })
    expect(tracks(t, 'flow.ai_call').at(-1))
      .toEqual({ stage: 'restructure', mode: 'voice', result: 'quota_402', httpStatus: 402, latencyMs: '<num>' })
    expect(tracks(t, 'flow.capture_submitted')).toEqual([{ mode: 'voice', outcome: 'quota_blocked', durationSec: 12 }])
    expect(t.some((r) => r[0] === 'push')).toBe(false)
    expect(t).toContainEqual(['setQuotaReached', true])
  })

  it('整理 403：语音路径【不】走同意闸（与文字路径的已知分叉，改它=改行为）', async () => {
    const t = await run({ name: '', reach: 'restructure', restructure: { kind: 'res', status: 403 } })
    expect(tracks(t, 'flow.ai_call').at(-1))
      .toEqual({ stage: 'restructure', mode: 'voice', result: 'other', httpStatus: 403, latencyMs: '<num>' })
    expect(tracks(t, 'flow.capture_submitted')).toEqual([{ mode: 'voice', outcome: 'proceed', durationSec: 12 }])
    expect(t.at(-1)).toEqual(['push', `/restructure?h=H(${OK_TEXT})`])
  })

  it('转写 403：走同意闸回首页，不进整理段', async () => {
    const t = await run({ name: '', reach: 'transcribe', transcribe: { kind: 'res', status: 403 } })
    expect(tracks(t, 'flow.ai_call'))
      .toEqual([{ stage: 'transcribe', result: 'consent_403', httpStatus: 403, latencyMs: '<num>' }])
    expect(tracks(t, 'flow.capture_submitted')).toEqual([{ mode: 'voice', outcome: 'consent_blocked', durationSec: 12 }])
    expect(t.at(-1)).toEqual(['push', '/'])
  })

  it('转写 422 但 code 非 EMPTY_TRANSCRIPT（豆包静音码 20000003）：按 status 兜底落 empty_422 桶 + 「没太听清」文案', async () => {
    // 服务端是「内容为空」的唯一真源（EMPTY_TRANSCRIPT 与静音码都归 422）；客户端只认 code 抄码表
    // 曾让静音落 other 桶 + 「转写失败」故障文案。此用例钉死：任何 422 都走 empty_422 + 友好引导。
    const t = await run({ name: '', reach: 'transcribe', transcribe: { kind: 'res', status: 422, body: { code: '20000003' } } })
    expect(tracks(t, 'flow.ai_call'))
      .toEqual([{ stage: 'transcribe', result: 'empty_422', httpStatus: 422, latencyMs: '<num>' }])
    expect(t.filter((r) => r[0] === 'setError').map((r) => r[1]))
      .toContain('好像没太听清，要不要再说一次？')
  })

  it('转写中途 abort：ai_call 记 aborted、capture_submitted 记 aborted，且不报错不跳转', async () => {
    const t = await run({ name: '', reach: 'transcribe', transcribe: { kind: 'throw' }, abortAfter: 'transcribe' })
    expect(tracks(t, 'flow.ai_call'))
      .toEqual([{ stage: 'transcribe', result: 'aborted', httpStatus: 0, latencyMs: '<num>' }])
    expect(tracks(t, 'flow.capture_submitted')).toEqual([{ mode: 'voice', outcome: 'aborted', durationSec: 12 }])
    expect(t.some((r) => r[0] === 'push')).toBe(false)
  })

  it('整理成功但已 abort：仍要报 aborted（否则这一段的中断在结局分布里凭空消失）', async () => {
    const t = await run({ name: '', reach: 'restructure', abortAfter: 'restructure' })
    expect(tracks(t, 'flow.capture_submitted')).toEqual([{ mode: 'voice', outcome: 'aborted', durationSec: 12 }])
    expect(t.some((r) => r[0] === 'push')).toBe(false)
    expect(t.some((r) => r[0] === 'markSubmitted')).toBe(false)
  })
})
