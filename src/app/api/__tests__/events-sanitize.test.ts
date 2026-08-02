/**
 * @module   api/events-sanitize.test
 * @desc     /api/events 服务端 sanitize 白名单红线 —— 隐私铁律「客户端塞不进原文」的守卫。
 *           锁死 match.question_opened 的收敛口径（乙.1 新增 questionId/algoVersion 后重点验放行边界）：
 *             · rank / candidateCount / dwellMs：只放行合法整数，负数/非整数/超界一律丢；
 *             · questionId：只放行严格 UUID 形态，非 UUID（含自由文本）一律丢；
 *             · algoVersion：只放行短枚举串（≤32、仅 [a-z0-9._-]），自由文本/超长一律丢；
 *             · 任何不在白名单里的键（含原文字段）绝不进库。
 *           全 mock，不碰真实 DB/鉴权；断言落到 logEvent 收到的 props（= 实际写库内容）。
 * @author   LingoBridge
 * @created  2026-08-02
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/log', () => ({ logErr: jest.fn() }))
jest.mock('@/lib/events', () => ({ logEvent: jest.fn(() => Promise.resolve()) }))
jest.mock('@/lib/api-auth', () => ({
  requireUserAllowAnon: jest.fn(() => Promise.resolve({ userId: 'u1', isAnonymous: false })),
  authErrorResponse: jest.fn(() => null),
}))

import { POST } from '@/app/api/events/route'
import { logEvent } from '@/lib/events'

const mockLogEvent = logEvent as jest.MockedFunction<typeof logEvent>

beforeEach(() => jest.clearAllMocks())

/** 造一个带 question_opened 事件 + 给定 props 的上报请求 */
function makeReq(props: Record<string, unknown>, storyId = 'story-1'): Request {
  return new Request('http://localhost/api/events', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json', 'x-flow-id': 'flow-xyz' },
    body: JSON.stringify({ event: 'match.question_opened', storyId, props }),
  })
}

/** 取本次 logEvent 收到的 props（= 收敛后实际写库内容） */
function capturedProps(): Record<string, unknown> {
  const arg = mockLogEvent.mock.calls[0][0]
  return (arg.props ?? {}) as Record<string, unknown>
}

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000'

describe('question_opened · sanitize 白名单（乙.1）', () => {
  test('合法 questionId(UUID) + algoVersion(短枚举) 放行', async () => {
    await POST(makeReq({ rank: 3, candidateCount: 8, questionId: VALID_UUID, algoVersion: 'v1-2026-07-17' }))
    expect(capturedProps()).toEqual({ rank: 3, candidateCount: 8, questionId: VALID_UUID, algoVersion: 'v1-2026-07-17' })
  })

  test('非 UUID 的 questionId 一律丢弃（含伪装成 id 的自由文本）', async () => {
    await POST(makeReq({ rank: 1, questionId: '用户偷偷塞的原文句子' }))
    expect(capturedProps()).toEqual({ rank: 1 })
  })

  test('超长 / 含非法字符的 algoVersion 一律丢弃', async () => {
    await POST(makeReq({ rank: 1, algoVersion: '这是一段中文原文不该进库'.repeat(5) }))
    expect(capturedProps()).toEqual({ rank: 1 })
  })

  test('白名单外的任意键（原文字段）绝不进库', async () => {
    await POST(makeReq({ rank: 2, note: '我的隐私故事', transcript: 'hello world' }))
    expect(capturedProps()).toEqual({ rank: 2 })
  })

  test('非法数值（负 rank / 非整 dwellMs）被丢，flowId 走 header 透传', async () => {
    await POST(makeReq({ rank: -1, candidateCount: 5, dwellMs: 1.5 }))
    expect(capturedProps()).toEqual({ candidateCount: 5 })
    expect(mockLogEvent.mock.calls[0][0].flowId).toBe('flow-xyz')
  })
})
