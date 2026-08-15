/**
 * @module   ranking-face-source.test
 * @desc     事故守卫③的下半截（【行为】测试）：钉的不是 questionFace 的返回值，而是它造成的【后果】——
 *           真正递到重排模型手里的那份候选题面。
 *
 *           事故形态：Part2 的约束 bullet（"You should say" 那几条）只存在 question_text 里；
 *           一旦题面回退成「只有 cue_card_title」，模型看到的是一个没有任何限定条件的裸标题，
 *           凡沾边的故事都像能答 → Part2 分数系统性虚高。这条链路上真正会伤到用户的是
 *           「模型看到了什么」，而不是「函数返回了什么」——所以支点放在 rankQuestionsStreaming 的入参上。
 *
 *           这样一来两种改坏方式都拦得住：① questionFace 自己被改回 `??` 短路；
 *           ② 有人在 matching.ts 的候选组装处绕开 questionFace、重新内联一份题面拼装。
 * @author   LingoBridge
 * @created  2026-08-08
 */
jest.mock('server-only', () => ({}))
jest.mock('@/services/extraction')
jest.mock('@/services/ranking')
jest.mock('@/lib/db/questions')
jest.mock('@/lib/db/observation-points')

import { matchByStory } from '@/services/matching'
import { extractCorpus } from '@/services/extraction'
import { rankQuestionsStreaming, type CandidateQuestion } from '@/services/ranking'
import { getQuestionsByObservation } from '@/lib/db/questions'
import { listObservationPoints } from '@/lib/db/observation-points'
import { questionFace } from '@/lib/question-face'
import { CURRENT_SEASON } from '@/lib/constants'

const mockExtract = extractCorpus as jest.MockedFunction<typeof extractCorpus>
const mockRank    = rankQuestionsStreaming as jest.MockedFunction<typeof rankQuestionsStreaming>
const mockGetQs   = getQuestionsByObservation as jest.MockedFunction<typeof getQuestionsByObservation>
const mockListPts = listObservationPoints as jest.MockedFunction<typeof listObservationPoints>

const STORY = '上周末同事帮我搬家，我挺感激的。'

/**
 * Part2 题面：字段值逐字取自真实题库行（supabase/seed_questions.sql:236）——
 * 裸标题在 cue_card_title，带约束（"in a smart way"）的完整题面在 question_text。
 */
const PART2_TEXT =
  'Describe a person who solved a problem in a smart way. You should say: who he / she is ' +
  'what the problem was how he or she solved it And explain why you think he / she did it in a smart way.'
const PART2_TITLE = 'A Person Who Solved a Problem'

/** 造一道题（字段集对齐 QuestionWithMatchTag，matching.ts 只读其中前几个字段） */
function makeQ(id: string, part: 1 | 2 | 3, extra: Partial<{
  question_text: string
  question_text_zh: string | null
  cue_card_title: string | null
  cue_card_title_zh: string | null
}> = {}) {
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
    season: CURRENT_SEASON,
    created_at: '2026-01-01T00:00:00Z',
    observation_points: [],
    isPrimaryMatch: false,
    ...extra,
  }
}

/** 取本次 matchByStory 递给重排的候选清单 */
function candidatesSentToModel(): CandidateQuestion[] {
  expect(mockRank).toHaveBeenCalledTimes(1)
  return mockRank.mock.calls[0][1]
}

beforeEach(() => {
  jest.clearAllMocks()
  mockListPts.mockResolvedValue([
    { id: 'id-REL_11', code: 'REL_11', name: '冲突/道歉', dimensionId: 'relationship', layer: 'state', richThreshold: 0, sortOrder: 0 },
  ])
  mockExtract.mockResolvedValue({
    primary:   { pointCode: 'REL_11', reason: 'r1' },
    secondary: null,
  })
  mockRank.mockResolvedValue([{ id: 'p2', score: 80, reason: 'ok' }])
})

describe('重排候选题面【行为】Part2 递给模型时必须带着约束 bullet', () => {
  it('候选的 en 完整含住 question_text（回退成裸标题 = 模型看不到 in a smart way 这类限定 → Part2 虚高）', async () => {
    mockGetQs.mockResolvedValue([
      makeQ('p2', 2, { question_text: PART2_TEXT, question_text_zh: null, cue_card_title: PART2_TITLE, cue_card_title_zh: '一个聪明解决问题的人' }),
    ])

    await matchByStory(STORY)

    const [cand] = candidatesSentToModel()
    expect(cand.id).toBe('p2')
    expect(cand.en).toContain(PART2_TEXT)
    expect(cand.en).toContain('in a smart way')
    expect(cand.en).toContain(PART2_TITLE)
  })

  it('Part1/3 递给模型的仍是原题面本身（不该被这套拼装影响）', async () => {
    mockGetQs.mockResolvedValue([makeQ('p1', 1)])
    mockRank.mockResolvedValue([{ id: 'p1', score: 80, reason: 'ok' }])

    await matchByStory(STORY)

    const [cand] = candidatesSentToModel()
    expect(cand.en).toBe('p1-text')
    expect(cand.zh).toBe('p1-zh')
  })
})

describe('重排候选题面【结构】题面只有 questionFace 一个来源', () => {
  // 诚实标注：这一条是同源性检查，不是行为检查 —— questionFace 自己被改回 `??` 时它【不会红】
  // （两边一起变，仍然相等）。它专治另一种改坏方式：有人在 matching.ts 里绕开 questionFace
  // 自拼题面，导致线上判据与盲标表题面分家。行为侧由上面那条 toContain 断言负责。
  it('候选题面与 questionFace 的产出逐字一致（谁在这条链路上另起炉灶重拼题面，这条就红）', async () => {
    const q = makeQ('p2', 2, { question_text: PART2_TEXT, question_text_zh: null, cue_card_title: PART2_TITLE, cue_card_title_zh: '一个聪明解决问题的人' })
    mockGetQs.mockResolvedValue([q])

    await matchByStory(STORY)

    const [cand] = candidatesSentToModel()
    const face = questionFace(q)
    expect({ en: cand.en, zh: cand.zh }).toEqual({ en: face.en, zh: face.zh })
  })
})
