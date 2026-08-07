/**
 * @module   feedback/collect.test
 * @desc     反馈页收藏写入点的红线守卫 —— 钉死「落库失败时绝不加计数、必须给用户可见提示」。
 *
 *   【为什么这个测试非有不可】原实现无条件 setSaved(c+1)、失败只 console.error：
 *   计数照加、卡片照翻，用户以为收藏成功、实际一条没进库。这类 bug 编译器和类型都抓不到，
 *   本仓库又没有 DOM 测试环境（无 jsdom / testing-library），所以逻辑被抽进 collect.ts，
 *   由本文件直接构造「addSavedPhrase 抛错」「ensureSession 抛错」两种失败去断言回调走向。
 *
 *   全 mock：不碰 supabase、不发任何请求；断言落在 onSaved/onFailed 的调用次数与 track 的 props 上。
 *
 * @author   LingoBridge
 * @created  2026-08-07
 */
jest.mock('@/lib/supabase', () => ({ ensureSession: jest.fn(() => Promise.resolve('u1')) }))
jest.mock('@/lib/db/saved-phrases', () => ({ addSavedPhrase: jest.fn(() => Promise.resolve({ id: 'p1' })) }))
jest.mock('@/hooks/library-data', () => ({ refreshSavedPhrases: jest.fn(() => Promise.resolve()) }))
jest.mock('@/lib/client-events', () => ({ track: jest.fn() }))

import { makeCollectHandler, COLLECT_FAILED_MESSAGE } from '../collect'
import { ensureSession } from '@/lib/supabase'
import { addSavedPhrase } from '@/lib/db/saved-phrases'
import { refreshSavedPhrases } from '@/hooks/library-data'
import { track } from '@/lib/client-events'
import type { SessionPolish } from '@/lib/types'

const mockEnsureSession = ensureSession as jest.MockedFunction<typeof ensureSession>
const mockAdd = addSavedPhrase as jest.MockedFunction<typeof addSavedPhrase>
const mockRefresh = refreshSavedPhrases as jest.MockedFunction<typeof refreshSavedPhrases>
const mockTrack = track as jest.MockedFunction<typeof track>

/** 一张反馈卡（内容刻意带中文原文，用来验证埋点里一个字都不许出现） */
const CARD: SessionPolish = {
  original: '我昨天和妈妈吵了一架',
  optimized: 'I had a row with my mum yesterday',
  note: '用 row 比 quarrel 更口语',
  part: 2,
  questionEn: 'Describe an argument you had.',
}

/** 造一对回调 spy + 已接好的收藏回调 */
function setup(): {
  collect: (polish: SessionPolish, view: 'mobile' | 'desktop') => void
  onSaved: jest.Mock
  onFailed: jest.Mock
} {
  const onSaved = jest.fn()
  const onFailed = jest.fn()
  return { collect: makeCollectHandler({ onSaved, onFailed }), onSaved, onFailed }
}

/** 等后台那条 Promise 链跑完（收藏回调是 fire-and-forget，不返回 Promise） */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  mockEnsureSession.mockResolvedValue('u1')
  mockAdd.mockResolvedValue({ id: 'p1' } as Awaited<ReturnType<typeof addSavedPhrase>>)
  mockRefresh.mockResolvedValue(undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('收藏成功路径', () => {
  test('落库成功才加计数：onSaved 一次、无失败提示，并按视图报 flow.phrase_collected', async () => {
    const { collect, onSaved, onFailed } = setup()
    collect(CARD, 'mobile')
    await flush()
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onFailed).not.toHaveBeenCalled()
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(mockTrack).toHaveBeenCalledWith('flow.phrase_collected', { nth: 1, view: 'mobile' })
  })

  test('nth 按「本场成功数」递增，且失败不占号', async () => {
    const { collect } = setup()
    collect(CARD, 'desktop')
    await flush()
    mockAdd.mockRejectedValueOnce(new Error('收藏失败：network'))
    collect(CARD, 'desktop')
    await flush()
    collect(CARD, 'desktop')
    await flush()
    const nths = mockTrack.mock.calls
      .filter((c) => c[0] === 'flow.phrase_collected')
      .map((c) => (c[1] as { nth: number }).nth)
    expect(nths).toEqual([1, 2])
  })

  test('🔴 埋点 props 里不出现被收藏句子的任何一个字', async () => {
    const { collect } = setup()
    collect(CARD, 'mobile')
    await flush()
    const dumped = JSON.stringify(mockTrack.mock.calls)
    for (const secret of ['妈妈', 'mum', 'quarrel', 'argument']) expect(dumped).not.toContain(secret)
  })
})

describe('收藏失败路径 —— 本次修复的核心红线', () => {
  test('addSavedPhrase 抛错：onSaved【一次都不许被调用】，且给出可见提示', async () => {
    mockAdd.mockRejectedValue(new Error('收藏失败：new row violates row-level security policy'))
    const { collect, onSaved, onFailed } = setup()
    collect(CARD, 'mobile')
    await flush()
    expect(onSaved).not.toHaveBeenCalled()
    expect(onFailed).toHaveBeenCalledTimes(1)
    expect(onFailed).toHaveBeenCalledWith(COLLECT_FAILED_MESSAGE)
    // 没落库就不该失效收藏缓存（白刷一次列表请求）
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(mockTrack).toHaveBeenCalledWith('flow.phrase_collect_failed', { reason: 'insert_failed', view: 'mobile' })
  })

  test('拿不到会话：归因 session_failed，且压根不尝试 insert', async () => {
    mockEnsureSession.mockRejectedValue(new Error('匿名登录失败：storage disabled'))
    const { collect, onSaved, onFailed } = setup()
    collect(CARD, 'desktop')
    await flush()
    expect(onSaved).not.toHaveBeenCalled()
    expect(onFailed).toHaveBeenCalledWith(COLLECT_FAILED_MESSAGE)
    expect(mockAdd).not.toHaveBeenCalled()
    expect(mockTrack).toHaveBeenCalledWith('flow.phrase_collect_failed', { reason: 'session_failed', view: 'desktop' })
  })

  test('🔴 失败提示不回显后端 error.message 原文（可能含身份信息）', async () => {
    mockAdd.mockRejectedValue(new Error('收藏失败：JWT expired for a@b.com'))
    const { collect, onFailed } = setup()
    collect(CARD, 'mobile')
    await flush()
    const shown = String(onFailed.mock.calls[0][0])
    expect(shown).not.toContain('a@b.com')
    expect(shown).not.toContain('JWT')
    // 埋点侧同理：只走 code，不带原文
    expect(JSON.stringify(mockTrack.mock.calls)).not.toContain('a@b.com')
  })
})

describe('埋点绝不反噬主链路', () => {
  test('track 同步抛错：成功仍算成功（onSaved 一次、不弹失败提示）', async () => {
    mockTrack.mockImplementation(() => { throw new Error('埋点炸了') })
    const { collect, onSaved, onFailed } = setup()
    collect(CARD, 'mobile')
    await flush()
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onFailed).not.toHaveBeenCalled()
  })

  test('缓存刷新失败不算收藏失败（落库已成功，不许倒过来吓用户）', async () => {
    mockRefresh.mockRejectedValue(new Error('SWR mutate failed'))
    const { collect, onSaved, onFailed } = setup()
    collect(CARD, 'mobile')
    await flush()
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onFailed).not.toHaveBeenCalled()
  })
})
