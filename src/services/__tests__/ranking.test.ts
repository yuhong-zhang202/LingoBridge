/**
 * @module   ranking.test
 * @desc     rankQuestions 的「防错位」单元测试 —— 短序号 join key、题干回显对齐校验、
 *           错位/编造/重复/漏题的处置。用例直接复刻线上实证的两起错位（S012 休息↔明天有空、
 *           S056 拍照↔景色），确保这两类模型错位不会再被静默接受。LLM 调用全部 mock。
 * @author   LingoBridge
 * @created  2026-07-16
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/env-server', () => ({
  env: {
    dashscopeApiKey: 'test-key',
    dashscopeBaseUrl: 'https://example.invalid/v1',
    rawLogEnabled: false,
  },
}))
jest.mock('@/lib/llm')

import { rankQuestions, type CandidateQuestion } from '@/services/ranking'
import { callLLMJson, type CallLLMJsonOptions } from '@/lib/llm'

const mockCall = callLLMJson as jest.MockedFunction<typeof callLLMJson>

// —— 测试用桩：两道语义相近的题（线上 S056 实证错位的那一对）——
const UUID_PHOTO   = '95563aa8-0000-4000-8000-000000000001'
const UUID_SCENERY = '96570995-0000-4000-8000-000000000002'
const EN_PHOTO   = 'Do you like taking photos of different scenery?'
const EN_SCENERY = 'What is the most beautiful scenery you have seen when travelling?'

const CANDIDATES: CandidateQuestion[] = [
  { id: UUID_PHOTO,   en: EN_PHOTO,   zh: '你喜欢拍不同风景的照片吗？',   obs: '风景与旅行' },
  { id: UUID_SCENERY, en: EN_SCENERY, zh: '你旅行时见过最美丽的景色是什么？', obs: '风景与旅行' },
]

const STORY = '用户去年在山里旅行，看到云海铺满山谷，久久说不出话。'

/**
 * 用一份「模型原始输出」驱动被 mock 的 callLLMJson，忠实复刻其真实契约：
 * parse → validate；不过则以同一份 raw 走 fallback（真实实现重试后拿首份 raw 兜底）。
 * @param raws  模型两次尝试的原始输出；只传一份表示重试后仍返回同样内容
 * @returns     捕获到的 options（供断言 prompt 内容）
 */
function driveWith(raws: string[]): {
  seenUserMessage: () => string
  seenOpts: () => CallLLMJsonOptions<unknown>
} {
  let userMessage = ''
  let seen: CallLLMJsonOptions<unknown>
  mockCall.mockImplementation(async (opts: CallLLMJsonOptions<unknown>) => {
    seen = opts
    const msgs = opts.call.messages
    userMessage = msgs[msgs.length - 1].content
    for (const raw of raws) {
      const parsed: unknown = JSON.parse(raw)
      if (opts.validate(parsed)) return parsed
    }
    // 复刻真实契约：轮次用尽后 fallback 拿到的是【最后一轮】的 raw
    if (opts.fallback) return opts.fallback(raws[raws.length - 1], raws[raws.length - 1])
    throw new Error('validate 未通过且无 fallback')
  })
  return { seenUserMessage: () => userMessage, seenOpts: () => seen }
}

/** 造 n 道互不相同的候选题（用于超时预算随规模线性增长的断言） */
function manyCandidates(n: number): CandidateQuestion[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `uuid-${i}`,
    en: `Question number ${i} about something quite distinct here?`,
    zh: `第 ${i} 题`,
    obs: '某观察点',
  }))
}

/** 造一份合法（对齐正确）的模型输出 */
function goodRaw(): string {
  return JSON.stringify({
    scores: [
      { id: 'q2', q: 'What is the most beautiful scenery you', score: 92, reason: '故事正好讲旅行看到的景色。' },
      { id: 'q1', q: 'Do you like taking photos of different', score: 55, reason: '故事没提拍照习惯，要换个故事。' },
    ],
  })
}

/** 造一份「score+reason 整体互换」的模型输出：id 集合仍然合法，只有 q 回显能抓到 */
function swappedRaw(): string {
  return JSON.stringify({
    scores: [
      // q1（拍照题）的 id 上，贴的却是景色题的判词与分数
      { id: 'q1', q: 'What is the most beautiful scenery you', score: 92, reason: '故事正好讲旅行看到的景色。' },
      { id: 'q2', q: 'Do you like taking photos of different', score: 55, reason: '故事没提拍照习惯，要换个故事。' },
    ],
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('rankQuestions · join key 与 prompt', () => {
  test('1. 喂给模型的是短序号 q1/q2，36 位 UUID 一个都不出现', async () => {
    const probe = driveWith([goodRaw()])
    await rankQuestions(STORY, CANDIDATES)

    const sent = probe.seenUserMessage()
    expect(sent).toContain('"id": "q1"')
    expect(sent).toContain('"id": "q2"')
    expect(sent).not.toContain(UUID_PHOTO)
    expect(sent).not.toContain(UUID_SCENERY)
  })

  test('2. 正常路径：短序号按顺序映射回真实 UUID，分数/理由各归各题', async () => {
    driveWith([goodRaw()])
    const r = await rankQuestions(STORY, CANDIDATES)

    expect(r).toEqual([
      { id: UUID_SCENERY, score: 92, reason: '故事正好讲旅行看到的景色。' },
      { id: UUID_PHOTO,   score: 55, reason: '故事没提拍照习惯，要换个故事。' },
    ])
  })

  test('3. 候选为空 / 无 API key 时不调模型', async () => {
    driveWith([goodRaw()])
    await expect(rankQuestions(STORY, [])).resolves.toEqual([])
    expect(mockCall).not.toHaveBeenCalled()
  })
})

describe('rankQuestions · 超时预算与重问轮数', () => {
  test('16. 超时按候选数标定，绝不吃 llm.ts 的 30s 默认值', async () => {
    // 实测标定：7 道 ≈ 11s、35 道 ≈ 20s；预算须留足余量
    const cases: [number, number][] = [
      [2, 15_000 + 1_500 * 2],    // 18s
      [7, 15_000 + 1_500 * 7],    // 25.5s —— 实测 11s，2.3× 余量
      [35, 15_000 + 1_500 * 35],  // 67.5s —— 实测 20s，3.4× 余量；旧的 30s 默认值正是在此处 abort
    ]
    for (const [n, expected] of cases) {
      const probe = driveWith([JSON.stringify({ scores: [] })])
      await rankQuestions(STORY, manyCandidates(n))
      expect(probe.seenOpts().timeoutMs).toBe(expected)
    }
  })

  test('17. 35 道候选的预算（67.5s）远高于旧默认（30s）—— 全挂 6 个故事的根因已消除', async () => {
    const probe = driveWith([JSON.stringify({ scores: [] })])
    await rankQuestions(STORY, manyCandidates(35))

    expect(probe.seenOpts().timeoutMs).toBe(67_500)
    expect(probe.seenOpts().timeoutMs!).toBeGreaterThan(30_000)
  })

  // 2026-07-20：3 → 2。轮数乘在超时预算上（14 道候选单轮 36s），三轮全超时用户要干等 108 秒。
  // 这条断言的意义是钉死「轮数不许悄悄调大」——调大就等于把最坏等待时间成倍放给用户。
  test('18. 重问轮数为 2（整批重问，尺子不变；轮数乘超时预算，不许调大）', async () => {
    const probe = driveWith([goodRaw()])
    await rankQuestions(STORY, CANDIDATES)
    expect(probe.seenOpts().maxAttempts).toBe(2)
  })
})

describe('rankQuestions · 2 轮用尽后仍缺题', () => {
  test('19. 缺的题保持无分，但必须打 error 点名是哪几道，绝不静默', async () => {
    // 2 轮整批重问后模型始终只交出 q2，q1 一直缺
    const raw = JSON.stringify({
      scores: [{ id: 'q2', q: 'What is the most beautiful scenery you', score: 92, reason: 'b' }],
    })
    driveWith([raw])
    const r = await rankQuestions(STORY, CANDIDATES)

    expect(r).toEqual([{ id: UUID_SCENERY, score: 92, reason: 'b' }])  // 缺的那道不给分
    expect(console.error).toHaveBeenCalledWith(
      '[Ranking] 已用尽 2 轮整批重问，仍有候选题拿不到可信打分，这些题将不展示分数',
      expect.objectContaining({
        attempts: 2,
        totalCandidates: 2,
        missingCount: 1,
        missingQuestions: [{ seq: 'q1', en: expect.stringContaining('Do you like taking photos') }],
      }),
    )
  })
})

describe('rankQuestions · 错位防线（核心）', () => {
  test('4. 判词整体互换（S056 拍照↔景色复刻）：validate 拒收 → 触发重试', async () => {
    driveWith([swappedRaw(), goodRaw()])
    const r = await rankQuestions(STORY, CANDIDATES)

    // 重试拿到正确输出，最终结果自洽：景色题拿景色判词
    expect(r).toEqual([
      { id: UUID_SCENERY, score: 92, reason: '故事正好讲旅行看到的景色。' },
      { id: UUID_PHOTO,   score: 55, reason: '故事没提拍照习惯，要换个故事。' },
    ])
    expect(console.error).toHaveBeenCalledWith(
      '[Ranking] 打分与候选题对齐校验未通过',
      expect.objectContaining({ problems: expect.arrayContaining([expect.stringContaining('题干回显对不上')]) }),
    )
  })

  test('5. 互换且重试仍互换：错位条目全部丢弃，绝不把判词贴到错的题上', async () => {
    driveWith([swappedRaw()])
    const r = await rankQuestions(STORY, CANDIDATES)

    // 两条都对不上 → 两条都丢 → 宁可无分（调用方按未打分展示）
    expect(r).toEqual([])
  })

  test('6. 错位报告能指出「对家是谁」，便于复盘两两互换', async () => {
    driveWith([swappedRaw()])
    await rankQuestions(STORY, CANDIDATES)

    const problems = (console.error as jest.Mock).mock.calls
      .map((c) => c[1] as { problems?: string[] })
      .find((p) => Array.isArray(p.problems))?.problems
    expect(problems?.join('\n')).toContain('疑似两题判词互换')
  })

  test('7. 单纯 id 集合校验抓不到的互换，这里能抓到（回归护栏）', async () => {
    // 互换输出的 id 集合 == 候选 id 集合、无重复、无缺失 —— 仅靠集合校验必然放行
    const ids = (JSON.parse(swappedRaw()) as { scores: { id: string }[] }).scores.map((s) => s.id)
    expect(new Set(ids)).toEqual(new Set(['q1', 'q2']))

    driveWith([swappedRaw()])
    expect(await rankQuestions(STORY, CANDIDATES)).toEqual([])
  })
})

describe('rankQuestions · 其余不合规输出', () => {
  test('8. 编造 id：validate 拒收，该条被丢弃', async () => {
    const raw = JSON.stringify({
      scores: [
        { id: 'q1', q: 'Do you like taking photos of different', score: 55, reason: 'a' },
        { id: 'q2', q: 'What is the most beautiful scenery you', score: 92, reason: 'b' },
        { id: 'q9', q: 'Something that does not exist at all!!', score: 70, reason: 'c' },
      ],
    })
    driveWith([raw])
    const r = await rankQuestions(STORY, CANDIDATES)

    // 抢救路径保留两条对齐的，丢掉编造的 q9
    expect(r.map((s) => s.id).sort()).toEqual([UUID_PHOTO, UUID_SCENERY].sort())
    expect(console.error).toHaveBeenCalledWith('[Ranking] 截断抢救丢弃：编造 id', { id: 'q9' })
  })

  test('9. 重复 id：validate 拒收，后者不再静默覆盖前者', async () => {
    const raw = JSON.stringify({
      scores: [
        { id: 'q1', q: 'Do you like taking photos of different', score: 55, reason: '首次' },
        { id: 'q1', q: 'Do you like taking photos of different', score: 99, reason: '重复' },
        { id: 'q2', q: 'What is the most beautiful scenery you', score: 92, reason: 'b' },
      ],
    })
    driveWith([raw])
    const r = await rankQuestions(STORY, CANDIDATES)

    expect(r.find((s) => s.id === UUID_PHOTO)).toEqual({ id: UUID_PHOTO, score: 55, reason: '首次' })
    expect(console.error).toHaveBeenCalledWith('[Ranking] 截断抢救丢弃：重复 id', { id: 'q1' })
  })

  test('10. 漏题：validate 拒收，缺的题不给分（不静默留 null 混过去）', async () => {
    const raw = JSON.stringify({
      scores: [{ id: 'q2', q: 'What is the most beautiful scenery you', score: 92, reason: 'b' }],
    })
    driveWith([raw])
    const r = await rankQuestions(STORY, CANDIDATES)

    expect(console.error).toHaveBeenCalledWith(
      '[Ranking] 打分与候选题对齐校验未通过',
      expect.objectContaining({ problems: expect.arrayContaining(['漏题：q1 未打分']) }),
    )
    // 抢救路径仍保留那条对齐的；q1 无分，由调用方按未打分处理
    expect(r).toEqual([{ id: UUID_SCENERY, score: 92, reason: 'b' }])
  })

  test('11. 回显过短（如只抄 3 个字符）视为无效回显，不予放行', async () => {
    const raw = JSON.stringify({
      scores: [
        { id: 'q1', q: 'Do', score: 55, reason: 'a' },
        { id: 'q2', q: 'Wh', score: 92, reason: 'b' },
      ],
    })
    driveWith([raw])
    expect(await rankQuestions(STORY, CANDIDATES)).toEqual([])
  })

  test('12. 缺 q 字段（旧格式）：结构守卫直接拒，不会当成合法输出', async () => {
    const raw = JSON.stringify({ scores: [{ id: 'q1', score: 55, reason: 'a' }] })
    driveWith([raw])
    expect(await rankQuestions(STORY, CANDIDATES)).toEqual([])
  })
})

describe('rankQuestions · reason 必须自足（短序号不得漏给用户）', () => {
  /** 线上实证：模型会写「同q5，故事零涉及拍照」——内部编号直接漏到用户可见文案 */
  function laggyRaw(): string {
    return JSON.stringify({
      scores: [
        { id: 'q2', q: 'What is the most beautiful scenery you', score: 82, reason: '故事正好讲旅行看到的景色。' },
        { id: 'q1', q: 'Do you like taking photos of different', score: 40, reason: '同q2，故事零涉及拍照。' },
      ],
    })
  }

  test('13. reason 含候选编号：validate 拒收，触发重试', async () => {
    driveWith([laggyRaw(), goodRaw()])
    const r = await rankQuestions(STORY, CANDIDATES)

    expect(r.map((s) => s.reason)).toEqual(['故事正好讲旅行看到的景色。', '故事没提拍照习惯，要换个故事。'])
    expect(console.error).toHaveBeenCalledWith(
      '[Ranking] 打分与候选题对齐校验未通过',
      expect.objectContaining({ problems: expect.arrayContaining([expect.stringContaining('理由不自足')]) }),
    )
  })

  test('14. 重试仍带编号：分数保留，理由清空——绝不把「同q2」漏给用户', async () => {
    driveWith([laggyRaw()])
    const r = await rankQuestions(STORY, CANDIDATES)

    expect(r).toEqual([
      { id: UUID_SCENERY, score: 82, reason: '故事正好讲旅行看到的景色。' },
      { id: UUID_PHOTO,   score: 40, reason: '' },  // 分数可信，废话理由清空
    ])
    expect(r.some((s) => /\bq\d+\b/.test(s.reason))).toBe(false)
  })

  test('15. 「同上」这类指代同样拦下（该缺陷在改短序号前就存在）', async () => {
    const raw = JSON.stringify({
      scores: [
        { id: 'q2', q: 'What is the most beautiful scenery you', score: 82, reason: '故事正好讲旅行看到的景色。' },
        { id: 'q1', q: 'Do you like taking photos of different', score: 40, reason: '同上，缺拍照相关内容。' },
      ],
    })
    driveWith([raw])
    const r = await rankQuestions(STORY, CANDIDATES)

    expect(r.find((s) => s.id === UUID_PHOTO)!.reason).toBe('')
  })
})
