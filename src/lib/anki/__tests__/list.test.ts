/**
 * @module   anki/list.test
 * @desc     Anki 列表读端点薄封装 list.ts 的行为级守卫。聚焦【backKind 对 v0.3 分点式点数组的判定】：
 *           generated_answer 从整段 text 改为点数组 JSON 字符串 [{idx,en,noMaterial}]，backKindOf 需解析
 *           JSON、至少一个非留空点（en 非空）才判 'generated'；空串 / 空数组 / 全留空 / 非法 JSON / 无语料
 *           一律回落 analysis；edited_answer 非空优先级最高。纯 mock，不碰真实 DB。
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
    corpus_summary: null,
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

/** 点数组 JSON 字符串（drain 存的 JSON.stringify(AnkiAnswerPoint[]) 形状）。 */
function pts(points: { idx: number; en: string | null; noMaterial: boolean }[]): string {
  return JSON.stringify(points)
}
/** 有内容的点数组（至少一个非留空点）。 */
const WITH_CONTENT = pts([
  { idx: 0, en: 'I go to a small park nearby.', noMaterial: false },
  { idx: 1, en: null, noMaterial: true },
])
/** 全留空点数组（生成过但每点都没素材）。 */
const ALL_BLANK = pts([
  { idx: 0, en: null, noMaterial: true },
  { idx: 1, en: null, noMaterial: true },
])

describe('listAnkiCards · backKind 对分点式点数组的判定', () => {
  beforeEach(() => jest.clearAllMocks())

  it("edited_answer='' 视同无内容 → 不判 edited（有语料 + 生成有内容 → generated）", async () => {
    mockRpcRows([rawRow({ edited_answer: '', corpus_id: 'c1', generated_answer: WITH_CONTENT })])
    const [card] = await listAnkiCards('u1', 1, 'all')
    expect(card.backKind).toBe('generated')
  })

  it("generated_answer='' 视同无内容 → 回落 analysis（即便有语料）", async () => {
    mockRpcRows([rawRow({ corpus_id: 'c1', generated_answer: '' })])
    const [card] = await listAnkiCards('u1', 1, 'all')
    expect(card.backKind).toBe('analysis')
  })

  it('edited_answer 非空 → edited 优先级最高（part3 用户自填亦走此）', async () => {
    mockRpcRows([rawRow({ edited_answer: '我的答案', corpus_id: 'c1', generated_answer: WITH_CONTENT })])
    const [card] = await listAnkiCards('u1', 1, 'all')
    expect(card.backKind).toBe('edited')
  })

  it('有语料 + 点数组至少一个非留空点 → generated', async () => {
    mockRpcRows([rawRow({ corpus_id: 'c1', generated_answer: WITH_CONTENT })])
    const [card] = await listAnkiCards('u1', 1, 'all')
    expect(card.backKind).toBe('generated')
  })

  it('有语料 + 点数组全留空（生成了但没素材）→ analysis（不误判为有卡背）', async () => {
    mockRpcRows([rawRow({ corpus_id: 'c1', generated_answer: ALL_BLANK })])
    const [card] = await listAnkiCards('u1', 1, 'all')
    expect(card.backKind).toBe('analysis')
  })

  it('有语料 + 空数组 [] → analysis', async () => {
    mockRpcRows([rawRow({ corpus_id: 'c1', generated_answer: '[]' })])
    const [card] = await listAnkiCards('u1', 1, 'all')
    expect(card.backKind).toBe('analysis')
  })

  it('有语料 + 非法 JSON（旧整段文本残留）→ analysis（保守回落）', async () => {
    mockRpcRows([rawRow({ corpus_id: 'c1', generated_answer: '这是一段旧的整段范文，不是 JSON' })])
    const [card] = await listAnkiCards('u1', 1, 'all')
    expect(card.backKind).toBe('analysis')
  })

  it('点数组有内容但无语料（corpus_id null）→ analysis（generated 需绑语料）', async () => {
    mockRpcRows([rawRow({ corpus_id: null, generated_answer: WITH_CONTENT })])
    const [card] = await listAnkiCards('u1', 1, 'all')
    expect(card.backKind).toBe('analysis')
  })

  it('无语料（默认卡/删语料退化）→ analysis 兜底', async () => {
    mockRpcRows([rawRow({ corpus_id: null, generated_answer: null })])
    const [card] = await listAnkiCards('u1', 1, 'all')
    expect(card.backKind).toBe('analysis')
  })
})
