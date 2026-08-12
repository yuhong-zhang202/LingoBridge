/**
 * @module   season-cue-guard.test
 * @desc     换季导入「Part2 题面完整性」守卫的【行为】测试。
 *
 *           守的是哪次事故的另一半：questionFace 那条已经修好、也有 11 条断言守着，但它们全部建立在
 *           「库里的 question_text 真的含着约束」这个前提上，而【这个前提原本没有任何守卫】。
 *           换季导入每年 1/5/9 月各跑一次，只要上游 JSON 的 cue_text 退化成裸标题、或两个字段映射反了，
 *           questionFace 一行代码没改、那 11 条断言全绿，而模型看到的题面照样丢约束、Part2 照样虚高。
 *
 *           正例【逐字取自真实题库】（scripts/seed/ielts_questions_2026_05_enriched.json），不是编的形状：
 *           两季 seed 共 126 张卡，四条不变式 100% 成立，生产库 63 道 Part2 与之一致。
 *
 *           边界（诚实标注）：本文件证的是「题面里还有没有约束结构」。约束【具体内容】是否被上游悄悄
 *           改动（例如 in a smart way 被删、但 You should say 与 bullet 结构都还在），这里一条断言也抓不到，
 *           见交付说明「抓不住什么」。
 * @author   LingoBridge
 * @created  2026-08-12
 */
import {
  findPart2FaceViolations,
  formatPart2FaceViolations,
  CONSTRAINT_MARKERS,
  type Part2Face,
} from '../season-cue-guard'

/** 三条真实卡 —— 逐字取自 2026-05 季 seed JSON 的 part2 条目 */
const 真实卡_故事: Part2Face = {
  title: 'A Story',
  cueText:
    'Describe a story (e.g. a fairy tale, etc.) you have read You should say: What it is about ' +
    'When you read it Whether you liked it And explain what you have learned from it',
}
const 真实卡_手机: Part2Face = {
  title: 'An Occasion When Mobile Phone Was Not Allowed',
  cueText:
    'Describe an occasion when you were not allowed to use You should say: When it was Where it was ' +
    'Why you were not allowed to use your mobile phone And how you felt about it',
}
const 真实卡_理想工作: Part2Face = {
  title: 'A Perfect Job',
  cueText:
    'Describe your perfect job You should say: What it is Where you heard about it from ' +
    'What you need to learn to get the job And explain why you think it is your perfect job',
}
const 三条真实卡 = [真实卡_故事, 真实卡_手机, 真实卡_理想工作]

describe('findPart2FaceViolations【行为】真实题库数据必须全部放行', () => {
  it('三条真实卡一条都不报（误报会白白拦下每年 3 次的正常换季导入）', () => {
    expect(findPart2FaceViolations(三条真实卡)).toEqual([])
  })

  it('空批次不报（导入计划里没有 Part2 要写时，不该凭空失败）', () => {
    expect(findPart2FaceViolations([])).toEqual([])
  })

  it('批次里混着一道坏题时，只报那一道、放行其余（拦截要指得出是哪道题）', () => {
    const 坏卡: Part2Face = { title: 'A Perfect Job', cueText: 'A Perfect Job' }
    const violations = findPart2FaceViolations([真实卡_故事, 坏卡, 真实卡_理想工作])
    expect(violations).toHaveLength(1)
    expect(violations[0].index).toBe(1)
    expect(violations[0].title).toBe('A Perfect Job')
  })
})

describe('findPart2FaceViolations【行为】cue_text 退化成裸标题 —— 事故的原始形态', () => {
  it('题面与标题逐字相同 → 报 cue_text_same_as_title', () => {
    const 退化 = { ...真实卡_理想工作, cueText: 真实卡_理想工作.title }
    expect(findPart2FaceViolations([退化])[0].kind).toBe('cue_text_same_as_title')
  })

  it('题面与标题只差大小写/空白也算相同（规范化后比较，别被格式差异骗过去）', () => {
    const 退化 = { ...真实卡_理想工作, cueText: '  a   PERFECT job  ' }
    expect(findPart2FaceViolations([退化])[0].kind).toBe('cue_text_same_as_title')
  })

  it('题面比标题短 → 报 cue_text_not_longer_than_title（题面被截断）', () => {
    const 截断 = { ...真实卡_手机, cueText: 'Describe an occasion' }
    expect(findPart2FaceViolations([截断])[0].kind).toBe('cue_text_not_longer_than_title')
  })

  it('题面结构完整、但约束段标记没了 → 报 cue_text_missing_constraint_marker', () => {
    // 这一条是唯一能抓住「长度够长、也不等于标题，但约束段整段没了」的判据。
    const 无约束段: Part2Face = {
      title: 'A Perfect Job',
      cueText: 'Describe your perfect job and talk about it for one to two minutes in the exam.',
    }
    const violations = findPart2FaceViolations([无约束段])
    expect(violations).toHaveLength(1)
    expect(violations[0].kind).toBe('cue_text_missing_constraint_marker')
  })
})

describe('findPart2FaceViolations【行为】两个字段映射反了 —— 只发生在映射那一步，原始 JSON 看不出来', () => {
  it('title 与 cueText 对调 → 必须报出来（长题面进了标题、裸标题进了题面）', () => {
    const 映射反了: Part2Face = { title: 真实卡_故事.cueText, cueText: 真实卡_故事.title }
    const violations = findPart2FaceViolations([映射反了])
    expect(violations).toHaveLength(1)
    // 反了之后题面变成裸标题：既短于标题、也没有约束段标记，两条判据任一命中都算抓住
    expect(['cue_text_not_longer_than_title', 'cue_text_missing_constraint_marker']).toContain(
      violations[0].kind,
    )
  })

  it('三条真实卡【全部】对调后，一条都不许漏过', () => {
    const 全反 = 三条真实卡.map((c) => ({ title: c.cueText, cueText: c.title }))
    expect(findPart2FaceViolations(全反)).toHaveLength(3)
  })
})

describe('findPart2FaceViolations【行为】空字段', () => {
  it('题面为空 → 报 cue_text_empty（模型将看不到任何题干）', () => {
    expect(findPart2FaceViolations([{ ...真实卡_故事, cueText: '   ' }])[0].kind).toBe('cue_text_empty')
  })

  it('标题为空 → 报 title_empty（上游结构已坏）', () => {
    expect(findPart2FaceViolations([{ ...真实卡_故事, title: '' }])[0].kind).toBe('title_empty')
  })

  it('每道题至多报一条（题面等于标题时必然也不比标题长，不重复刷屏）', () => {
    const 全坏: Part2Face = { title: '', cueText: '' }
    expect(findPart2FaceViolations([全坏])).toHaveLength(1)
  })
})

describe('CONSTRAINT_MARKERS【行为】措辞变更靠改常量兜住，而不是靠删校验', () => {
  it('当前标记就是 You should say（英文 cue card 的固定结构）', () => {
    expect(CONSTRAINT_MARKERS).toContain('you should say')
  })

  it('标记匹配不分大小写（上游写 YOU SHOULD SAY 不该被误报）', () => {
    const 大写 = { ...真实卡_故事, cueText: 真实卡_故事.cueText.toUpperCase() }
    expect(findPart2FaceViolations([大写])).toEqual([])
  })

  it('某季换了措辞时，把新措辞加进 CONSTRAINT_MARKERS 就能放行（无需删掉这条判据）', () => {
    const 新措辞: Part2Face = {
      title: 'A Perfect Job',
      cueText: 'Describe your perfect job. You may include: What it is Where you heard about it And why it suits you.',
    }
    // 加之前：被拦下（这正是「误报」的样子 —— 拦下来让人看一眼）
    expect(findPart2FaceViolations([新措辞])[0].kind).toBe('cue_text_missing_constraint_marker')

    // 这里不去改模块常量（会污染其他用例），而是断言判据本身按标记列表工作：
    // 换个已在列表里的措辞就立刻放行，说明扩列表确实是有效的处置路径。
    const 用现有标记 = { ...新措辞, cueText: 新措辞.cueText.replace('You may include:', 'You should say:') }
    expect(findPart2FaceViolations([用现有标记])).toEqual([])
  })
})

describe('formatPart2FaceViolations【行为】报错必须可行动', () => {
  it('全部通过时返回空串（不给调用方留个空壳报错去打印）', () => {
    expect(formatPart2FaceViolations([])).toBe('')
  })

  it('报错里要有：第几道、哪道题、哪个字段、当前值、什么后果、怎么处置', () => {
    const 退化 = { ...真实卡_理想工作, cueText: 真实卡_理想工作.title }
    const text = formatPart2FaceViolations(findPart2FaceViolations([退化]))

    expect(text).toContain('第 1 道')
    expect(text).toContain('A Perfect Job')
    expect(text).toContain('question_text')
    expect(text).toContain('cue_text')
    expect(text).toContain('Part2 系统性虚高')
    expect(text).toContain('CONSTRAINT_MARKERS')
    expect(text).toContain('未写入任何数据')
  })

  it('多道违规时逐道列出，条数对得上', () => {
    const 全反 = 三条真实卡.map((c) => ({ title: c.cueText, cueText: c.title }))
    const text = formatPart2FaceViolations(findPart2FaceViolations(全反))
    expect(text).toContain('3 道题')
    for (const n of ['第 1 道', '第 2 道', '第 3 道']) expect(text).toContain(n)
  })
})
