/**
 * @module   season-cue-guard
 * @desc     换季导入的「Part2 题面完整性」数据守卫。纯判断：不碰 DB、不碰 fs、不读 env，
 *           因此能被 jest 直接跑（import-season.ts 顶层 import 了 supabase-server，测试里进不去）。
 *
 *           【守的是同一场事故的另一半入口】
 *           已修的代码侧：旧写法 `cue_card_title ?? question_text` 在标题非空时短路，模型只看到裸标题
 *           「一个解决过问题的人」，看不到 `in a smart way` 这条决定分数的约束 ⇒ 任何沾边故事都像能答
 *           ⇒ 方向恒定的 Part2 虚高。该行已修，并有 src/lib/__tests__/question-face.test.ts 的 11 条断言守着。
 *
 *           但那批守卫全部建立在一个【本身没有任何守卫】的前提上：库里的 question_text 真的含着约束。
 *           换季导入（每年 1 / 5 / 9 月各一次）的映射见 scripts/import-season.ts 的 cardRow：
 *             question_text  ← c.cue_text（约束在这里）
 *             cue_card_title ← c.title（裸标题）
 *           只要上游 JSON 的 cue_text 退化成裸标题、或这两个字段被映射反了，questionFace 一行代码没改、
 *           那 11 条断言全绿，而模型看到的题面照样丢约束、Part2 照样虚高 —— 同一场事故，入口从代码换成数据。
 *           本模块补的就是这个入口。
 *
 *           【判据的地基（实测，非推测）】
 *           两季 seed JSON 各 63 张 Part2 卡、合计 126 张（2026-05 季 + 上一季），四条不变式 100% 成立；
 *           生产库当前 63 道 Part2 与之一致。cue_text/title 的长度比最小 3.47，故长度判据留有巨大余量。
 * @author   LingoBridge
 * @created  2026-08-12
 */

/**
 * 约束段标记词。英文雅思 cue card 的固定结构「Describe … You should say: …」，
 * 约束 bullet 一律跟在它后面 —— 它在不在，等价于「这段题面还有没有约束结构」。
 *
 * 【将来某季上游换了措辞怎么办】改这个数组加一个新标记，**不要删掉这条校验**。
 * 删掉它 = 把唯一能抓住「结构性退化」的判据关掉（见下方 kind 说明）。
 */
export const CONSTRAINT_MARKERS: readonly string[] = ['you should say']

/** 一道即将写入的 Part2 题面（字段名刻意中立：调用方可传 JSON 卡，也可传映射后的 DB 行） */
export interface Part2Face {
  /** 卡标题 —— 对应 DB 的 cue_card_title / JSON 的 title，是个裸标题 */
  title: string
  /** 完整题面 —— 对应 DB 的 question_text / JSON 的 cue_text，约束 bullet 在这里 */
  cueText: string
}

/**
 * 违规种类。按「先报最能说明问题的那条」排序，每道题只报第一条命中的
 * （cue_text 等于 title 时必然也不比 title 长，两条一起报只会稀释信息）。
 */
export type Part2FaceViolationKind =
  /** 标题为空 —— 上游结构坏了，不是题面退化，但同样不能放进去 */
  | 'title_empty'
  /** 题面为空 —— 模型将看不到任何题干 */
  | 'cue_text_empty'
  /** 题面与标题逐字相同 —— 「退化成裸标题」最直白的形态 */
  | 'cue_text_same_as_title'
  /** 题面不比标题长 —— 覆盖「题面被截断」与「两个字段映射反了」 */
  | 'cue_text_not_longer_than_title'
  /** 题面里找不到约束段标记 —— 唯一能抓住「结构完整但约束段整段没了」的判据 */
  | 'cue_text_missing_constraint_marker'

/** 一条违规：定位（第几道、哪道）+ 现场（当前值）+ 后果（这意味着什么） */
export interface Part2FaceViolation {
  /** 在传入批次中的下标，便于回到 JSON 里定位 */
  index: number
  title: string
  cueText: string
  kind: Part2FaceViolationKind
  /** 人读的一句话：哪个字段不对 + 当前值长什么样 + 会造成什么后果 */
  detail: string
}

/** 规范化：弯引号转直引号、小写、压缩空白、去首尾空格（与 import-season.ts 的 norm 同款）。
 *  不复用那个 norm 是因为它所在文件顶层 import 了 supabase-server，一 import 就把 DB 依赖拖进测试。 */
function norm(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** 报错里回显当前值：太长会淹没信息，截断到可辨认的长度即可 */
function preview(s: string, max = 90): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : `${one.slice(0, max)}…`
}

/**
 * 检查一批「即将写入的 Part2 题面」，返回违规清单（空数组 = 全部通过）。
 *
 * 调用方应传【映射之后】的值，不是原始 JSON 字段 —— 这样才能抓住「两个字段被映射反了」这类
 * 只发生在映射那一步、原始 JSON 完全看不出来的退化。
 *
 * @param  faces  待写入的 Part2 题面批次
 * @returns       违规清单，按传入顺序；每道题至多一条（只报最能说明问题的那条）
 */
export function findPart2FaceViolations(faces: readonly Part2Face[]): Part2FaceViolation[] {
  const violations: Part2FaceViolation[] = []

  faces.forEach((face, index) => {
    const title = norm(face.title)
    const cue = norm(face.cueText)
    const push = (kind: Part2FaceViolationKind, detail: string): void => {
      violations.push({ index, title: face.title, cueText: face.cueText, kind, detail })
    }

    if (title.length === 0) {
      push(
        'title_empty',
        '标题字段（cue_card_title ← JSON title）为空。上游结构已坏，题面/标题的分工无从判断。',
      )
      return
    }
    if (cue.length === 0) {
      push(
        'cue_text_empty',
        '题面字段（question_text ← JSON cue_text）为空。模型将只看到裸标题、看不到任何约束 → Part2 系统性虚高。',
      )
      return
    }
    if (cue === title) {
      push(
        'cue_text_same_as_title',
        `题面字段（question_text ← JSON cue_text）与标题逐字相同：「${preview(face.cueText)}」。` +
          '题面已退化成裸标题，约束 bullet 整段丢失 → 模型只看到「一个做过某事的人」，任何沾边故事都像能答 → Part2 系统性虚高。',
      )
      return
    }
    if (cue.length <= title.length) {
      push(
        'cue_text_not_longer_than_title',
        `题面字段（question_text ← JSON cue_text，${cue.length} 字符）不比标题（cue_card_title，${title.length} 字符）长：` +
          `题面「${preview(face.cueText)}」／标题「${preview(face.title)}」。` +
          '真实数据里题面是标题的 3.4 倍以上；出现这种长度关系，通常是题面被截断、或这两个字段被映射反了 → 模型看不到约束 → Part2 系统性虚高。',
      )
      return
    }
    if (!CONSTRAINT_MARKERS.some((marker) => cue.includes(norm(marker)))) {
      push(
        'cue_text_missing_constraint_marker',
        `题面字段（question_text ← JSON cue_text）里找不到约束段标记（${CONSTRAINT_MARKERS.join(' / ')}）：` +
          `「${preview(face.cueText)}」。` +
          '约束 bullet 一律跟在该标记之后；标记不在，通常意味着约束段整段没了 → 模型看不到约束 → Part2 系统性虚高。',
      )
    }
  })

  return violations
}

/**
 * 把违规清单排版成可直接打印的报错正文（含处置建议）。
 * @param  violations  findPart2FaceViolations 的输出
 * @returns            多行文本；传入空数组时返回空串
 */
export function formatPart2FaceViolations(violations: readonly Part2FaceViolation[]): string {
  if (violations.length === 0) return ''

  const lines = violations.map(
    (v) => `  ✗ 第 ${v.index + 1} 道「${preview(v.title, 40)}」[${v.kind}]\n      ${v.detail}`,
  )

  return [
    `Part2 题面完整性校验失败：${violations.length} 道题的题面丢了约束（未写入任何数据）。`,
    ...lines,
    '',
    '  为什么这条会拦下导入：Part2 的约束（You should say 后面那几条 bullet）只存在于 question_text。',
    '  它一旦退化成裸标题，重排模型与盲标标注人看到的题面【同源同偏】，金标分数看不出异常，',
    '  Part2 会静默虚高一整季。所以宁可误报一次让人看一眼，也不静默放进去。',
    '',
    '  怎么处置：',
    '   1) 先核对上游 JSON 的 cue_text 是不是真的退化了 —— 是则回上游修数据，不要改这条校验；',
    '   2) 若本季上游只是把约束段【换了措辞】（题面其实完整），',
    `      去 scripts/lib/season-cue-guard.ts 往 CONSTRAINT_MARKERS 里加新标记，不要删掉这条校验；`,
    '   3) 若怀疑是映射反了，核对 scripts/import-season.ts 的 cardRow：',
    '      question_text ← c.cue_text（长题面）／ cue_card_title ← c.title（裸标题）。',
  ].join('\n')
}

/*
 * ── 存量自查 SQL（只读，本守卫【挡不住】已经在库里的退化数据）─────────────────────────
 *
 * 本模块只在导入时拦截，对「现在库里就已经有退化行」无能为力。下面这条只读查询列出违规行，
 * 判据与 findPart2FaceViolations 一一对应，可随时在 Supabase SQL Editor 里跑：
 *
 *   SELECT id,
 *          season,
 *          cue_card_title,
 *          left(question_text, 90)             AS "题面预览",
 *          length(btrim(question_text))        AS "题面长度",
 *          length(btrim(cue_card_title))       AS "标题长度",
 *          CASE
 *            WHEN cue_card_title IS NULL OR btrim(cue_card_title) = '' THEN 'title_empty'
 *            WHEN question_text  IS NULL OR btrim(question_text)  = '' THEN 'cue_text_empty'
 *            WHEN lower(btrim(question_text)) = lower(btrim(cue_card_title))
 *                                                                     THEN 'cue_text_same_as_title'
 *            WHEN length(btrim(question_text)) <= length(btrim(cue_card_title))
 *                                                                     THEN 'cue_text_not_longer_than_title'
 *            ELSE 'cue_text_missing_constraint_marker'
 *          END                                 AS "违规类型"
 *   FROM questions
 *   WHERE part = 2
 *     AND (cue_card_title IS NULL OR btrim(cue_card_title) = ''
 *          OR question_text IS NULL OR btrim(question_text) = ''
 *          OR lower(btrim(question_text)) = lower(btrim(cue_card_title))
 *          OR length(btrim(question_text)) <= length(btrim(cue_card_title))
 *          OR question_text !~* 'you should say')
 *   ORDER BY season, cue_card_title;
 *
 * 期望结果：0 行。（2026-08-12 产品方实测：63 道 Part2 全部满足四条不变式，返回 0 行。）
 *
 * 只想要一个总数（跑得更快、适合定期体检）：
 *
 *   SELECT count(*) AS "Part2 总数",
 *          count(*) FILTER (
 *            WHERE cue_card_title IS NULL OR btrim(cue_card_title) = ''
 *               OR question_text IS NULL OR btrim(question_text) = ''
 *               OR lower(btrim(question_text)) = lower(btrim(cue_card_title))
 *               OR length(btrim(question_text)) <= length(btrim(cue_card_title))
 *               OR question_text !~* 'you should say'
 *          ) AS "违规数"
 *   FROM questions WHERE part = 2;
 */
