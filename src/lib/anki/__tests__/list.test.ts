/**
 * @module   anki/list.test
 * @desc     Anki 列表读端点薄封装 list.ts 的行为级守卫。本轮聚焦【backKind 空串边界与 SQL 一致】
 *           （审计 E）：0035 已把 get_anki_cards 的 is_answered 空串处理对齐为「空串视同无内容」，
 *           这里钉死 JS 侧 backKindOf 同口径——generated_answer/edited_answer 为 '' 时不算内容、回落 analysis，
 *           非空才 generated/edited。改一侧漏改另一侧，这条即红。纯 mock，不碰真实 DB。
 * @author   LingoBridge
 * @created  2026-07-23
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))

import { listAnkiCards } from '@/lib/anki/list'
import { getSupabaseServer } from '@/lib/supabase-server'

const mockGetSupabaseServer = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

/** 造一行 get_anki_cards RPC 原始返回（snake_case），只填 backKind 判定相关列，其余给合法占位。 */
function rawRow(over: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    question_id: 'q1',
    part: 1,
    parent_question_id: null,
    topic: 't',
    question_text: 'x',
    question_text_zh: null,
    cue_card_title: null,
    cue_card_title_zh: null,
    season: '2026-05',
    corpus_id: null,
    generated_answer: null,
    edited_answer: null,
    analysis: null,
    box: 1,
    due_at: '2026-07-23T00:00:00Z',
    last_reviewed_at: null,
    has_card: false,
    is_answered: false,
    ...over,
  }
}

/** 让 getSupabaseServer().rpc('get_anki_cards', ...) 回给定行集。 */
function mockRpcRows(rows: Record<string, unknown>[]): void {
  const rpc = jest.fn(() => Promise.resolve({ data: rows, error: null }))
  mockGetSupabaseServer.mockReturnValue({ rpc } as unknown as ReturnType<typeof getSupabaseServer>)
}

describe('listAnkiCards · backKind 空串边界（与 0035 get_anki_cards is_answered 同口径）', () => {
  beforeEach(() => jest.clearAllMocks())

  it("edited_answer='' 视同无内容 → 不判 edited", async () => {
    mockRpcRows([rawRow({ edited_answer: '', corpus_id: 'c1', generated_answer: 'ans' })])
    const [card] = await listAnkiCards('u1', 1, 'all')
    // 空串 edited 不夺优先级；有语料且生成非空 → generated。
    expect(card.backKind).toBe('generated')
  })

  it("generated_answer='' 视同无内容 → 回落 analysis（即便有语料）", async () => {
    mockRpcRows([rawRow({ corpus_id: 'c1', generated_answer: '' })])
    const [card] = await listAnkiCards('u1', 1, 'all')
    expect(card.backKind).toBe('analysis')
  })

  it('edited_answer 非空 → edited 优先级最高（part3 用户自填亦走此）', async () => {
    mockRpcRows([rawRow({ edited_answer: '我的答案', corpus_id: 'c1', generated_answer: 'ans' })])
    const [card] = await listAnkiCards('u1', 1, 'all')
    expect(card.backKind).toBe('edited')
  })

  it('有语料 + 生成非空 → generated', async () => {
    mockRpcRows([rawRow({ corpus_id: 'c1', generated_answer: 'ans' })])
    const [card] = await listAnkiCards('u1', 1, 'all')
    expect(card.backKind).toBe('generated')
  })

  it('无语料（默认卡/删语料退化）→ analysis 兜底', async () => {
    mockRpcRows([rawRow({ corpus_id: null, generated_answer: null })])
    const [card] = await listAnkiCards('u1', 1, 'all')
    expect(card.backKind).toBe('analysis')
  })
})
