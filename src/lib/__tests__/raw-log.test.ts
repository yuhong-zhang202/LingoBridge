/**
 * @module   raw-log.test
 * @desc     appendRawLog 入库沟槽 + deleteUserRawLogs 的单元测试 —— 验证：
 *           ① 开关关（rawLogEnabled=false）直接 return、不碰数据库；
 *           ② 开关开时 LLM/ASR 各自落对表、字段映射正确、user_id/corpus_id 取自 ALS 上下文；
 *           ③ insert 报错只 console.warn、绝不抛（不影响主链路）；
 *           ④ deleteUserRawLogs 删两表、不带 retained 过滤、报错向上抛（供删号 best-effort 兜）。
 *           全部在 supabase-server / raw-log-context 层 mock，不连真实库。
 * @author   LingoBridge
 * @created  2026-07-17
 */
jest.mock('server-only', () => ({}))

// 可变 env：各用例切 rawLogEnabled。raw-log.ts 在调用时读 env.rawLogEnabled，故 mutate 即生效。
const mockEnv: { rawLogEnabled: boolean } = { rawLogEnabled: false }
jest.mock('@/lib/env-server', () => ({ env: mockEnv }))

// ALS 上下文：由 getRawLogContext mock 控制每个用例返回的 userId / corpusId。
const mockGetRawLogContext = jest.fn<
  { userId: string | null; corpusId?: string | null } | undefined,
  []
>()
jest.mock('@/lib/raw-log-context', () => ({ getRawLogContext: () => mockGetRawLogContext() }))

// 假 supabase client：记录 insert / delete 的表名与载荷。
const insertMock = jest.fn<Promise<{ error: unknown }>, [unknown]>()
const eqMock = jest.fn<Promise<{ error: unknown }>, [string, string]>()
const fromMock = jest.fn((table: string) => ({
  insert: (row: unknown) => {
    insertCalls.push({ table, row })
    return insertMock(row)
  },
  delete: () => ({
    eq: (col: string, val: string) => {
      deleteCalls.push({ table, col, val })
      return eqMock(col, val)
    },
  }),
}))
const insertCalls: Array<{ table: string; row: unknown }> = []
const deleteCalls: Array<{ table: string; col: string; val: string }> = []
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: () => ({ from: fromMock }) }))

import { appendRawLog, deleteUserRawLogs, type LLMRawRecord, type AsrRawRecord } from '@/lib/raw-log'

const LLM_RECORD: LLMRawRecord = {
  kind: 'llm',
  ts: '2026-07-17T10:00:00.000Z',
  label: '[extract]',
  provider: 'anthropic',
  model: 'claude-x',
  attempt: 1,
  system: 'SYS',
  messages: [{ role: 'user', content: '故事原文' }],
  raw: '{"a":1}',
  jsonText: '{"a":1}',
  parsed: 'ok',
}

const ASR_RECORD: AsrRawRecord = {
  kind: 'asr',
  ts: '2026-07-17T10:05:00.000Z',
  requestId: 'req-1',
  logId: 'log-1',
  format: 'wav',
  statusCode: '20000000',
  transcript: '转写原文',
  guard: 'ok',
}

beforeEach(() => {
  insertCalls.length = 0
  deleteCalls.length = 0
  insertMock.mockReset().mockResolvedValue({ error: null })
  eqMock.mockReset().mockResolvedValue({ error: null })
  fromMock.mockClear()
  mockGetRawLogContext.mockReset().mockReturnValue({ userId: 'u1', corpusId: 'c1' })
  mockEnv.rawLogEnabled = true
})

describe('appendRawLog — 开关', () => {
  it('rawLogEnabled=false 时直接 return，不碰数据库', async () => {
    mockEnv.rawLogEnabled = false
    await appendRawLog(LLM_RECORD)
    expect(fromMock).not.toHaveBeenCalled()
    expect(insertCalls).toHaveLength(0)
  })
})

describe('appendRawLog — 字段映射与分表', () => {
  it('LLM 记录落 llm_raw_logs，字段映射 + user_id/corpus_id 取自上下文', async () => {
    await appendRawLog(LLM_RECORD)
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].table).toBe('llm_raw_logs')
    expect(insertCalls[0].row).toEqual({
      user_id: 'u1',
      corpus_id: 'c1',
      label: '[extract]',
      provider: 'anthropic',
      model: 'claude-x',
      attempt: 1,
      system: 'SYS',
      messages: [{ role: 'user', content: '故事原文' }],
      raw: '{"a":1}',
      json_text: '{"a":1}',
      parsed: 'ok',
      created_at: '2026-07-17T10:00:00.000Z',
    })
  })

  it('ASR 记录落 asr_raw_logs，字段映射正确', async () => {
    await appendRawLog(ASR_RECORD)
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].table).toBe('asr_raw_logs')
    expect(insertCalls[0].row).toEqual({
      user_id: 'u1',
      corpus_id: 'c1',
      request_id: 'req-1',
      log_id: 'log-1',
      format: 'wav',
      status_code: '20000000',
      transcript: '转写原文',
      guard: 'ok',
      created_at: '2026-07-17T10:05:00.000Z',
    })
  })

  it('无 ALS 上下文时 user_id / corpus_id 写 null', async () => {
    mockGetRawLogContext.mockReturnValue(undefined)
    await appendRawLog(LLM_RECORD)
    const row = insertCalls[0].row as { user_id: unknown; corpus_id: unknown }
    expect(row.user_id).toBeNull()
    expect(row.corpus_id).toBeNull()
  })
})

describe('appendRawLog — 失败旁路', () => {
  it('insert 报错只 console.warn、不抛', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    insertMock.mockResolvedValue({ error: { message: 'db down' } })
    await expect(appendRawLog(LLM_RECORD)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('deleteUserRawLogs — 彻底删', () => {
  it('删两表、按 user_id、不带 retained 过滤', async () => {
    await deleteUserRawLogs('u9')
    expect(deleteCalls).toEqual([
      { table: 'llm_raw_logs', col: 'user_id', val: 'u9' },
      { table: 'asr_raw_logs', col: 'user_id', val: 'u9' },
    ])
  })

  it('删除报错向上抛（供删号 best-effort 兜住）', async () => {
    eqMock.mockResolvedValueOnce({ error: { message: 'boom' } })
    await expect(deleteUserRawLogs('u9')).rejects.toBeDefined()
  })
})
