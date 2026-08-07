/**
 * @module   api/usage-qa-flag.test
 * @desc     成本记账 QA 标记守卫（迁移 0059）—— 钉死「每条 api_usage_logs 都带对 is_qa」。
 *           病根：产品方用无痕模式自测，每次都是一个全新的匿名 user_id，进不了 isInternalAccount 名册，
 *           成本数字里因此永远掺着一份【不可知】的自测流量。本套守的是补上这条标记之后的三件事：
 *             ① 带对 QA 头 → is_qa=true（成功路径与【失败路径】都要，失败也烧钱：ASR 调失败照样计费）；
 *             ② 不带头的普通用户 → false（绝不能把真实用户的成本当自测剔掉）；
 *             ③ 服务端未配 QA_TRAFFIC_TOKEN → 任何头都判 false（fail-closed，见 0053 顶注红线：
 *               这里若写成 ''==='' 判真，全站成本会被整段标成自测、看板归零）；
 *           另守内部账户（服务端权威、不可伪造）不带头也算 QA。
 *           判定唯一入口是 isQaRequest（不 mock 它，正是要测 route 有没有把它接对）；
 *           其余依赖全 mock，不碰真实 DB / 模型 / 鉴权。
 *
 *   ⚠️ is_qa 可伪造，只写统计列，永不参与额度/权限/计费判定——本文件也不该出现任何这类断言。
 * @author   LingoBridge
 * @created  2026-08-08
 */
jest.mock('server-only', () => ({}))

// env-server 只在 qa-traffic 这一条链路上被用到（读 QA_TRAFFIC_TOKEN）：整体 mock 掉，
// 让每个用例自己决定「服务端配没配 token」——这正是 fail-closed 那条要测的开关。
jest.mock('@/lib/env-server', () => ({ env: { qaTrafficToken: '' } }))

// —— 服务层全 mock：只验记账入参，不跑真实模型 ——
jest.mock('@/services/analysis', () => ({
  generateAnalysis: jest.fn(),
  generatePhrases: jest.fn(),
}))
jest.mock('@/services/practice', () => ({
  buildScaffold: jest.fn(),
  coachReply: jest.fn(),
  polishSentence: jest.fn(),
}))
jest.mock('@/services/restructure', () => ({ restructureText: jest.fn() }))
jest.mock('@/services/transcription', () => ({ transcribeAudio: jest.fn() }))
jest.mock('@/services/pronounce', () => ({ generatePronunciationTip: jest.fn() }))

// —— 记账 / 鉴权 / DB / 上下文 全 mock（与 usage-logging.test 同款，保持两套守卫的桩一致）——
jest.mock('@/lib/api-logger', () => ({
  logApiUsage: jest.fn(),
  qwenPlusCostCny: jest.fn(() => 0.001),
  API_PRICING: { qwen_flash_per_1k_tokens: 0.0008, doubao_asr_per_second: 0.003, qwen_plus_input_per_1m: 0.8, qwen_plus_output_per_1m: 2.0 },
}))
jest.mock('@/lib/api-auth', () => ({
  requireUser: jest.fn(),
  requireUserAllowAnon: jest.fn(),
  assertCorpusOwner: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/consent-server', () => ({
  requireConsent: jest.fn(() => Promise.resolve(null)),
  hasRecordedConsent: jest.fn(() => Promise.resolve(true)),
}))
jest.mock('@/lib/db/questions', () => ({ getQuestionById: jest.fn() }))
jest.mock('@/lib/db/corpus-server', () => ({
  getCorpusByIdServer: jest.fn(),
  getCorpusPrimaryPointCodeServer: jest.fn(() => Promise.resolve(null)),
  bumpDailyUsageServer: jest.fn(),
  readDailyUsageServer: jest.fn(() => Promise.resolve(0)),
  readLifetimeUsageServer: jest.fn(() => Promise.resolve(0)),
  bumpAnonRestructureTodayServer: jest.fn(),
}))
jest.mock('@/lib/db/question-analyses', () => ({
  getPersonalAnalysis: jest.fn(() => Promise.resolve(null)),
  upsertPersonalAnalysis: jest.fn(),
}))
jest.mock('@/lib/db/practice-sessions-server', () => ({ countReviewPracticeThisMonthServer: jest.fn() }))
jest.mock('@/lib/db/practice-sessions', () => ({ IELTS_MONTHLY_LIMIT: 100 }))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_ctx: unknown, fn: () => unknown) => fn() }))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/audio/transcode', () => ({ transcodeToWav: jest.fn() }))

import { POST as analysisPost } from '@/app/api/analysis/route'
import { POST as phrasesPost } from '@/app/api/analysis/phrases/route'
import { POST as practicePost } from '@/app/api/practice/route'
import { POST as restructurePost } from '@/app/api/restructure/route'
import { POST as transcribePost } from '@/app/api/transcribe/route'
import { POST as pronouncePost } from '@/app/api/pronounce/route'
import { POST as polishPost } from '@/app/api/practice/polish/route'

import { env } from '@/lib/env-server'
import { generateAnalysis, generatePhrases } from '@/services/analysis'
import { buildScaffold, coachReply, polishSentence } from '@/services/practice'
import { restructureText } from '@/services/restructure'
import { transcribeAudio } from '@/services/transcription'
import { generatePronunciationTip } from '@/services/pronounce'
import { logApiUsage } from '@/lib/api-logger'
import { requireUserAllowAnon } from '@/lib/api-auth'
import { getQuestionById } from '@/lib/db/questions'
import { getCorpusByIdServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { transcodeToWav } from '@/lib/audio/transcode'
import { INTERNAL_ACCOUNT_IDS } from '@/lib/internal-accounts'

const mockLogApiUsage = logApiUsage as jest.MockedFunction<typeof logApiUsage>
const mockRequireAnon = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>
const mockGetQuestion = getQuestionById as jest.MockedFunction<typeof getQuestionById>
const mockGetCorpus = getCorpusByIdServer as jest.MockedFunction<typeof getCorpusByIdServer>
const mockBumpDaily = bumpDailyUsageServer as jest.MockedFunction<typeof bumpDailyUsageServer>
const mockTranscode = transcodeToWav as jest.MockedFunction<typeof transcodeToWav>

/** 服务端配置的 QA token（用例里按需改 env.qaTrafficToken 模拟「没配」） */
const TOKEN = 's3cret-token'

/** 造一份最小合法题目（各 route 会读到的字段） */
function makeQuestion() {
  return {
    id: 'q1', part: 1 as const, topic: 't', question_text: 'What do you do to relax?',
    question_text_zh: '你如何放松？', cue_card_title: null, cue_card_title_zh: null,
    is_new: false, topic_only: false, parent_card_id: null, created_at: '2026-01-01T00:00:00Z',
    observation_points: ['EMO_04'], season: '2026-05',
  }
}

/** 带（或不带）QA 头的 JSON POST 请求 */
function jsonReq(url: string, body: unknown, qaHeader?: string): Request {
  const headers: Record<string, string> = { authorization: 'Bearer t', 'content-type': 'application/json' }
  if (qaHeader !== undefined) headers['x-qa-traffic'] = qaHeader
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) })
}

/**
 * transcribe 专用请求：路由只用到 formData() 与 headers，故给一个最小对象。
 * ⚠️ headers 必须给真 Headers —— isQaRequest 要读 x-qa-traffic，缺了会在记账那行抛 TypeError。
 */
function transcribeReq(qaHeader?: string): Request {
  const fd = new FormData()
  fd.append('audio', new Blob([new Uint8Array(1000)], { type: 'audio/webm' }))
  const h = new Headers(qaHeader === undefined ? {} : { 'x-qa-traffic': qaHeader })
  return { formData: async () => fd, headers: h } as unknown as Request
}

/** 本次所有记账入参 */
function calls(): Array<{ status: string; is_qa?: boolean }> {
  return mockLogApiUsage.mock.calls.map(c => c[0]) as never
}

/** 本次唯一一条成功记账的 is_qa（多条时要求取值一致，避免「一条对一条错」蒙混过关） */
function successIsQa(): boolean | undefined {
  const ok = calls().filter(c => c.status === 'success')
  if (ok.length === 0) throw new Error('未记到 status=success 的账')
  const vals = new Set(ok.map(c => c.is_qa))
  if (vals.size > 1) throw new Error(`同一次请求的多条成功记账 is_qa 不一致：${JSON.stringify([...vals])}`)
  return ok[0].is_qa
}

/** 本次唯一一条失败记账的 is_qa */
function errorIsQa(): boolean | undefined {
  const err = calls().find(c => c.status === 'error')
  if (!err) throw new Error('未记到 status=error 的失败账')
  return err.is_qa
}

beforeEach(() => {
  jest.clearAllMocks()
  env.qaTrafficToken = TOKEN
  mockRequireAnon.mockResolvedValue({ userId: 'u1', isAnonymous: false } as never)
  mockLogApiUsage.mockResolvedValue(undefined)
  mockGetQuestion.mockResolvedValue(makeQuestion() as never)
  mockGetCorpus.mockResolvedValue(null)
  mockBumpDaily.mockResolvedValue(1)
  ;(generateAnalysis as jest.Mock).mockResolvedValue({ structureLabel: 's', focusPoints: [], phrases: [] })
  ;(generatePhrases as jest.Mock).mockResolvedValue([{ label: 'g', items: [] }])
  ;(buildScaffold as jest.Mock).mockResolvedValue({
    part: 1, questionForAI: 'q', displayEn: 'q', displayZh: 'q', focusPoints: [], part3Questions: [], level: '6.0',
  })
  ;(coachReply as jest.Mock).mockResolvedValue('Hi there, shall we start?')
  ;(restructureText as jest.Mock).mockResolvedValue({ cleanedText: '整理后的文字', usable: true })
  ;(transcribeAudio as jest.Mock).mockResolvedValue('转写文字')
  ;(generatePronunciationTip as jest.Mock).mockResolvedValue({ ipaIntended: '/a/', ipaHeard: '/b/', tip: '提示' })
  ;(polishSentence as jest.Mock).mockResolvedValue({ needsWork: false, optimized: '', note: '' })
  mockTranscode.mockResolvedValue(Buffer.alloc(44 + 32000))
})

// ── 每个路由「成功路径」的一次调用：分别在带头 / 不带头两种请求下跑 ────────────────────
// 一条数据驱动表覆盖全部路由：新增 AI 路由时把它加进来，漏了 is_qa 这里立刻红。
// （matching / analysis 流式路的 is_qa 取值同样来自 isQaRequest，另见各自 route.test 的 QA 用例。）
const ROUTES: Array<{ name: string; run: (qa?: string) => Promise<Response> }> = [
  {
    name: 'analysis（?stream=0 阻塞路）',
    run: (qa) => analysisPost(jsonReq('http://localhost/api/analysis?stream=0', { questionId: 'q1' }, qa)),
  },
  {
    name: 'analysis/phrases',
    run: (qa) => phrasesPost(jsonReq('http://localhost/api/analysis/phrases', { questionId: 'q1' }, qa)),
  },
  {
    name: 'practice（首轮：analysis + coach 两条账）',
    run: (qa) => practicePost(jsonReq('http://localhost/api/practice', { questionId: 'q1' }, qa)),
  },
  {
    name: 'restructure',
    run: (qa) => restructurePost(jsonReq('http://localhost/api/restructure',
      { rawText: '呃我周末就是一个人去公园散步，走了很久，看到很多人在放风筝，我坐在长椅上晒太阳，心里觉得特别放松' }, qa)),
  },
  {
    name: 'pronounce',
    run: (qa) => pronouncePost(jsonReq('http://localhost/api/pronounce', { intended: 'work', heard: 'walk' }, qa)),
  },
  {
    name: 'practice/polish',
    run: (qa) => polishPost(jsonReq('http://localhost/api/practice/polish', { sentence: 'I very like coffee' }, qa)),
  },
  {
    name: 'transcribe',
    run: (qa) => transcribePost(transcribeReq(qa)),
  },
]

describe('成本记账 QA 标记 · 成功路径', () => {
  test.each(ROUTES)('$name：带对 QA 头 → is_qa=true', async ({ run }) => {
    const res = await run(TOKEN)
    expect(res.status).toBe(200)
    expect(successIsQa()).toBe(true)
  })

  test.each(ROUTES)('$name：普通用户不带头 → is_qa=false（绝不误剔真实成本）', async ({ run }) => {
    const res = await run()
    expect(res.status).toBe(200)
    expect(successIsQa()).toBe(false)
  })

  test.each(ROUTES)('$name：服务端未配 token → 头再对也判 false（fail-closed）', async ({ run }) => {
    env.qaTrafficToken = ''
    const res = await run(TOKEN)
    expect(res.status).toBe(200)
    expect(successIsQa()).toBe(false)
  })

  // ⚠️ 这条是 fail-closed 真正的支点：未配 token 时请求头【为空串】。
  // 变异验证发现「未配 token + 头带着真 token」那条杀不掉 `configured !== ''` 守卫
  //（'s3cret-token' === '' 本来就假），只有空串/缺头这一侧才会因 ''==='' 判真而全站被标 QA。
  test.each(ROUTES)('$name：未配 token 且请求头为空串 → false（绝不能 \'\'===\'\' 判真）', async ({ run }) => {
    env.qaTrafficToken = ''
    const res = await run('')
    expect(res.status).toBe(200)
    expect(successIsQa()).toBe(false)
  })

  test.each(ROUTES)('$name：头不全等（大小写/多字符）→ false', async ({ run }) => {
    const res = await run('S3CRET-TOKEN')
    expect(res.status).toBe(200)
    expect(successIsQa()).toBe(false)
  })

  test.each(ROUTES)('$name：内部账户不带头 → true（服务端权威来源，不可伪造）', async ({ run }) => {
    const internalId = Array.from(INTERNAL_ACCOUNT_IDS)[0]
    mockRequireAnon.mockResolvedValue({ userId: internalId, isAnonymous: false } as never)
    const res = await run()
    expect(res.status).toBe(200)
    expect(successIsQa()).toBe(true)
  })
})

// ── 失败路径：失败也烧钱（ASR 调失败照样计费），漏了失败行等于自测的失败成本仍混在里面 ──
const FAILING: Array<{ name: string; run: (qa?: string) => Promise<Response>; arm: () => void }> = [
  {
    name: 'analysis（?stream=0）',
    arm: () => { (generateAnalysis as jest.Mock).mockRejectedValueOnce(new Error('模型超时')) },
    run: (qa) => analysisPost(jsonReq('http://localhost/api/analysis?stream=0', { questionId: 'q1' }, qa)),
  },
  {
    name: 'analysis/phrases',
    arm: () => { (generatePhrases as jest.Mock).mockRejectedValueOnce(new Error('模型超时')) },
    run: (qa) => phrasesPost(jsonReq('http://localhost/api/analysis/phrases', { questionId: 'q1' }, qa)),
  },
  {
    name: 'practice',
    arm: () => { (coachReply as jest.Mock).mockRejectedValueOnce(new Error('模型超时')) },
    run: (qa) => practicePost(jsonReq('http://localhost/api/practice', { questionId: 'q1' }, qa)),
  },
  {
    name: 'restructure',
    arm: () => { (restructureText as jest.Mock).mockRejectedValueOnce(new Error('模型超时')) },
    run: (qa) => restructurePost(jsonReq('http://localhost/api/restructure',
      { rawText: '呃我周末就是一个人去公园散步，走了很久，看到很多人在放风筝，我坐在长椅上晒太阳，心里觉得特别放松' }, qa)),
  },
  {
    name: 'pronounce',
    arm: () => { (generatePronunciationTip as jest.Mock).mockRejectedValueOnce(new Error('模型超时')) },
    run: (qa) => pronouncePost(jsonReq('http://localhost/api/pronounce', { intended: 'work', heard: 'walk' }, qa)),
  },
  {
    name: 'practice/polish',
    arm: () => { (polishSentence as jest.Mock).mockRejectedValueOnce(new Error('模型超时')) },
    run: (qa) => polishPost(jsonReq('http://localhost/api/practice/polish', { sentence: 'I very like coffee' }, qa)),
  },
  {
    name: 'transcribe',
    arm: () => { (transcribeAudio as jest.Mock).mockRejectedValueOnce(new Error('豆包挂了')) },
    run: (qa) => transcribePost(transcribeReq(qa)),
  },
]

describe('成本记账 QA 标记 · 失败路径（失败也烧钱，同样要标）', () => {
  test.each(FAILING)('$name 失败：带对 QA 头 → 失败行 is_qa=true', async ({ arm, run }) => {
    arm()
    await run(TOKEN)
    expect(errorIsQa()).toBe(true)
  })

  test.each(FAILING)('$name 失败：不带头 → 失败行 is_qa=false', async ({ arm, run }) => {
    arm()
    await run()
    expect(errorIsQa()).toBe(false)
  })
})

// ── 三个路由的失败行归属（本轮一并补齐；此前 user_id/is_anonymous 完全没写）────────────
describe('失败记账归属守卫 · analysis / phrases 的失败行带 user_id + is_anonymous', () => {
  /** 取本次唯一一条失败记账 */
  function errorCall(): { user_id?: string; is_anonymous?: boolean } {
    const err = calls().find(c => c.status === 'error') as { user_id?: string; is_anonymous?: boolean } | undefined
    if (!err) throw new Error('未记到 status=error 的失败账')
    return err
  }

  test('analysis 失败 → user_id + is_anonymous 落到失败行（否则进不了「按用户成本」）', async () => {
    ;(generateAnalysis as jest.Mock).mockRejectedValueOnce(new Error('模型超时'))
    await analysisPost(jsonReq('http://localhost/api/analysis?stream=0', { questionId: 'q1' }))
    expect(errorCall()).toMatchObject({ user_id: 'u1', is_anonymous: false })
  })

  test('analysis/phrases 失败 → 同上', async () => {
    ;(generatePhrases as jest.Mock).mockRejectedValueOnce(new Error('模型超时'))
    await phrasesPost(jsonReq('http://localhost/api/analysis/phrases', { questionId: 'q1' }))
    expect(errorCall()).toMatchObject({ user_id: 'u1', is_anonymous: false })
  })

  test('鉴权就失败（拿不到身份）→ 不硬塞 user_id，但仍按请求头判 QA', async () => {
    mockRequireAnon.mockRejectedValueOnce(new Error('unauthorized'))
    await phrasesPost(jsonReq('http://localhost/api/analysis/phrases', { questionId: 'q1' }, TOKEN))
    const err = calls().find(c => c.status === 'error') as { user_id?: string; is_qa?: boolean }
    expect(err.user_id).toBeUndefined()
    expect(err.is_qa).toBe(true)
  })
})
