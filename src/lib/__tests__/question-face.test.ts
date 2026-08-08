/**
 * @module   question-face.test
 * @desc     事故守卫③（【行为】测试）：questionFace 对 Part2 cue card 的题面拼装。
 *
 *           守的是哪次事故：旧逻辑是 `cue_card_title ?? question_text`。Part2 的完整题面
 *           （"You should say" 那几条约束 bullet）存在 question_text 里，而 cue_card_title 只是个裸标题；
 *           `??` 在 title 非空时短路，于是【喂给重排模型和盲标标注人的题面，把约束整段丢了】。
 *           后果是方向恒定的：模型看到「一个经常帮助别人的人」，看不到「how often / 经常」这条约束，
 *           凡是沾边的故事都像能答 → Part2 系统性虚高。而且线上判据与金标题面同源，两边一起偏，
 *           金标分数看不出异常。
 *
 *           2026-08-06 架构审计把本函数改回旧形态，全量 790 条测试一条不红。
 *
 *           断言支点刻意选「en 必须完整含住 question_text」而不是比对某个拼好的字符串：
 *           分隔符怎么写是格式问题（改了不该红），约束 bullet 丢没丢才是事故（改了必须红）。
 *
 *           边界（诚实标注）：本文件只管「题面里有没有约束」。约束回到题面后模型是否真的据此压分，
 *           属重排质量，归金标回归（scripts/eval）管，不是单测能证的事。
 * @author   LingoBridge
 * @created  2026-08-08
 */
import { questionFace } from '@/lib/question-face'

/**
 * 一道 Part2 cue card —— 字段值【逐字取自真实题库行】（supabase/seed_questions.sql:236），
 * 不是我编的形状：换季导入把 JSON 的 title 写进 cue_card_title、cue_text 写进 question_text
 * （scripts/import-season.ts:211-215），所以「裸标题 vs 带约束的完整题面」这个分工在库里就是这样。
 */
const PART2 = {
  question_text:
    'Describe a person who solved a problem in a smart way. You should say: who he / she is ' +
    'what the problem was how he or she solved it And explain why you think he / she did it in a smart way.',
  question_text_zh: null,
  cue_card_title: 'A Person Who Solved a Problem',
  cue_card_title_zh: '一个聪明解决问题的人',
}

/** 一道 Part1/3 题：没有 cue card，题面本身就是全部 */
const PART1 = {
  question_text: 'Do you prefer typing or handwriting?',
  question_text_zh: '你更喜欢打字还是手写？',
  cue_card_title: null,
  cue_card_title_zh: null,
}

describe('questionFace【行为】Part2 的约束 bullet 一个字都不许丢', () => {
  it('英文题面必须完整含住 question_text（旧逻辑 `cue_card_title ?? question_text` 会在这里整段丢掉）', () => {
    expect(questionFace(PART2).en).toContain(PART2.question_text)
  })

  it('那句决定分数的约束（in a smart way）必须还在题面里 —— 丢了它，任何「解决过问题」的故事都像能答', () => {
    // 裸标题是「A Person Who Solved a Problem」，约束「smart」只存在于 question_text。
    // 这一个词就是 Part2 虚高的直接成因：没有它，模型的尺子会松一整档。
    expect(questionFace(PART2).en).toContain('in a smart way')
  })

  it('标题也要在，且在完整题面之前（标题 + 完整题面，不是二选一）', () => {
    const { en } = questionFace(PART2)
    expect(en).toContain(PART2.cue_card_title)
    expect(en.indexOf(PART2.cue_card_title)).toBeLessThan(en.indexOf('You should say'))
  })

  it('中文侧：DB 暂无中文 bullet（question_text_zh 为 null）时退回中文标题，而不是空串', () => {
    expect(questionFace(PART2).zh).toBe(PART2.cue_card_title_zh)
  })

  it('中文侧：中文题面存在时同样是「标题 + 完整题面」，不会短路掉其中任何一半', () => {
    const zhFull = { ...PART2, question_text_zh: '描述一个经常帮助别人的人。你应该说：他多久帮一次……' }
    const { zh } = questionFace(zhFull)
    expect(zh).toContain(PART2.cue_card_title_zh)
    expect(zh).toContain(zhFull.question_text_zh)
  })
})

describe('questionFace【行为】Part1/3 行为与旧逻辑一字不差', () => {
  it('无 cue_card_title → 英文题面就是 question_text 本身（不加任何前缀/分隔符）', () => {
    expect(questionFace(PART1).en).toBe(PART1.question_text)
  })

  it('无 cue_card_title_zh → 中文题面就是 question_text_zh 本身', () => {
    expect(questionFace(PART1).zh).toBe(PART1.question_text_zh)
  })

  it('中文题面缺失 → 空串（下游按「没有中文」处理，不是 null 也不是 "null"）', () => {
    expect(questionFace({ ...PART1, question_text_zh: null }).zh).toBe('')
  })
})
