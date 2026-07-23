/**
 * @module   ai/part3-example-prompt
 * @desc     Part3 例句「通用示范论据句」生成的同源 prompt 唯一真相源（方案 §8/§10）。
 *           part3 无用户语料，例句是「这个论点可以怎么用一句话论证/举例」的通用范例（不基于用户语料、
 *           不审忠料事实层、不涉留空出口），随 focusPoints 一起 pregen 静态存入 question_analyses
 *           （focusPoint.example），【不进 anki_cards.generated_answer、不走 drain、不 per-user】——
 *           故 part3 的「corpus_id / generated_answer 恒 null」不变式（0030 触发器）原封不动。
 *
 *   ⚠️ 同源硬约束（对齐 anki-answer-prompt.ts 范式）：探针 scripts/anki-probe/example-probe.mjs 用
 *      SYSTEM_PART3 跑过 part3 论据 go/no-go（考官 + metric-designer 双判：论据好、零作文腔）；线上必须
 *      与「过闸的那一个」逐字一致。探针是独立 .mjs、无法 import src，故两边各存一份，靠物理锚点 +
 *      漂移测试互锁：
 *        · 本文件 PART3_EXAMPLE_SYSTEM 与 example-probe.mjs 的 SYSTEM_PART3 常量必须逐字相等；
 *        · 单测 part3-example-prompt.test.ts 读 example-probe.mjs 原文抽出 SYSTEM_PART3 与本常量比对，
 *          不一致即测试红（改一处漏改另一处会被 CI 抓住，不靠人记得）。
 *      改 SYSTEM ⇒ 必须同步改 scripts/anki-probe/example-probe.mjs 的 SYSTEM_PART3（那里挂了互引锚点）。
 *
 *   输出契约：模型返回【裸数组】[{idx,en}]（与探针一致）。故 part3 例句生成走 anki-json.ts 的
 *      callAnkiLLMJson（平衡括号解析对象/数组皆可），不走共享 callLLMJson 的 extractJson（只切 {…}）。
 * @author   LingoBridge
 * @created  2026-07-24
 */

/**
 * part3 通用示范论据句的 system prompt。
 * ⚠️ 与 scripts/anki-probe/example-probe.mjs 的 SYSTEM_PART3 常量【逐字一致】，改一处必改两处（见文件头）。
 */
export const PART3_EXAMPLE_SYSTEM = `你是为中国雅思考生服务的英语口语外教。给你：一道雅思口语 Part3 讨论题、以及为这道题准备的若干「答题角度」（立场/理由/延伸，每个有中文小标题 + 中文说明）。任务：为【每一个角度】各写【一句】可以直接开口念的短英文【示范论据句】，帮考生看到这个角度可以怎么用一句话论证或举例。

# 输出格式
严格输出一个 JSON 数组，长度 = 角度个数，逐点对应，形如 [{"idx":0,"en":"..."}]。不要输出 JSON 以外任何文字，不要 markdown 代码块包裹。

# 铁律（违反任一条算失败）
1. 每句 ≤22 词，是【说出来】的口语（可缩写、and/so/but 起句），不是作文。绝不用 Firstly / Moreover / Furthermore / In conclusion 这类书面连接词。
2. 每句必须真的在表达/支撑它对应的那个中文角度（扣住中文说明），不跑题、不循环论证、不说正确废话（禁 "it has both advantages and disadvantages" 这种零信息套话），要给一个具体、能被记住复用的角度。
3. 【不编造任何可核查的具体事实】：不给统计数字（如 "70% of people"）、不引具名研究（"a study by Harvard shows"）、不提具体新闻/机构/人物、不下绝对国别断言（"in China everyone…"）。论据只停留在一般性、经验性、能自圆其说的层面。宁可说得通用，也不编一个假数据撑场面。
4. 不要中式英语（想象母语者会怎么随口说这个观点）。
5. 纯英文正文，不用星号井号反引号破折号，不给词加粗，不整句加引号，不出现 band/IELTS/雅思/Part 这类词。`

/**
 * 拼装 part3 例句生成的 user 消息（题面 + 论点 0-based 列表）。
 * ⚠️ 结构与 scripts/anki-probe/example-probe.mjs 的 userPart3 保持一致（同源，无硬测试、靠结构对齐）；
 *    idx 从 0 开始与 SYSTEM 输出契约对齐。
 * @param questionText part3 英文题面
 * @param focusPoints  该题 focusPoints（title 中文小标题 + desc 中文说明），生成结果按其顺序逐点对齐
 * @returns            送给模型的 user 消息正文
 */
export function part3ExampleUserPrompt(
  questionText: string,
  focusPoints: { title: string; desc: string }[],
): string {
  const focusList = focusPoints.map((p, i) => `${i}. ${p.title}：${p.desc}`).join('\n')
  return `题型：Part 3
英文题面：${questionText}

【论点】（为每一个生成一句示范论据句，idx 从 0 开始）
${focusList}

现在为每一个论点生成一句示范论据句，按 JSON 格式输出。`
}
