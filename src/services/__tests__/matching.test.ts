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
const POINTS = [
  makePoint('EMO_01', '放松的事',     'emotion'),
  makePoint('SPA_03', '自然的地方',   'space'),
  makePoint('VAL_01', '公平感与正义', 'value'),
  makePoint('REL_11', '冲突/道歉',    'relationship'),
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
})
