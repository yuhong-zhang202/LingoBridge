/**
 * @module   story-submit.test
 * @desc     文字提交流程（runStorySubmit）的场景守卫 —— 2026-08-27「文字路径跳过整理确认页」这条改动的
 *           全部要害都在这里钉死。四组，每组坏了都不会报错、只会让线上悄悄错：
 *
 *     1. **建语料必须带上 cleanedText（原子写）**。跳过整理页之后没人再写 corpus.cleaned_text，
 *        而 getCorpusByIdServer 只 select cleaned_text、没有 `?? raw_text` 兜底（刻意的）。
 *        漏了它：/api/matching 400、**`/api/analysis` 静默降级成「通用分析」（界面完全看不出来）**、
 *        教练 fallback、Anki 卡背、练习题目页空白卡 —— 六个下游同时哑，一处都不报警。
 *        ⚠️ 顺带钉死【建语料与跳转的先后】：必须先拿到语料 id 才跳，绝不能拆成「先跳、后台再补写」——
 *        慢网下匹配页会先挂载并发出 /api/matching，撞 400，这个 bug 本地永远测不出来。
 *     2. **payload=null（整理 AI 失败但放行）一律回落 /restructure**。那条路上客户端手里一个字的
 *        cleanedText 都没有，不回落就是拿空语料建库。
 *     3. **雅思流的自动绑定不能丢**（台账 179）：语料落库后必须调 bindIeltsCorpus，
 *        否则素材库把已有题的语料显示成「还没绑题目」，用户对本来有题的语料再跑一整条 AI 匹配。
 *     4. **source 必须是 text**，以及回落 /restructure 时 URL 要带 `&mode=text` ——
 *        少了它，从 /write 敲的文字故事在素材库里挂着麦克风图标（改动前所有文字故事都是这样）。
 *
 *   外加埋点不变式：每条执行路径【恰好】一条 flow.capture_submitted；
 *   「失败但放行」不是失败（ai_call 记失败码 + capture_submitted 记 proceed）。
 *
 *   ⚠️ 每个场景都断言「跑到了哪一步」（有没有发出 /api/corpus），防「其实在前面就早退了、
 *   后半条流程空转却照样全绿」——语音那份测试的第一版就踩过这个坑（见 voice-story-submit.test.ts 顶注）。
 *
 * @author   LingoBridge
 * @created  2026-08-27
 */
import type { CaptureOutcome } from '@/lib/event-schema'
import type { StorySubmitDeps, StoryQuotaVariant } from '@/hooks/useStorySubmit'

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
// 「带整理结果回落」与「只带原文回落」会长得一模一样（语音那份实测过，不 mock 就抓不住）。
jest.mock('@/lib/handoff', () => ({
  putHandoff: (t: string) => `H(${t})`,
  putHandoffJson: (v: unknown) => `J(${JSON.stringify(v)})`,
}))
jest.mock('@/lib/flow-shape', () => ({
  setFlowShape: (s: unknown) => { trace.push(['setFlowShape', s]) },
  clearFlowShape: () => { trace.push(['clearFlowShape']) },
}))
// 雅思流的自动绑定（配对 + 存题卡）真身在 lib/ielts-corpus-binding，此处只验「调了没、参数对不对」；
// 它自己的行为由 restructure 页那条既有路径共用同一份实现保证。
jest.mock('@/lib/ielts-corpus-binding', () => ({
  bindIeltsCorpus: (questionId: string, storyId: string) => {
    trace.push(['bindIeltsCorpus', questionId, storyId])
    return Promise.resolve('saved')
  },
}))

let fetchScript: (url: string) => Promise<Response>
jest.mock('@/lib/api-client', () => ({
  apiFetch: (url: string, init?: { json?: unknown }) => {
    trace.push(['apiFetch', url, init?.json])
    return fetchScript(url)
  },
  readQuotaReason: async (res: Response) => {
    const body = (await res.clone().json()) as { reason?: string }
    return body?.reason ?? null
  },
}))

import { runStorySubmit } from '@/hooks/useStorySubmit'

type Reply = { kind: 'res'; status: number; body?: unknown } | { kind: 'throw' }

/** 有效字符须 ≥ MIN_CORPUS_CHARS(40)，否则会在 text_too_short 早退（见顶注 ⚠️） */
const OK_TEXT = '上周我在公司做了一次汇报，准备了整整三天，中途投影仪突然坏了，我只好临时改成口头讲，结果反响还算不错。'
const CLEANED = '上周我在公司做汇报，准备了三天。投影仪中途坏了，我改成口头讲，反响不错。'
const SUMMARY = '一次投影仪故障下的临场汇报'

interface Scenario {
  text?: string
  qid?: string | null
  restructure?: Reply
  corpus?: Reply
}

function toResponse(r: Reply): Promise<Response> {
  if (r.kind === 'throw') return Promise.reject(new Error('network down'))
  return Promise.resolve(new Response(JSON.stringify(r.body ?? {}), { status: r.status }))
}

interface RunResult {
  navigated: string[]
  toasts: (string | null)[]
  quota: (StoryQuotaVariant | null)[]
  outcomes: CaptureOutcome[]
  submitting: boolean[]
}

/** 跑一次流程，把全部可观察动作收进 trace + 结构化结果 */
async function run(sc: Scenario): Promise<RunResult> {
  trace.length = 0
  const res: RunResult = { navigated: [], toasts: [], quota: [], outcomes: [], submitting: [] }
  fetchScript = (url: string): Promise<Response> => {
    if (url.includes('/api/restructure')) {
      return toResponse(sc.restructure ?? { kind: 'res', status: 200, body: { cleanedText: CLEANED, usable: true, summary: SUMMARY } })
    }
    return toResponse(sc.corpus ?? { kind: 'res', status: 200, body: { corpus: { id: 'corpus-1' } } })
  }
  const deps: StorySubmitDeps = {
    text: sc.text ?? OK_TEXT,
    qid: sc.qid ?? null,
    navigate: (href) => { trace.push(['navigate', href]); res.navigated.push(href) },
    setSubmitting: (v) => { res.submitting.push(v) },
    setToastMsg: (m) => { trace.push(['toast', m]); res.toasts.push(m) },
    setQuotaVariant: (v) => { trace.push(['quota', v]); res.quota.push(v) },
    onOutcome: (o) => { res.outcomes.push(o) },
  }
  await runStorySubmit(deps)
  return res
}

/** 本次运行里对某个 URL 发出的请求体（没发过 → undefined） */
function bodyOf(url: string): unknown {
  const hit = trace.find((t) => Array.isArray(t) && t[0] === 'apiFetch' && String(t[1]).includes(url))
  return Array.isArray(hit) ? hit[2] : undefined
}

/** 本次运行发出的请求 URL 序列 */
function calls(): string[] {
  return trace.filter((t): t is [string, string, unknown] => Array.isArray(t) && t[0] === 'apiFetch').map((t) => t[1])
}

/** 本次运行报的 capture_submitted 条数（不变式：恰好 1 或 0——0 仅限流程未定局，本测试无此场景） */
function submittedEvents(): Record<string, unknown>[] {
  return trace
    .filter((t): t is [string, string, Record<string, unknown>] => Array.isArray(t) && t[0] === 'track' && t[1] === 'flow.capture_submitted')
    .map((t) => t[2])
}

/** 本次运行报的 flow.ai_call */
function aiEvents(): Record<string, unknown>[] {
  return trace
    .filter((t): t is [string, string, Record<string, unknown>] => Array.isArray(t) && t[0] === 'track' && t[1] === 'flow.ai_call')
    .map((t) => t[2])
}

describe('要害 1 · 建语料必须原子带上 cleanedText，且拿到 id 才跳转', () => {
  it('故事流：POST /api/corpus 带 source=text + rawText + cleanedText + summary，然后才跳 /matching', async () => {
    const r = await run({})
    expect(calls()).toEqual(['/api/restructure', '/api/corpus'])
    expect(bodyOf('/api/corpus')).toEqual({
      source: 'text',
      rawText: OK_TEXT,
      cleanedText: CLEANED,
      summary: SUMMARY,
    })
    expect(r.navigated).toEqual(['/matching?corpusId=corpus-1'])
    // 顺序不能反：跳转必须排在建语料【之后】（慢网下匹配页会立刻发 /api/matching，撞未写好的 cleaned_text）
    const iCorpus = trace.findIndex((t) => Array.isArray(t) && t[0] === 'apiFetch' && String(t[1]).includes('/api/corpus'))
    const iNav = trace.findIndex((t) => Array.isArray(t) && t[0] === 'navigate')
    expect(iCorpus).toBeGreaterThanOrEqual(0)
    expect(iNav).toBeGreaterThan(iCorpus)
  })

  it('文字路径【不再经过】/restructure，且这一条 proceed 只报一次', async () => {
    const r = await run({})
    expect(r.navigated.join(' ')).not.toContain('/restructure')
    expect(submittedEvents()).toEqual([{ mode: 'text', outcome: 'proceed', charCount: OK_TEXT.trim().length }])
    expect(r.outcomes).toEqual(['proceed'])
  })

  it('步骤条形态标识写 { text, story }（只喂步骤条，不参与业务分支）', async () => {
    await run({})
    expect(trace).toContainEqual(['setFlowShape', { mode: 'text', flow: 'story' }])
  })
})

describe('要害 2 · payload=null（整理 AI 失败但放行）一律回落 /restructure', () => {
  it('整理 500：不建语料、回落整理页（只带原文），ai_call 记 server_5xx 而 capture_submitted 记 proceed', async () => {
    const r = await run({ restructure: { kind: 'res', status: 500 } })
    expect(calls()).toEqual(['/api/restructure'])              // 【reach 校验】压根没走到建语料
    expect(r.navigated).toEqual([`/restructure?h=H(${OK_TEXT})&mode=text`])
    expect(aiEvents()).toEqual([{ stage: 'restructure', mode: 'text', result: 'server_5xx', httpStatus: 500, latencyMs: '<num>' }])
    expect(submittedEvents()).toHaveLength(1)
    expect(submittedEvents()[0].outcome).toBe('proceed')
    expect(trace).toContainEqual(['clearFlowShape'])           // 这条路真经过整理页 → 抹掉标识、降级回 5 步
  })

  it('网络整个挂掉：同样回落整理页，ai_call 记 network', async () => {
    const r = await run({ restructure: { kind: 'throw' } })
    expect(r.navigated).toEqual([`/restructure?h=H(${OK_TEXT})&mode=text`])
    expect(aiEvents()).toEqual([{ stage: 'restructure', mode: 'text', result: 'network', httpStatus: 0, latencyMs: '<num>' }])
    expect(submittedEvents()).toHaveLength(1)
  })

  it('雅思流回落时 qid 不能丢（丢了用户就从雅思流掉回故事流）', async () => {
    const r = await run({ qid: 'q-9', restructure: { kind: 'res', status: 500 } })
    expect(r.navigated).toEqual([`/restructure?h=H(${OK_TEXT})&mode=text&qid=q-9`])
  })

  it('建语料失败：回落整理页并【带着整理结果】（用户的整理稿不能白跑一次 AI）', async () => {
    const r = await run({ corpus: { kind: 'res', status: 500 } })
    expect(calls()).toEqual(['/api/restructure', '/api/corpus'])
    expect(r.navigated).toEqual([
      `/restructure?h=J(${JSON.stringify({ rawText: OK_TEXT, cleanedText: CLEANED, summary: SUMMARY })})&mode=text`,
    ])
    expect(submittedEvents()).toHaveLength(1)
  })

  it('建语料返回 200 但响应体没有 id：当失败处理，回落整理页（绝不拿空 id 跳去匹配页）', async () => {
    const r = await run({ corpus: { kind: 'res', status: 200, body: { corpus: {} } } })
    expect(r.navigated).toHaveLength(1)
    expect(r.navigated[0]).toContain('/restructure?h=J(')
  })
})

describe('要害 3 · 雅思流的自动绑定不能丢（台账 179）', () => {
  it('落库后调 bindIeltsCorpus(qid, storyId)，再跳 /analysis（from=restructure 保持原样）', async () => {
    const r = await run({ qid: 'q-7' })
    expect(trace).toContainEqual(['bindIeltsCorpus', 'q-7', 'corpus-1'])
    expect(r.navigated).toEqual(['/analysis?questionId=q-7&storyId=corpus-1&from=restructure'])
    expect(trace).toContainEqual(['setFlowShape', { mode: 'text', flow: 'ielts' }])
  })

  it('绑定发生在跳转之前（跳过去的分析页会用到这条配对）', async () => {
    await run({ qid: 'q-7' })
    const iBind = trace.findIndex((t) => Array.isArray(t) && t[0] === 'bindIeltsCorpus')
    const iNav = trace.findIndex((t) => Array.isArray(t) && t[0] === 'navigate')
    expect(iBind).toBeGreaterThanOrEqual(0)
    expect(iNav).toBeGreaterThan(iBind)
  })

  it('故事流【不做】自动绑定（那是雅思流独有的语义）', async () => {
    await run({})
    expect(trace.some((t) => Array.isArray(t) && t[0] === 'bindIeltsCorpus')).toBe(false)
  })
})

describe('要害 4 · 额度 / 同意 / 打回三类结局', () => {
  it('整理 402（匿名整理额度用尽）：不建语料、不跳转，弹 trial', async () => {
    const r = await run({ restructure: { kind: 'res', status: 402 } })
    expect(calls()).toEqual(['/api/restructure'])
    expect(r.navigated).toEqual([])
    expect(r.quota).toEqual(['trial'])
    expect(submittedEvents()[0].outcome).toBe('quota_blocked')
  })

  it('建语料 402 且 reason=story：弹 story 变体，绝不对注册用户说「试用已完成，请注册」', async () => {
    const r = await run({ corpus: { kind: 'res', status: 402, body: { reason: 'story' } } })
    expect(r.quota).toEqual(['story'])
    expect(r.navigated).toEqual([])
    expect(submittedEvents()[0].outcome).toBe('quota_blocked')
  })

  it('建语料 402 且 reason=trial：弹 trial 变体', async () => {
    const r = await run({ corpus: { kind: 'res', status: 402, body: { reason: 'trial' } } })
    expect(r.quota).toEqual(['trial'])
  })

  it('建语料 403（未捕获同意）：回首页触发同意弹窗，结局记 consent_blocked', async () => {
    const r = await run({ corpus: { kind: 'res', status: 403 } })
    expect(r.navigated).toEqual(['/'])
    expect(submittedEvents()[0].outcome).toBe('consent_blocked')
  })

  it('整理判 usable=false：toast 打回重写，不建语料、不跳转', async () => {
    const r = await run({ restructure: { kind: 'res', status: 200, body: { cleanedText: CLEANED, usable: false } } })
    expect(calls()).toEqual(['/api/restructure'])
    expect(r.navigated).toEqual([])
    expect(r.toasts).toHaveLength(1)
    expect(submittedEvents()[0].outcome).toBe('garbage')
  })
})

describe('预检早退 · 一个请求都不许发', () => {
  it('极短、不像一段经历：不发请求、不换 flow_id', async () => {
    const r = await run({ text: 'ok' })
    expect(calls()).toEqual([])
    expect(trace).not.toContainEqual(['newFlowId'])
    expect(submittedEvents()[0].outcome).toBe('garbage')
    expect(r.navigated).toEqual([])
  })

  it('有效字数不足：不发请求，结局 text_too_short', async () => {
    const r = await run({ text: '今天去了公园。' })
    expect(calls()).toEqual([])
    expect(submittedEvents()[0].outcome).toBe('text_too_short')
    expect(r.navigated).toEqual([])
  })
})

describe('埋点不变式 · 每条路径恰好一条 capture_submitted', () => {
  const scenarios: [string, Scenario][] = [
    ['整理成功·故事流', {}],
    ['整理成功·雅思流', { qid: 'q-1' }],
    ['整理 500', { restructure: { kind: 'res', status: 500 } }],
    ['整理 402', { restructure: { kind: 'res', status: 402 } }],
    ['整理 403', { restructure: { kind: 'res', status: 403 } }],
    ['整理 usable=false', { restructure: { kind: 'res', status: 200, body: { cleanedText: CLEANED, usable: false } } }],
    ['网络挂掉', { restructure: { kind: 'throw' } }],
    ['建语料 500', { corpus: { kind: 'res', status: 500 } }],
    ['建语料 402', { corpus: { kind: 'res', status: 402, body: { reason: 'story' } } }],
    ['建语料 403', { corpus: { kind: 'res', status: 403 } }],
    ['建语料网络挂掉', { corpus: { kind: 'throw' } }],
    ['不像经历·预检', { text: 'ok' }],
    ['太短预检', { text: '今天去了公园。' }],
  ]
  it.each(scenarios)('%s：恰好一条，且 onOutcome 与埋点同值', async (_name, sc) => {
    const r = await run(sc)
    expect(submittedEvents()).toHaveLength(1)
    expect(r.outcomes).toEqual([submittedEvents()[0].outcome])
  })

  it.each(scenarios)('%s：至多一条 restructure 阶段的 ai_call', async (_name, sc) => {
    await run(sc)
    expect(aiEvents().length).toBeLessThanOrEqual(1)
  })

  it.each(scenarios)('%s：submitting 最终必回落 false（按钮不许卡在转圈）', async (_name, sc) => {
    const r = await run(sc)
    if (r.submitting.length > 0) expect(r.submitting[r.submitting.length - 1]).toBe(false)
  })
})
