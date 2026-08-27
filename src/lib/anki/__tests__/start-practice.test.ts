/**
 * @module   anki/start-practice.test
 * @desc     进练习前「结对确认」共享逻辑的单测。钉住三件容易在重构里丢掉的事：
 *           ① 正常路径【必须发出那次 saveAnkiPair】（它是故事流唯一的自动结对动作，漏了就是台账 179 复发）；
 *           ② 撞别的语料（409 bound）时不进练习，改走冲突回调；
 *           ③ 除冲突外任何失败（含抛异常）都静默放行进练习，绝不把用户挡在门外。
 * @author   LingoBridge
 * @created  2026-08-27
 */
import { startPracticeWithPairCheck } from '@/lib/anki/start-practice'
import { saveAnkiPair, type SavePairResult } from '@/lib/anki/cards-client'

jest.mock('@/lib/anki/cards-client', () => ({ saveAnkiPair: jest.fn() }))

const mockSave = saveAnkiPair as jest.MockedFunction<typeof saveAnkiPair>

/** 造一组回调 + 记录调用 */
function callbacks(): { go: jest.Mock; onConflict: jest.Mock } {
  return { go: jest.fn(), onConflict: jest.fn() }
}

beforeEach(() => jest.clearAllMocks())

describe('startPracticeWithPairCheck', () => {
  it('正常路径：发一次结对请求，然后进练习', async () => {
    mockSave.mockResolvedValue({ ok: true })
    const { go, onConflict } = callbacks()
    await startPracticeWithPairCheck({ questionId: 'q1', storyId: 's1', go, onConflict })
    // 🔴 这一句就是台账 179 的守卫：漏了这次调用，素材库会把已有题的语料显示成「还没绑题目」
    expect(mockSave).toHaveBeenCalledWith('q1', 's1')
    expect(go).toHaveBeenCalledTimes(1)
    expect(onConflict).not.toHaveBeenCalled()
  })

  it('缺 questionId / storyId：不发请求，直接放行进练习', async () => {
    const a = callbacks()
    await startPracticeWithPairCheck({ questionId: '', storyId: 's1', ...a })
    const b = callbacks()
    await startPracticeWithPairCheck({ questionId: 'q1', storyId: '', ...b })
    expect(mockSave).not.toHaveBeenCalled()
    expect(a.go).toHaveBeenCalledTimes(1)
    expect(b.go).toHaveBeenCalledTimes(1)
  })

  it('这道题绑着【别的】语料（409 bound）：弹冲突回调、此刻不进练习', async () => {
    mockSave.mockResolvedValue({ ok: false, kind: 'bound', currentCorpus: { id: 'other', summary: '旧语料' } })
    const { go, onConflict } = callbacks()
    await startPracticeWithPairCheck({ questionId: 'q1', storyId: 's1', go, onConflict })
    expect(onConflict).toHaveBeenCalledWith({ id: 'other', summary: '旧语料' })
    expect(go).not.toHaveBeenCalled()
  })

  it('409 但绑的就是当前这段语料：当已绑处理，直接进练习（路由不比对 corpusId，故必须比 id）', async () => {
    mockSave.mockResolvedValue({ ok: false, kind: 'bound', currentCorpus: { id: 's1', summary: null } })
    const { go, onConflict } = callbacks()
    await startPracticeWithPairCheck({ questionId: 'q1', storyId: 's1', go, onConflict })
    expect(onConflict).not.toHaveBeenCalled()
    expect(go).toHaveBeenCalledTimes(1)
  })

  it.each<[string, SavePairResult]>([
    ['匿名 401', { ok: false, kind: 'anon' }],
    ['当日上限 429', { ok: false, kind: 'limit' }],
    ['其他失败', { ok: false, kind: 'error' }],
  ])('%s：静默放行进练习（绝不因副作用把用户挡在练习门外）', async (_label, result) => {
    mockSave.mockResolvedValue(result)
    const { go, onConflict } = callbacks()
    await startPracticeWithPairCheck({ questionId: 'q1', storyId: 's1', go, onConflict })
    expect(go).toHaveBeenCalledTimes(1)
    expect(onConflict).not.toHaveBeenCalled()
  })

  it('请求本身抛异常（网络等）：同样静默放行', async () => {
    mockSave.mockRejectedValue(new Error('boom'))
    const { go, onConflict } = callbacks()
    await startPracticeWithPairCheck({ questionId: 'q1', storyId: 's1', go, onConflict })
    expect(go).toHaveBeenCalledTimes(1)
    expect(onConflict).not.toHaveBeenCalled()
  })
})
