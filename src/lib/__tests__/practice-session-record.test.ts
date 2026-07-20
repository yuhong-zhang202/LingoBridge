/**
 * @module   practice-session-record.test
 * @desc     打卡记录重试守卫 —— 钉死不变式：
 *           ① 首试成功 → 只写一次，不做多余重试；
 *           ② 中途成功 → 立刻停手（不把剩余次数跑完）；
 *           ③ 全失败 → 共 3 次尝试后返回 false（调用方据此提示用户）。
 *           全 mock，不碰真实 Supabase。
 * @author   LingoBridge
 * @created  2026-07-20
 */
jest.mock('@/lib/db/practice-sessions', () => ({ recordPracticeSession: jest.fn() }))

import { retryRecordPracticeSession } from '@/lib/practice-session-record'
import { recordPracticeSession } from '@/lib/db/practice-sessions'

const mockRecord = recordPracticeSession as jest.MockedFunction<typeof recordPracticeSession>

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

/** 跑完整个重试流程（推进假定时器把退避等待全部走完），返回最终结果 */
async function runAll(): Promise<boolean> {
  const p = retryRecordPracticeSession('q1', false)
  await jest.advanceTimersByTimeAsync(10_000)
  return p
}

describe('retryRecordPracticeSession · 重试策略', () => {
  test('首试成功 → 只写一次', async () => {
    mockRecord.mockResolvedValue(undefined)
    await expect(runAll()).resolves.toBe(true)
    expect(mockRecord).toHaveBeenCalledTimes(1)
    expect(mockRecord).toHaveBeenCalledWith('q1', false)
  })

  test('第二次成功 → 停手，不跑第三次', async () => {
    mockRecord
      .mockRejectedValueOnce(new Error('网络抖动'))
      .mockResolvedValueOnce(undefined)
    await expect(runAll()).resolves.toBe(true)
    expect(mockRecord).toHaveBeenCalledTimes(2)
  })

  test('全失败 → 3 次尝试后返回 false（调用方据此提示用户）', async () => {
    mockRecord.mockRejectedValue(new Error('写库失败'))
    await expect(runAll()).resolves.toBe(false)
    expect(mockRecord).toHaveBeenCalledTimes(3)
  })
})
