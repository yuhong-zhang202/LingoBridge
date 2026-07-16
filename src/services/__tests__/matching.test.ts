/**
 * @module   matching.test
 * @desc     matchByStory 三层漏斗 + 相关性排名单元测试 — 全部依赖 mock 掉
 * @author   LingoBridge
 * @created  2026-06-17
 */
jest.mock('server-only', () => ({}))
jest.mock('@/services/extraction')
jest.mock('@/services/ranking')
jest.mock('@/lib/db/questions')
jest.mock('@/lib/db/observation-points')

import { matchByStory } from '@/services/matching'
import { extractCorpus } from '@/services/extraction'
import { rankQuestions } from '@/services/ranking'
import { getQuestionsByObservation } from '@/lib/db/questions'
import { listObservationPoints } from '@/lib/db/observation-points'

const mockExtract  = extractCorpus as jest.MockedFunction<typeof extractCorpus>
const mockRank     = rankQuestions as jest.MockedFunction<typeof rankQuestions>
const mockGetQs    = getQuestionsByObservation as jest.MockedFunction<typeof getQuestionsByObservation>
const mockListPts  = listObservationPoints as jest.MockedFunction<typeof listObservationPoints>

// —— 测试用桩 ——
const STORY = '上周末我去公园散步，待了很久就放松下来了。'

function makeQ(id: string, part: 1 | 2 | 3) {
  // 字段集对齐 QuestionWithMatchTag（仅前几个字段会被 matching.ts 实际读取，其余给默认值满足类型）
  return {
    id,
    part,
    question_text: `${id}-text`,
    question_text_zh: `${id}-zh`,
    cue_card_title: null,
    cue_card_title_zh: null,
    is_new: false,
    topic_only: false,
    topic: '',
    parent_card_id: null,
    created_at: '2026-01-01T00:00:00Z',
    observation_points: [],
    isPrimaryMatch: false,
  }
}

function makePoint(code: string, name: string, dimensionId: 'emotion' | 'space' | 'value' | 'relationship') {
  return { id: `id-${code}`, code, name, dimensionId, layer: 'state' as const, mappedQuestionCount: 0, richThreshold: 0, sortOrder: 0 }
}
// 必须覆盖用例里会被走到的全部 code——含 OBSERVATION_ADJACENCY 中 SPA_03 / VAL_01 的邻居。
// toMatchedPoint 对 DB 里查无此 code 的观察点一律返回 null（不再捏造维度兜底），
// 桩缺一个 code 就等于在测「DB 漂移」而非测漏斗，会误伤邻居增援用例。
const POINTS = [
  makePoint('EMO_01', '放松的事',     'emotion'),
  makePoint('SPA_03', '自然的地方',   'space'),
  makePoint('VAL_01', '公平感与正义', 'value'),
  makePoint('REL_11', '冲突/道歉',    'relationship'),
  // SPA_03 的邻居
  makePoint('SPA_01', '居住空间',     'space'),
  makePoint('SPA_04', '公共空间',     'space'),
  makePoint('SPA_02', '日常移动',     'space'),
  // VAL_01 的邻居（REL_11 已在上面）
  makePoint('VAL_03', '价值原则',     'value'),
  makePoint('VAL_02', '诚实与信任',   'value'),
]

beforeEach(() => {
  jest.clearAllMocks()
  mockListPts.mockResolvedValue(POINTS)
})

describe('matchByStory · 三层漏斗', () => {
  test('1. 第一层命中 + secondary 补充：按 rank 降序，primary 题 isPrimaryMatch=true', async () => {
    mockExtract.mockResolvedValue({
      primary:   { pointCode: 'SPA_03', reason: 'r1' },
      secondary: { pointCode: 'EMO_01', reason: 'r2' },
    })
    const q1 = makeQ('q1', 2)
    const q2 = makeQ('q2', 3)
    const q3 = makeQ('q3', 1)
    mockGetQs.mockImplementation(async (code) => {
      if (code === 'SPA_03') return [q1, q2]
      if (code === 'EMO_01') return [q3]
      return []
    })
    mockRank.mockResolvedValue([
      { id: 'q3', score: 90, reason: 'best' },
      { id: 'q1', score: 70, reason: 'mid' },
      { id: 'q2', score: 40, reason: 'low' },
    ])

    const r = await matchByStory(STORY)

    expect(r.noMatch).toBe(false)
    expect(r.matchedViaSecondary).toBe(false)
    expect(r.count).toBe(3)
    expect(r.questions.map(q => q.id)).toEqual(['q3', 'q1', 'q2'])  // 按分数降序
    const byId = new Map(r.questions.map(q => [q.id, q]))
    expect(byId.get('q1')!.isPrimaryMatch).toBe(true)
    expect(byId.get('q2')!.isPrimaryMatch).toBe(true)
    expect(byId.get('q3')!.isPrimaryMatch).toBe(false)  // 来自 secondary 补充
    expect(byId.get('q3')!.relevanceScore).toBe(90)
    expect(r.primary?.dimension).toBe('空间感知')
    expect(r.secondary?.dimension).toBe('情绪内核')
  })

  test('2. 第二层借道：primary 无题 → secondary 命中，matchedViaSecondary=true', async () => {
    mockExtract.mockResolvedValue({
      primary:   { pointCode: 'VAL_01', reason: 'r1' },
      secondary: { pointCode: 'REL_11', reason: 'r2' },
    })
    const q = makeQ('qA', 2)
    mockGetQs.mockImplementation(async (code) => {
      if (code === 'VAL_01') return []
      if (code === 'REL_11') return [q]
      return []
    })
    mockRank.mockResolvedValue([{ id: 'qA', score: 80, reason: 'ok' }])

    const r = await matchByStory(STORY)

    expect(r.noMatch).toBe(false)
    expect(r.matchedViaSecondary).toBe(true)
    expect(r.questions).toHaveLength(1)
    expect(r.questions[0].id).toBe('qA')
    expect(r.questions[0].isPrimaryMatch).toBe(false)
    // 借道时 getQuestionsByObservation 用 includeSec=true 调一次
    expect(mockGetQs).toHaveBeenCalledWith('REL_11', true)
  })

  test('3a. 第三层 noMatch：primary 无题且无 secondary', async () => {
    mockExtract.mockResolvedValue({
      primary:   { pointCode: 'VAL_01', reason: 'r' },
      secondary: null,
    })
    mockGetQs.mockResolvedValue([])

    const r = await matchByStory(STORY)

    expect(r.noMatch).toBe(true)
    expect(r.questions).toEqual([])
    expect(r.count).toBe(0)
    expect(r.matchedViaSecondary).toBe(false)
    // 三层全空（主/副/邻居皆无题）：邻居兜底也未命中
    expect(r.matchedViaNeighbor).toBe(false)
    expect(r.neighborPointsUsed).toEqual([])
    // 候选为空时不应调排名
    expect(mockRank).not.toHaveBeenCalled()
  })

  test('3b. 第三层 noMatch：primary 与 secondary 都查到空', async () => {
    mockExtract.mockResolvedValue({
      primary:   { pointCode: 'VAL_01', reason: 'r1' },
      secondary: { pointCode: 'REL_11', reason: 'r2' },
    })
    mockGetQs.mockResolvedValue([])

    const r = await matchByStory(STORY)

    expect(r.noMatch).toBe(true)
    expect(r.questions).toEqual([])
    expect(r.matchedViaSecondary).toBe(false)
    expect(mockRank).not.toHaveBeenCalled()
  })

  test('4. 排名降级（空数组）：题目保留，relevanceScore 为 undefined；primary 题优先、再按 part', async () => {
    mockExtract.mockResolvedValue({
      primary:   { pointCode: 'SPA_03', reason: 'r1' },
      secondary: { pointCode: 'EMO_01', reason: 'r2' },
    })
    const q1 = makeQ('q1', 3)  // primary, part 3
    const q2 = makeQ('q2', 2)  // primary, part 2
    const q3 = makeQ('q3', 1)  // secondary 补充, part 1
    mockGetQs.mockImplementation(async (code) => {
      if (code === 'SPA_03') return [q1, q2]
      if (code === 'EMO_01') return [q3]
      return []
    })
    mockRank.mockResolvedValue([])

    const r = await matchByStory(STORY)

    expect(r.questions).toHaveLength(3)
    for (const q of r.questions) {
      expect(q.relevanceScore).toBeUndefined()
    }
    // primary 题优先（q2、q1），part 升序内部排序；secondary（q3）末尾
    expect(r.questions.map(q => q.id)).toEqual(['q2', 'q1', 'q3'])
  })

  test('5. 排名乱序 → 输出按 score 降序', async () => {
    mockExtract.mockResolvedValue({
      primary:   { pointCode: 'SPA_03', reason: 'r1' },
      secondary: { pointCode: 'EMO_01', reason: 'r2' },
    })
    const q1 = makeQ('q1', 2)
    const q2 = makeQ('q2', 3)
    const q3 = makeQ('q3', 1)
    mockGetQs.mockImplementation(async (code) => {
      if (code === 'SPA_03') return [q1, q2]
      if (code === 'EMO_01') return [q3]
      return []
    })
    mockRank.mockResolvedValue([
      { id: 'q1', score: 55, reason: '' },
      { id: 'q3', score: 95, reason: '' },
      { id: 'q2', score: 75, reason: '' },
    ])

    const r = await matchByStory(STORY)

    expect(r.questions.map(q => q.id)).toEqual(['q3', 'q2', 'q1'])
    expect(r.questions.map(q => q.relevanceScore)).toEqual([95, 75, 55])
  })

  test('6. 第三层邻居兜底：主/副皆空 → 借相邻观察点命中，matchedViaNeighbor=true、noMatch=false', async () => {
    mockExtract.mockResolvedValue({
      primary:   { pointCode: 'VAL_01', reason: 'r' },  // 邻居表 VAL_01: [REL_11, VAL_03, VAL_02]
      secondary: null,
    })
    const qN = makeQ('qN', 2)
    mockGetQs.mockImplementation(async (code) => {
      if (code === 'REL_11') return [qN]  // 首位邻居有题；主观察点 VAL_01 及其余邻居皆空
      return []
    })
    mockRank.mockResolvedValue([{ id: 'qN', score: 70, reason: 'nb' }])

    const r = await matchByStory(STORY)

    expect(r.noMatch).toBe(false)
    expect(r.matchedViaSecondary).toBe(false)
    expect(r.matchedViaNeighbor).toBe(true)
    expect(r.questions.map(q => q.id)).toEqual(['qN'])
    expect(r.questions[0].isPrimaryMatch).toBe(false)  // 邻居题不算主命中
    expect(r.neighborPointsUsed.map(p => p.pointCode)).toContain('REL_11')
    // 邻居借道用 includeSec=true
    expect(mockGetQs).toHaveBeenCalledWith('REL_11', true)
  })

  test('7. 邻居增援（召回不足补足）：L1 只召回 2 道（<NEIGHBOR_MIN=3）→ 借邻居补题，matchedViaNeighbor=true', async () => {
    mockExtract.mockResolvedValue({
      primary:   { pointCode: 'SPA_03', reason: 'r' },  // 邻居表 SPA_03: [SPA_01, SPA_04, SPA_02]
      secondary: null,
    })
    const q1 = makeQ('q1', 1)
    const q2 = makeQ('q2', 1)
    const n1 = makeQ('n1', 2)
    const n2 = makeQ('n2', 2)
    mockGetQs.mockImplementation(async (code) => {
      if (code === 'SPA_03') return [q1, q2]  // L1 主观察点仅 2 道（<3）
      if (code === 'SPA_01') return [n1, n2]  // 首位邻居补 2 道 → 共 4
      return []
    })
    mockRank.mockResolvedValue([
      { id: 'q1', score: 90, reason: '' },
      { id: 'n1', score: 80, reason: '' },
      { id: 'q2', score: 70, reason: '' },
      { id: 'n2', score: 60, reason: '' },
    ])

    const r = await matchByStory(STORY)

    expect(r.noMatch).toBe(false)
    expect(r.matchedViaSecondary).toBe(false)
    expect(r.matchedViaNeighbor).toBe(true)          // 召回不足触发了邻居补题
    expect(r.count).toBe(4)                           // 2 主 + 2 邻居（seen 去重生效）
    expect(r.neighborPointsUsed.map(p => p.pointCode)).toEqual(['SPA_01'])
    const byId = new Map(r.questions.map(q => [q.id, q]))
    expect(byId.get('q1')!.isPrimaryMatch).toBe(true)   // 主题保持主命中
    expect(byId.get('n1')!.isPrimaryMatch).toBe(false)  // 邻居题非主命中
  })
})

describe('matchByStory · 观察点元信息二道网（DB 漂移时不许捏造维度）', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('11. primary 的 code 在 DB 查无此点：显式 error + 走 noMatch，绝不捏造「情绪内核」', async () => {
    // 模拟 prompt 清单与 DB observation_points 漂移（extraction 放行了 DB 里没有的 code）
    mockExtract.mockResolvedValue({ primary: { pointCode: 'EMO_99', reason: 'r' }, secondary: null })
    mockGetQs.mockResolvedValue([])

    const r = await matchByStory(STORY)

    expect(console.error).toHaveBeenCalledWith(
      '[Matching] 观察点 code 在 DB observation_points 中不存在，已按「无此观察点」处理',
      expect.objectContaining({ pointCode: 'EMO_99' }),
    )
    expect(r.primary).toBeNull()        // 不返回捏造的 MatchedPoint
    expect(r.noMatch).toBe(true)        // 如实走温柔收尾，而非拿假维度骗用户
    expect(r.questions).toEqual([])
  })

  test('12. secondary 的 code 查无此点：primary 正常，secondary 置空而非捏造', async () => {
    mockExtract.mockResolvedValue({
      primary:   { pointCode: 'SPA_03', reason: 'r1' },
      secondary: { pointCode: 'ZZZ_42', reason: 'r2' },
    })
    mockGetQs.mockImplementation(async (code) => (code === 'SPA_03' ? [makeQ('q1', 1), makeQ('q2', 1), makeQ('q3', 1)] : []))
    mockRank.mockResolvedValue([
      { id: 'q1', score: 90, reason: 'a' }, { id: 'q2', score: 80, reason: 'b' }, { id: 'q3', score: 70, reason: 'c' },
    ])

    const r = await matchByStory(STORY)

    expect(r.secondary).toBeNull()
    expect(r.primary?.dimension).toBe('空间感知')  // 合法的那个不受影响
    expect(r.count).toBe(3)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('观察点 code 在 DB observation_points 中不存在'),
      expect.objectContaining({ pointCode: 'ZZZ_42' }),
    )
  })

  test('13. 合法 code：维度取自 DB，无任何 error（正常路径未被影响）', async () => {
    mockExtract.mockResolvedValue({
      primary:   { pointCode: 'VAL_01', reason: 'r1' },
      secondary: { pointCode: 'REL_11', reason: 'r2' },
    })
    mockGetQs.mockImplementation(async (code) => (code === 'VAL_01' ? [makeQ('q1', 1), makeQ('q2', 1), makeQ('q3', 1)] : []))
    mockRank.mockResolvedValue([
      { id: 'q1', score: 90, reason: 'a' }, { id: 'q2', score: 80, reason: 'b' }, { id: 'q3', score: 70, reason: 'c' },
    ])

    const r = await matchByStory(STORY)

    expect(r.primary).toEqual({ pointCode: 'VAL_01', pointName: '公平感与正义', dimension: '价值底色', reason: 'r1' })
    expect(r.secondary?.dimension).toBe('人际羁绊')
    expect(console.error).not.toHaveBeenCalled()
  })
})

describe('matchByStory · 重排回填的 id 集合校验（第二道网）', () => {
  /** 三题都来自 SPA_03 的标准场景，供本组各用例复用 */
  function arrange(): void {
    mockExtract.mockResolvedValue({ primary: { pointCode: 'SPA_03', reason: 'r' }, secondary: null })
    mockGetQs.mockImplementation(async (code) => (code === 'SPA_03' ? [makeQ('q1', 1), makeQ('q2', 1), makeQ('q3', 1)] : []))
  }

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('8. 不在候选中的 id：显式 error 并丢弃，不静默', async () => {
    arrange()
    mockRank.mockResolvedValue([
      { id: 'q1', score: 90, reason: 'a' },
      { id: 'q2', score: 80, reason: 'b' },
      { id: 'q3', score: 70, reason: 'c' },
      { id: 'ghost', score: 99, reason: '幽灵题' },
    ])

    const r = await matchByStory(STORY)

    expect(console.error).toHaveBeenCalledWith('[Matching] 重排返回了不在候选中的 id，已丢弃', { id: 'ghost' })
    expect(r.questions.map(q => q.id)).toEqual(['q1', 'q2', 'q3'])
    expect(r.questions.map(q => q.relevanceScore)).toEqual([90, 80, 70])
  })

  test('9. 重复 id：显式 error，保留首次而非让后者静默覆盖', async () => {
    arrange()
    mockRank.mockResolvedValue([
      { id: 'q1', score: 90, reason: '首次' },
      { id: 'q1', score: 10, reason: '重复' },
      { id: 'q2', score: 80, reason: 'b' },
      { id: 'q3', score: 70, reason: 'c' },
    ])

    const r = await matchByStory(STORY)

    expect(console.error).toHaveBeenCalledWith(
      '[Matching] 重排返回重复 id，保留首次、丢弃后续',
      { id: 'q1', kept: 90, dropped: 10 },
    )
    const byId = new Map(r.questions.map(q => [q.id, q]))
    expect(byId.get('q1')!.relevanceScore).toBe(90)
    expect(byId.get('q1')!.relevanceReason).toBe('首次')
  })

  test('10. 缺失 id：显式 warn 并列出缺哪些，不静默留 undefined', async () => {
    arrange()
    mockRank.mockResolvedValue([{ id: 'q1', score: 90, reason: 'a' }])

    const r = await matchByStory(STORY)

    expect(console.warn).toHaveBeenCalledWith(
      '[Matching] 部分候选题未拿到重排分（将按未打分展示）',
      { missingCount: 2, totalCandidates: 3, missingIds: ['q2', 'q3'] },
    )
    const byId = new Map(r.questions.map(q => [q.id, q]))
    expect(byId.get('q2')!.relevanceScore).toBeUndefined()
  })
})
