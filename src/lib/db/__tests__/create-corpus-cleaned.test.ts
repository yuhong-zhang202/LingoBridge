/**
 * @module   db/create-corpus-cleaned.test
 * @desc     `createCorpusServer` 的 insert 载荷守卫 —— 钉死「文字路径跳过整理确认页之后，
 *           cleaned_text 必须和建语料【同一次 insert】写进去」。
 *
 *   【为什么这条值得单独立测】2026-08-27 之前，全仓写 cleaned_text 的地方只有 restructure 页
 *   （updateCorpusCleaned），而 getCorpusByIdServer 只 select cleaned_text、没有任何 `?? raw_text` 兜底
 *   （刻意的：加了兜底会让「整理失败」变静默、生 ASR 稿悄悄流进六个下游）。
 *   于是「建了语料但没写 cleaned_text」的后果不是某个字段空着，而是六个消费方同时哑掉：
 *   /api/matching 400、**`/api/analysis` 静默降级成「通用分析」（界面完全看不出来）**、
 *   教练走「用户还没分享故事」的 fallback、Anki 卡背按无语料生成、练习题目页显示空白语料卡。
 *   这些没有一个会报错，tsc / build / 冒烟点击全绿。只有断言 insert 载荷能守住。
 *
 *   同时守两条边界：
 *     · 不传整理结果（语音路径）→ 载荷里【不许出现】cleaned_text / status，行为与改动前逐字一致；
 *     · 传空白整理结果 → 当没传，status 必须停在 draft（默认值），
 *       绝不能用空串把状态推到 restructured —— 那等于宣称「整理好了」而内容是空的。
 * @author   LingoBridge
 * @created  2026-08-27
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: jest.fn() }))

import { createCorpusServer } from '@/lib/db/corpus-server'
import { getSupabaseServer } from '@/lib/supabase-server'

const mockGetSupabaseServer = getSupabaseServer as jest.MockedFunction<typeof getSupabaseServer>

/** 捕获 insert 载荷的 supabase 桩：返回一行足以喂饱 mapCorpusRow 的假数据 */
function stubSupabase(): { captured: () => Record<string, unknown> } {
  let payload: Record<string, unknown> = {}
  const single = jest.fn(() => Promise.resolve({
    data: {
      id: 'c-1', user_id: 'u-1', source: 'text', raw_text: 'raw', cleaned_text: null, summary: null,
      audio_url: null, status: 'draft', created_at: 'now', updated_at: 'now',
    },
    error: null,
  }))
  const select = jest.fn(() => ({ single }))
  const insert = jest.fn((row: Record<string, unknown>) => { payload = row; return { select } })
  const from = jest.fn(() => ({ insert }))
  mockGetSupabaseServer.mockReturnValue({ from } as unknown as ReturnType<typeof getSupabaseServer>)
  return { captured: () => payload }
}

describe('createCorpusServer · 整理结果原子写入', () => {
  beforeEach(() => jest.clearAllMocks())

  it('带 cleanedText 时：cleaned_text 与 raw_text 同一次 insert 落库，且 status 推到 restructured', async () => {
    const s = stubSupabase()
    await createCorpusServer('u-1', {
      source: 'text',
      rawText: '原始故事原文',
      cleanedText: '整理后的故事正文',
      summary: '一句话概括',
    })
    expect(s.captured()).toEqual({
      user_id: 'u-1',
      source: 'text',
      raw_text: '原始故事原文',
      cleaned_text: '整理后的故事正文',
      summary: '一句话概括',
      status: 'restructured',
    })
  })

  it('不带 cleanedText（语音路径）时：载荷里没有 cleaned_text / status / summary，行为与改动前一致', async () => {
    const s = stubSupabase()
    await createCorpusServer('u-1', { source: 'voice', rawText: '原始故事原文' })
    expect(s.captured()).toEqual({ user_id: 'u-1', source: 'voice', raw_text: '原始故事原文' })
  })

  it('cleanedText 只有空白 → 当没传：不写 cleaned_text、status 停在 draft（不许拿空串宣称「整理好了」）', async () => {
    const s = stubSupabase()
    await createCorpusServer('u-1', { source: 'text', rawText: '原始故事原文', cleanedText: '   ', summary: '概括' })
    expect(s.captured()).toEqual({ user_id: 'u-1', source: 'text', raw_text: '原始故事原文' })
  })

  it('有 cleanedText、summary 为空 → 只写 cleaned_text，不把 summary 列写成空串', async () => {
    const s = stubSupabase()
    await createCorpusServer('u-1', { source: 'text', rawText: '原文', cleanedText: '整理稿', summary: '' })
    expect(s.captured()).toEqual({
      user_id: 'u-1', source: 'text', raw_text: '原文', cleaned_text: '整理稿', status: 'restructured',
    })
  })
})
