/**
 * @module   api/corpus/create-with-cleaned.test
 * @desc     `POST /api/corpus` 对整理结果的透传契约 —— 补上「客户端发了、服务端却没接住」这一环。
 *
 *   文字路径 2026-08-27 起跳过整理确认页，cleaned_text 只剩这一条写入路径，而这条链有三节：
 *     ① 客户端把 cleanedText 放进请求体（hooks/__tests__/story-submit.test.ts 守）
 *     ② **本路由把它透传给 createCorpusServer**（本文件守）
 *     ③ createCorpusServer 把它写进同一次 insert（lib/db/__tests__/create-corpus-cleaned.test.ts 守）
 *   任何一节断了，结果都不是报错，而是 /api/analysis 静默降级成「通用分析」这类【界面看不出来】的哑火。
 *   三节各守一处，缺一处就有一段无人看管。
 *
 *   全 mock，不碰真实 DB / 鉴权 / 模型。
 * @author   LingoBridge
 * @created  2026-08-27
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/events', () => ({ logEvent: jest.fn() }))
jest.mock('@/lib/db/corpus', () => ({ STORY_MONTHLY_LIMIT: 10 }))
jest.mock('@/lib/db/corpus-server', () => ({
  countCorpusForUserServer: jest.fn(() => Promise.resolve(0)),
  countCorpusThisMonthServer: jest.fn(() => Promise.resolve(0)),
  createCorpusServer: jest.fn(),
}))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(() => Promise.resolve({ userId: 'u1', isAnonymous: false })),
  authErrorResponse: jest.fn(() => null),
}))
jest.mock('@/lib/consent-server', () => ({ requireConsent: jest.fn(() => Promise.resolve(null)) }))

import { POST } from '@/app/api/corpus/route'
import { createCorpusServer } from '@/lib/db/corpus-server'

const mockCreate = createCorpusServer as jest.MockedFunction<typeof createCorpusServer>

// 50+ 有效字符，逃过 isTooShortForCorpus（MIN_CORPUS_CHARS=40）
const RAW = '上周我在公司做了一次汇报，准备了整整三天，中途投影仪突然坏了，我只好临时改成口头讲，结果反响还算不错。'
const CLEANED = '上周我在公司做汇报，准备了三天。投影仪中途坏了，我改成口头讲，反响不错。'

beforeEach(() => {
  jest.clearAllMocks()
  mockCreate.mockResolvedValue({
    id: 'c-1', userId: 'u1', source: 'text', rawText: RAW, cleanedText: CLEANED,
    summary: null, audioUrl: null, status: 'restructured', createdAt: 'now', updatedAt: 'now',
  })
})

/** 造一条带 JSON body 的鉴权请求 */
function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/corpus', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/corpus · 整理结果透传', () => {
  it('cleanedText / summary 原样传给 createCorpusServer（文字路径的语料靠这一次请求写完 cleaned_text）', async () => {
    const res = await POST(makeReq({ source: 'text', rawText: RAW, cleanedText: CLEANED, summary: '一句话概括' }))
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith('u1', {
      source: 'text',
      rawText: RAW,
      cleanedText: CLEANED,
      summary: '一句话概括',
    })
  })

  it('不传整理结果（语音路径）：两个字段为 undefined，服务端按「只建 draft」走，行为与改动前一致', async () => {
    await POST(makeReq({ source: 'voice', rawText: RAW }))
    expect(mockCreate).toHaveBeenCalledWith('u1', {
      source: 'voice',
      rawText: RAW,
      cleanedText: undefined,
      summary: undefined,
    })
  })

  it('非字符串的 cleanedText / summary 一律当没传（防脏值被写进语料正文）', async () => {
    await POST(makeReq({ source: 'text', rawText: RAW, cleanedText: { evil: 1 }, summary: 42 }))
    expect(mockCreate).toHaveBeenCalledWith('u1', {
      source: 'text',
      rawText: RAW,
      cleanedText: undefined,
      summary: undefined,
    })
  })
})
