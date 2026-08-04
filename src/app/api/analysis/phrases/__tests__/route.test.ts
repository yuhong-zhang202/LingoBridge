/**
 * @module   api/analysis/phrases/route.test
 * @desc     换档词组接口的缓存单测 —— 守住四条不变式：
 *           ① 三重命中（键 + season + content_hash）→ 不调 AI、不写 usage、直接回词组；
 *           ② 串档防护：level 折进 content_hash，别的档位的缓存行【绝不】被当成本档结果返回；
 *           ③ 合并回填：只在「已存行 season 一致 且 骨架确属当前语料」时写，且必须沿用旧骨架
 *              （structureLabel/focusPoints）—— 绝不把半份 analysis 写进 /api/analysis 共用的那张表；
 *           ④ 缓存读失败静默降级为未命中，请求照常成功。
 *           全部依赖 mock，不碰真实 DB / 模型 / 鉴权。
 * @author   LingoBridge
 * @created  2026-08-04
 */
import { createHash } from 'crypto'

// —— 依赖全 mock 在模块边界（照搬 /api/analysis 路由测试的范式）——
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/db/questions', () => ({ getQuestionById: jest.fn() }))
jest.mock('@/lib/db/question-analyses', () => ({
  getPersonalAnalysis: jest.fn(),
  upsertPersonalAnalysis: jest.fn(),
}))
jest.mock('@/lib/db/corpus-server', () => ({
  getCorpusByIdServer: jest.fn(),
  bumpDailyUsageServer: jest.fn(),
}))
jest.mock('@/services/analysis', () => ({ generatePhrases: jest.fn() }))
jest.mock('@/lib/api-logger', () => ({ logApiUsage: jest.fn(), qwenPlusCostCny: jest.fn(() => 0.001) }))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(),
  assertCorpusOwner: jest.fn(),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/consent-server', () => ({ requireConsent: jest.fn(() => Promise.resolve(null)) }))
jest.mock('@/lib/raw-log-context', () => ({ runWithRawLogContext: (_ctx: unknown, fn: () => unknown) => fn() }))

import { POST } from '@/app/api/analysis/phrases/route'
import { getQuestionById } from '@/lib/db/questions'
import { getPersonalAnalysis, upsertPersonalAnalysis } from '@/lib/db/question-analyses'
import { getCorpusByIdServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { generatePhrases } from '@/services/analysis'
import { logApiUsage } from '@/lib/api-logger'
import { requireUserAllowAnon, assertCorpusOwner } from '@/lib/api-auth'
import type { AnalysisPhraseGroup, QuestionAnalysis } from '@/lib/types'

const mockGetQuestion = getQuestionById as jest.MockedFunction<typeof getQuestionById>
const mockGetPersonal = getPersonalAnalysis as jest.MockedFunction<typeof getPersonalAnalysis>
const mockUpsert      = upsertPersonalAnalysis as jest.MockedFunction<typeof upsertPersonalAnalysis>
const mockGetCorpus   = getCorpusByIdServer as jest.MockedFunction<typeof getCorpusByIdServer>
const mockBumpDaily   = bumpDailyUsageServer as jest.MockedFunction<typeof bumpDailyUsageServer>
const mockGenPhrases  = generatePhrases as jest.MockedFunction<typeof generatePhrases>
const mockLogApiUsage = logApiUsage as jest.MockedFunction<typeof logApiUsage>
const mockRequireUser = requireUserAllowAnon as jest.MockedFunction<typeof requireUserAllowAnon>
const mockAssertOwner = assertCorpusOwner as jest.MockedFunction<typeof assertCorpusOwner>

// —— 桩数据 ——
const STORY = '上周末我去公园散步，放松了很久。'
const SEASON = '2026-05'
/** 与 route 的 contentHashOf(story, level) 同口径（测试独立实现，route 改口径这里就会红） */
function hashOf(story: string, level: string): string {
  return createHash('sha256').update(`${story}\nlevel=${level}`).digest('hex')
}

/** 缓存里的骨架（level 无关：level 只调词组难度，见 services/analysis 顶注） */
const SKELETON: Pick<QuestionAnalysis, 'structureLabel' | 'focusPoints'> = {
  structureLabel: '交代背景 · 讲清重点',
  focusPoints: [{ title: '交代背景', desc: '一句话带过时间地点。' }],
}
const CACHED_PHRASES: AnalysisPhraseGroup[] = [
  { group: '感受', items: [{ text: 'felt relaxed', meaning: '放松', scene: '休息后' }] },
]
const FRESH_PHRASES: AnalysisPhraseGroup[] = [
  { group: '时间', items: [{ text: 'last weekend', meaning: '上周末', scene: '开头' }] },
]

/** 造一条缓存行：骨架 + 指定档位的词组，content_hash 按 (story, level) 算 */
function cacheRow(level: string, story = STORY, season = SEASON) {
  return { analysis: { ...SKELETON, phrases: CACHED_PHRASES }, season, contentHash: hashOf(story, level) }
}

function makeQuestion() {
  return {
    id: 'q1', part: 1 as const, question_text: 'What do you do at weekends?', question_text_zh: '周末做什么？',
    cue_card_title: null, cue_card_title_zh: null, observation_points: ['SPA_03'], season: SEASON, is_new: false,
  }
}

function makeReq(body: Record<string, unknown> = { questionId: 'q1', storyId: 'c1', level: '7.0' }): Request {
  return new Request('http://localhost/api/analysis/phrases', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireUser.mockResolvedValue({ userId: 'u1', isAnonymous: false })
  mockAssertOwner.mockResolvedValue(undefined)
  mockBumpDaily.mockResolvedValue(1)
  mockGetCorpus.mockResolvedValue(STORY)
  mockGetQuestion.mockResolvedValue(makeQuestion() as never)
  mockGetPersonal.mockResolvedValue(null)
  mockUpsert.mockResolvedValue(undefined)
  mockLogApiUsage.mockResolvedValue(undefined)
  mockGenPhrases.mockResolvedValue(FRESH_PHRASES)
})

describe('POST /api/analysis/phrases · 缓存命中', () => {
  test('P1. 三重命中（同键 + 同 season + 同档 hash）→ 不调 AI、不写 usage，直接返回缓存词组', async () => {
    mockGetPersonal.mockResolvedValue(cacheRow('7.0'))

    const res = await POST(makeReq())
    const body = (await res.json()) as { phrases: AnalysisPhraseGroup[] }

    expect(res.status).toBe(200)
    expect(body.phrases).toEqual(CACHED_PHRASES)
    expect(mockGenPhrases).not.toHaveBeenCalled()
    expect(mockLogApiUsage).not.toHaveBeenCalled()   // 命中不产生成本 → 绝不往成本看板灌账
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  test('P2. 命中也照扣每日次数（与 /api/analysis 命中分支同口径，bump 是防刷闸不是计费闸）', async () => {
    mockGetPersonal.mockResolvedValue(cacheRow('7.0'))

    await POST(makeReq())

    expect(mockBumpDaily).toHaveBeenCalledTimes(1)
    expect(mockBumpDaily).toHaveBeenCalledWith('u1', 'phrases')
  })

  test('P3. 非法 level（超长串）收敛为 6.0 → 用 6.0 的 hash 判命中', async () => {
    mockGetPersonal.mockResolvedValue(cacheRow('6.0'))

    const res = await POST(makeReq({ questionId: 'q1', storyId: 'c1', level: 'x'.repeat(5000) }))
    const body = (await res.json()) as { phrases: AnalysisPhraseGroup[] }

    expect(body.phrases).toEqual(CACHED_PHRASES)
    expect(mockGenPhrases).not.toHaveBeenCalled()
  })
})

describe('POST /api/analysis/phrases · 串档 / 失效防护', () => {
  test('P4. 串档防护：缓存是 7.0 档，请求 6.5 → 不命中，重新调 AI 返回新词组（绝不返回别档词组）', async () => {
    mockGetPersonal.mockResolvedValue(cacheRow('7.0'))

    const res = await POST(makeReq({ questionId: 'q1', storyId: 'c1', level: '6.5' }))
    const body = (await res.json()) as { phrases: AnalysisPhraseGroup[] }

    expect(mockGenPhrases).toHaveBeenCalledTimes(1)
    expect(mockGenPhrases).toHaveBeenCalledWith(expect.objectContaining({ level: '6.5' }), expect.any(Function))
    expect(body.phrases).toEqual(FRESH_PHRASES)
    expect(body.phrases).not.toEqual(CACHED_PHRASES)
  })

  test('P5. 换季（缓存行 season 与题目当前 season 不一致）→ 不命中，且不回填（旧骨架不沿用）', async () => {
    mockGetPersonal.mockResolvedValue(cacheRow('7.0', STORY, '2025-09'))

    const res = await POST(makeReq())
    const body = (await res.json()) as { phrases: AnalysisPhraseGroup[] }

    expect(body.phrases).toEqual(FRESH_PHRASES)
    expect(mockGenPhrases).toHaveBeenCalledTimes(1)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  test('P6. 故事已改（缓存行哈希不属当前正文的任何档）→ 不命中，且不回填（防旧骨架配新词组）', async () => {
    mockGetPersonal.mockResolvedValue(cacheRow('7.0', '这是另一份完全不同的旧故事。'))

    await POST(makeReq())

    expect(mockGenPhrases).toHaveBeenCalledTimes(1)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  test('P7. 无已存行 → 不回填（本路由只产词组，凑不出整份 analysis，绝不写半份进共用表）', async () => {
    mockGetPersonal.mockResolvedValue(null)

    await POST(makeReq())

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  test('P8. 缓存读抛错 → 静默降级为未命中，请求照常 200 且不回填', async () => {
    mockGetPersonal.mockRejectedValue(new Error('DB 挂了'))

    const res = await POST(makeReq())
    const body = (await res.json()) as { phrases: AnalysisPhraseGroup[] }

    expect(res.status).toBe(200)
    expect(body.phrases).toEqual(FRESH_PHRASES)
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

describe('POST /api/analysis/phrases · 合并回填', () => {
  test('P9. 未命中但已存行属当前故事、当季 → 合并写：沿用旧骨架 + 新档词组，hash 换成新档', async () => {
    mockGetPersonal.mockResolvedValue(cacheRow('6.0'))

    await POST(makeReq({ questionId: 'q1', storyId: 'c1', level: '7.0' }))

    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledWith('c1', 'q1', SEASON, hashOf(STORY, '7.0'), {
      structureLabel: SKELETON.structureLabel,
      focusPoints: SKELETON.focusPoints,
      phrases: FRESH_PHRASES,
    })
  })

  test('P10. 回填写失败 → 吞掉，仍返回 200 与新词组（缓存写不该把成功的请求变 500）', async () => {
    mockGetPersonal.mockResolvedValue(cacheRow('6.0'))
    mockUpsert.mockRejectedValue(new Error('写库失败'))

    const res = await POST(makeReq())
    const body = (await res.json()) as { phrases: AnalysisPhraseGroup[] }

    expect(res.status).toBe(200)
    expect(body.phrases).toEqual(FRESH_PHRASES)
  })

  test('P11. 无语料（通用路径，无 storyId）→ 既不读缓存也不回填', async () => {
    await POST(makeReq({ questionId: 'q1', level: '7.0' }))

    expect(mockGetPersonal).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(mockGenPhrases).toHaveBeenCalledTimes(1)
  })

  test('P12. 重试场景端到端：首次未命中生成并回填 → 第二次同档请求命中、零 AI 调用', async () => {
    // 首次：已存行是分析页写的 6.0 档 → 换 7.0 未命中 → 生成 + 合并回填
    mockGetPersonal.mockResolvedValue(cacheRow('6.0'))
    await POST(makeReq())
    const [, , , writtenHash, writtenAnalysis] = mockUpsert.mock.calls[0]

    // 第二次（用户重试同一档）：读到刚回填的那行
    jest.clearAllMocks()
    mockGetQuestion.mockResolvedValue(makeQuestion() as never)
    mockGetCorpus.mockResolvedValue(STORY)
    mockBumpDaily.mockResolvedValue(2)
    mockRequireUser.mockResolvedValue({ userId: 'u1', isAnonymous: false })
    mockGetPersonal.mockResolvedValue({ analysis: writtenAnalysis, season: SEASON, contentHash: writtenHash })

    const res = await POST(makeReq())
    const body = (await res.json()) as { phrases: AnalysisPhraseGroup[] }

    expect(body.phrases).toEqual(FRESH_PHRASES)
    expect(mockGenPhrases).not.toHaveBeenCalled()      // 重试零 AI 调用
    expect(mockLogApiUsage).not.toHaveBeenCalled()     // 重试零成本记账
  })
})
