/**
 * @module   api/global-budget-breaker-routes.test
 * @desc     全局预算熔断在【每一条花钱路由】上的接线守卫（8 条路由 × 10 个入口，含 analysis / matching
 *           各自的流式与降级两路）。只 mock「问 DB 拿今日花费」这一层，熔断判定与路由代码全部跑真的。
 *
 *   逐条标注守的是【行为】还是【结构】：
 *     ①【行为】今日花费未触线 → 匿名放行过熔断（此时被拦下的是该路由自己的账号额度闸，
 *        判据是 402 的 reason 不是 global_budget —— 若熔断误拦，这条会变红）。
 *     ②【行为】触线 → 匿名 402 + reason=global_budget，**且花钱的那一步一次都没被调用**
 *        （这是核心：拦下来不算数，钱没花出去才算），**且没有计次**（没花钱就不该扣人额度）。
 *     ③【行为】触线时注册用户照常放行 —— 判据是它一路走到了自己的每日熔断上限拿到 429，
 *        而不是熔断的 402（防误伤，这条最重要）。
 *     ④【行为】今日花费读不到 → 匿名按放行处理（失败开放，理由见 global-budget-breaker 顶注）。
 *
 *   ⚠️「is_qa 自测流量与内部账户不计入总花费」这一条不在本文件：它整条实现在 SQL 侧（迁移 0063），
 *      由 lib/db/__tests__/ai-cost-server.test.ts（名册确实被传下去）+ 迁移自带的事务级守卫
 *      + 本机真 PG 实例上的实跑共同覆盖，见交付说明。
 * @author   LingoBridge
 * @created  2026-08-12
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))

// —— 唯一真正被操控的一层：今日全站花费读数 ——
jest.mock('@/lib/db/ai-cost-server', () => ({ readTodayAiCostCny: jest.fn() }))

// —— 鉴权 / 同意：一律放行，把舞台让给熔断 ——
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(),
  assertCorpusOwner:    jest.fn(() => Promise.resolve()),
  authErrorResponse:    jest.fn(() => null),
}))
jest.mock('@/lib/consent-server', () => ({
  requireConsent:      jest.fn(() => Promise.resolve(null)),
  hasRecordedConsent:  jest.fn(() => Promise.resolve(true)),
}))

// —— 计次 / 记账 / 留证：全部替身，用于断言「没花钱、也没扣次数」——
jest.mock('@/lib/db/corpus-server', () => ({
  bumpDailyUsageServer:          jest.fn(),
  readDailyUsageServer:          jest.fn(() => Promise.resolve(0)),
  readLifetimeUsageServer:       jest.fn(() => Promise.resolve(0)),
  bumpAnonRestructureTodayServer: jest.fn(),
  getCorpusByIdServer:           jest.fn(() => Promise.resolve('这是一段足够长的整理后故事正文，用于让匹配路由走到熔断那一步。')),
  getCorpusPrimaryPointCodeServer: jest.fn(() => Promise.resolve(null)),
}))
jest.mock('@/lib/api-logger', () => ({
  logApiUsage:      jest.fn(() => Promise.resolve()),
  qwenPlusCostCny:  jest.fn(() => 0),
  API_PRICING:      { doubao_asr_per_second: 0.003, qwen_flash_per_1k_tokens: 0.0008 },
}))
jest.mock('@/lib/qa-traffic', () => ({ isQaRequest: jest.fn(() => false) }))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_c: unknown, fn: () => unknown) => fn() }))
jest.mock('@/lib/events', () => ({ logEvent: jest.fn(() => Promise.resolve()) }))

// —— 花钱的那一步：全部替身，断言「一次都没被调用」——
jest.mock('@/services/transcription', () => ({ transcribeAudio: jest.fn() }))
jest.mock('@/services/restructure',   () => ({ restructureText: jest.fn() }))
jest.mock('@/services/matching',      () => ({ matchByStory: jest.fn() }))
jest.mock('@/services/analysis',      () => ({ generateAnalysis: jest.fn(), generateAnalysisStreaming: jest.fn(), generatePhrases: jest.fn() }))
jest.mock('@/services/practice',      () => ({ buildScaffold: jest.fn(), coachReply: jest.fn(), polishSentence: jest.fn() }))
jest.mock('@/services/pronounce',     () => ({ generatePronunciationTip: jest.fn() }))
jest.mock('@/lib/audio/transcode',    () => ({ transcodeToWav: jest.fn() }))

// —— 其余只为让 import 与前置读取跑得通的替身 ——
jest.mock('@/lib/env-server', () => ({ env: {
  matchSnapshotEnabled: false,
  matchingAlgoRaw: 'mapping',
  ankiDrainSecret: '',
  qaTrafficToken: '',
} }))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))
jest.mock('@/lib/db/match-snapshots', () => ({ getMatchSnapshotServer: jest.fn(() => Promise.resolve(null)), upsertMatchSnapshotServer: jest.fn() }))
jest.mock('@/lib/db/anki-cards-server', () => ({ getBoundQuestionIds: jest.fn(() => Promise.resolve([])) }))
jest.mock('@/lib/db/questions', () => ({ getQuestionById: jest.fn(() => Promise.resolve(null)) }))
jest.mock('@/lib/db/practice-sessions-server', () => ({ countReviewPracticeThisMonthServer: jest.fn(() => Promise.resolve(0)) }))

import { readTodayAiCostCny } from '@/lib/db/ai-cost-server'
import { requireUserAllowAnon } from '@/lib/api-auth'
import { bumpDailyUsageServer, bumpAnonRestructureTodayServer, readDailyUsageServer } from '@/lib/db/corpus-server'
import { transcribeAudio } from '@/services/transcription'
import { transcodeToWav } from '@/lib/audio/transcode'
import { restructureText } from '@/services/restructure'
import { matchByStory } from '@/services/matching'
import { generateAnalysis, generateAnalysisStreaming, generatePhrases } from '@/services/analysis'
import { buildScaffold, coachReply, polishSentence } from '@/services/practice'
import { generatePronunciationTip } from '@/services/pronounce'
import { GLOBAL_DAILY_BUDGET_BREAKER_CNY } from '@/lib/constants'

import { POST as transcribePOST } from '@/app/api/transcribe/route'
import { POST as restructurePOST } from '@/app/api/restructure/route'
import { POST as practicePOST } from '@/app/api/practice/route'
import { POST as polishPOST } from '@/app/api/practice/polish/route'
import { POST as pronouncePOST } from '@/app/api/pronounce/route'
import { POST as analysisPOST } from '@/app/api/analysis/route'
import { POST as phrasesPOST } from '@/app/api/analysis/phrases/route'
import { POST as matchingPOST } from '@/app/api/matching/route'

const mockRead = readTodayAiCostCny as jest.MockedFunction<typeof readTodayAiCostCny>
const mockUser = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>
const mockBump = bumpDailyUsageServer as jest.MockedFunction<typeof bumpDailyUsageServer>
const mockBumpRestructure = bumpAnonRestructureTodayServer as jest.MockedFunction<typeof bumpAnonRestructureTodayServer>
const mockReadDaily = readDailyUsageServer as jest.MockedFunction<typeof readDailyUsageServer>

const OVER  = GLOBAL_DAILY_BUDGET_BREAKER_CNY
const UNDER = 0.5

/** 一条 AI 出口的测试描述：怎么造请求、哪些是「花钱的那一步」、哪些是「计次的那一步」。 */
interface RouteCase {
  name: string
  call: () => Promise<Response>
  /** 花钱的那一步（被熔断拦下时必须一次都没被调用） */
  spend: jest.Mock[]
  /** 计次的那一步（被熔断拦下时也不该被调用——没花钱就不该扣人额度） */
  count: jest.Mock[]
}

const jsonReq = (url: string, body: unknown): Request =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

/** transcribe 走 multipart，单独造。 */
function audioReq(): Request {
  const form = new FormData()
  form.append('audio', new Blob([new Uint8Array(2048)], { type: 'audio/webm' }), 'a.webm')
  return new Request('http://localhost/api/transcribe', { method: 'POST', body: form })
}

const CASES: RouteCase[] = [
  {
    name: 'transcribe（豆包 ASR，匿名成本 94~97% 的大头）',
    call: () => transcribePOST(audioReq()),
    spend: [transcribeAudio as jest.Mock, transcodeToWav as jest.Mock],
    count: [mockBump as unknown as jest.Mock, mockReadDaily as unknown as jest.Mock],
  },
  {
    name: 'restructure（语料整理 qwen-flash）',
    call: () => restructurePOST(jsonReq('http://localhost/api/restructure', {
      rawText: '今天我去了一趟很远的地方，路上遇到了一些有意思的事情，回来以后一直想着这件事没有停下来。',
    })),
    spend: [restructureText as jest.Mock],
    count: [mockBumpRestructure as unknown as jest.Mock, mockBump as unknown as jest.Mock],
  },
  {
    name: 'matching · 流式（萃取 + 重排两次 qwen-plus，全站最贵一跳）',
    call: () => matchingPOST(jsonReq('http://localhost/api/matching', { corpusId: 'c-1' })),
    spend: [matchByStory as jest.Mock],
    count: [mockBump as unknown as jest.Mock],
  },
  {
    name: 'matching · 降级 ?stream=0',
    call: () => matchingPOST(jsonReq('http://localhost/api/matching?stream=0', { corpusId: 'c-1' })),
    spend: [matchByStory as jest.Mock],
    count: [mockBump as unknown as jest.Mock],
  },
  {
    name: 'analysis · 流式（侧重点分析）',
    call: () => analysisPOST(jsonReq('http://localhost/api/analysis', { questionId: 'q-1' })),
    spend: [generateAnalysis as jest.Mock, generateAnalysisStreaming as jest.Mock],
    count: [mockBump as unknown as jest.Mock],
  },
  {
    name: 'analysis · 降级 ?stream=0',
    call: () => analysisPOST(jsonReq('http://localhost/api/analysis?stream=0', { questionId: 'q-1' })),
    spend: [generateAnalysis as jest.Mock, generateAnalysisStreaming as jest.Mock],
    count: [mockBump as unknown as jest.Mock],
  },
  {
    name: 'analysis/phrases（换词组）',
    call: () => phrasesPOST(jsonReq('http://localhost/api/analysis/phrases', { questionId: 'q-1' })),
    spend: [generatePhrases as jest.Mock],
    count: [mockBump as unknown as jest.Mock],
  },
  {
    name: 'practice（教练对话）',
    call: () => practicePOST(jsonReq('http://localhost/api/practice', { questionId: 'q-1', messages: [] })),
    spend: [buildScaffold as jest.Mock, coachReply as jest.Mock],
    count: [mockBump as unknown as jest.Mock],
  },
  {
    name: 'practice/polish（单句润色）',
    call: () => polishPOST(jsonReq('http://localhost/api/practice/polish', { sentence: 'I go to school yesterday.' })),
    spend: [polishSentence as jest.Mock],
    count: [mockBump as unknown as jest.Mock],
  },
  {
    name: 'pronounce（发音提示）',
    call: () => pronouncePOST(jsonReq('http://localhost/api/pronounce', { intended: 'thought', heard: 'taught' })),
    spend: [generatePronunciationTip as jest.Mock],
    count: [mockBump as unknown as jest.Mock],
  },
]

// 熔断持有进程内缓存（跨用例同一份实例）。让每个用例活在**不同的一天**，日键不同即整条作废，
// 缓存天然不会串味 —— 顺带也证明了「跨日不复用」这条不变式在真实路由上同样成立。
// 路由是在文件顶部 import 的，重置模块拿不到同一份实例，故走系统时钟而不是重置模块。
let dayCursor = 0
beforeEach(() => {
  jest.clearAllMocks()
  dayCursor += 1
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] })
  jest.setSystemTime(new Date(Date.UTC(2026, 0, dayCursor, 6, 0, 0)))
})

afterEach(() => {
  jest.useRealTimers()
})

describe.each(CASES)('全局预算熔断接线 · $name', (c) => {
  it('① 未触线：熔断放行（拦下它的是该路由自己的账号额度闸，不是熔断）', async () => {
    mockRead.mockResolvedValue(UNDER)
    mockUser.mockResolvedValue({ userId: 'anon-1', isAnonymous: true })
    // 把账号额度闸顶满，让路由必然在下一道闸早退 —— 于是「谁拦的」这件事可判别
    mockBump.mockResolvedValue(999_999)
    mockBumpRestructure.mockResolvedValue(999_999)
    mockReadDaily.mockResolvedValue(999_999)

    const res = await c.call()
    expect(res.status).toBe(402)
    const body = (await res.json()) as { reason?: string }
    expect(body.reason).not.toBe('global_budget')
  })

  it('② 触线：匿名 402 + reason=global_budget，且花钱与计次两步都零调用', async () => {
    mockRead.mockResolvedValue(OVER)
    mockUser.mockResolvedValue({ userId: 'anon-1', isAnonymous: true })
    mockBump.mockResolvedValue(1)
    mockBumpRestructure.mockResolvedValue(1)
    mockReadDaily.mockResolvedValue(0)

    const res = await c.call()
    expect(res.status).toBe(402)
    const body = (await res.json()) as { code?: string; reason?: string }
    expect(body.code).toBe('QUOTA_EXCEEDED')
    expect(body.reason).toBe('global_budget')
    // 核心：钱没花出去
    for (const spy of c.spend) expect(spy).not.toHaveBeenCalled()
    // 没花钱就不该扣人额度
    for (const spy of c.count) expect(spy).not.toHaveBeenCalled()
  })

  it('③ 触线时注册用户照常放行（一路走到自己的每日上限拿 429，而不是熔断的 402）', async () => {
    mockRead.mockResolvedValue(OVER * 100)
    mockUser.mockResolvedValue({ userId: 'reg-1', isAnonymous: false })
    mockBump.mockResolvedValue(999_999)
    mockBumpRestructure.mockResolvedValue(999_999)
    mockReadDaily.mockResolvedValue(999_999)

    const res = await c.call()
    expect(res.status).toBe(429)
  })

  it('④ 今日花费读不到：匿名按放行处理（失败开放）', async () => {
    mockRead.mockResolvedValue(null)
    mockUser.mockResolvedValue({ userId: 'anon-1', isAnonymous: true })
    mockBump.mockResolvedValue(999_999)
    mockBumpRestructure.mockResolvedValue(999_999)
    mockReadDaily.mockResolvedValue(999_999)

    const res = await c.call()
    expect(res.status).toBe(402)
    const body = (await res.json()) as { reason?: string }
    expect(body.reason).not.toBe('global_budget')
  })
})
