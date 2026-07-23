/**
 * @module   ai/anki-answer-prompt
 * @desc     Anki 卡背「分点式例句」生成的同源 prompt 唯一真相源（v0.3 分点式形态）。
 *           一张卡背 = 一个「点」的有序数组；本文件只负责 part1/2「有语料」的逐点例句生成
 *           （part3 例句是无语料的通用示范句、走 pregen 静态存 question_analyses，不经本 prompt、不进 drain）。
 *           生产生成器（anki-answer.ts）import 本文件，绝不另抄一份。
 *
 *   ⚠️ 同源硬约束（diagnostician）：探针 scripts/anki-probe/example-probe.mjs 用同一个 SYSTEM 过了
 *      留空出口 go/no-go；线上必须与「过闸的那一个」逐字一致，否则「过闸的 prompt」≠「线上的 prompt」。
 *      探针是独立 .mjs 脚本、无法 import src，故两边各存一份，靠物理锚点 + 漂移测试互锁：
 *        · 本文件 ANKI_ANSWER_SYSTEM 与 example-probe.mjs 的 SYSTEM_STORIED 常量必须逐字相等；
 *        · 单测 anki-answer.test.ts 读 example-probe.mjs 原文、抽出其 SYSTEM_STORIED 与本常量比对，
 *          不一致即测试红——改一处不改另一处会被 CI 抓住，不靠人记得（对齐 CLAUDE.md 验证纪律）。
 *      改 SYSTEM ⇒ 必须同步改 scripts/anki-probe/example-probe.mjs 的 SYSTEM_STORIED（那里挂了互引锚点）。
 *
 *   ⚠️ 留空出口（本形态核心，方案 §3/§11）：中间档探针证明「光要求语料没料就笼统、别编」收不住——
 *      模型没有「留空」这个选项、只能编。故 SYSTEM 给模型一个明确、被鼓励使用的出口：某个侧重点语料
 *      没素材时，输出 en=null、noMaterial=true，不为填满格子而编造。切勿删弱这段，那正是压住编造的锚。
 *
 *   输出契约：模型返回 {"points":[{idx,en,noMaterial}]} 对象（非裸数组）——因 callLLMJson 的 extractJson
 *      只切 {…}、不认顶层数组，故用对象包裹一层 points；生成器 unwrap 成点数组。
 * @author   LingoBridge
 * @created  2026-07-24
 */

/**
 * 分点式例句生成的 system prompt（part1/2 有语料）。
 * ⚠️ 与 scripts/anki-probe/example-probe.mjs 的 SYSTEM_STORIED 常量【逐字一致】，改一处必改两处（见文件头）。
 */
export const ANKI_ANSWER_SYSTEM = `你是一位为中国雅思考生服务的英语口语外教。给你：一道雅思口语题、这道题的若干「答题侧重点」（每个点有中文小标题 + 中文说明），以及用户用中文口述的真实经历（语料）。任务：为【每一个侧重点】判断用户语料里有没有讲到这个点需要的素材，有就写【一句】可以直接开口念的短英文口语例句示范这个点该怎么说，没有就把这个点【留空】。

# 输出格式
严格输出一个 JSON 对象，形如 {"points":[{"idx":0,"en":"...","noMaterial":false},{"idx":1,"en":null,"noMaterial":true}]}。points 数组长度 = 侧重点个数，逐点对应，idx 从 0 开始。每个元素二选一：
- 这个点有素材：{"idx":i,"en":"一句短英文例句","noMaterial":false}
- 这个点没素材：{"idx":i,"en":null,"noMaterial":true}
不要输出 JSON 以外的任何文字，不要用 markdown 代码块包裹。

# 留空出口（最重要，动笔前先读这条）
分点式最容易犯的错，是为了「把每个格子都填满」而编造语料里根本没有的事实。所以你有一个明确的、被鼓励使用的出口：
- 对每一个侧重点，先问自己：用户这条语料里，到底讲没讲到这个点需要的素材？
- 【讲到了】→ 写一句忠于语料的例句（noMaterial 填 false）。
- 【没讲到】→ 输出 en 为 null、noMaterial 为 true，把这个点留空。标 noMaterial 是完全正确、被允许的做法，不是失败，你不会因为留空被扣分；反倒是硬编一句去填满它才算失败。
- 尤其「补得更完整」「和别处的不同」「对比」「评价」这类点，用户语料里常常根本没讲到，这种时候就大方留空，绝不硬凑。
原则：这个点可以留空，但绝不能编。宁可留空，不可编造。

# 写例句时的铁律（违反任一条算失败）
1. 每点只写一句、口语、能直接念出来（可缩写，可 and / so / but / like 起句），不长难句、不作文腔、不书面连接词（moreover、furthermore）。每句 ≤22 词。
2. 忠于语料，分两层：
   (事实层) 例句里的人物、地点、数字、时间、事件只能来自用户语料，绝不新增语料没提过的。这个点的素材不够，就按上面的留空出口把它留空，绝不为填满而编。
   (强度层) 不把语料里已有的事实，渲染成语料没有的画面、比喻或情绪强度。
3. 不要中式英语（简单 ≠ 中式，想象母语者会怎么随口说这件事）。
4. 这一句要真的在示范「它那个侧重点」该怎么说，扣住这个点的中文说明，不写成跟这个点无关的漂亮话，也不要几个点内容重复。
5. 纯英文正文，不用星号井号反引号破折号，不给词加粗，不整句加引号，不出现 band / IELTS / 雅思 / Part 这类词。

# 输出前自检：每个 en 非空的点，句子里有没有语料根本没有的地点、人名、数字、时间、做法？有就改笼统；改不动、本就没素材的，就把这个点留空（en 设为 null、noMaterial 设为 true）。`

/**
 * 拼装 user 消息（逐点：题面 + 侧重点 0-based 列表 + 中文语料）。
 * ⚠️ 结构与 scripts/anki-probe/example-probe.mjs 的 userStoried 保持一致（同源，无硬测试、靠结构对齐）；
 *    idx 从 0 开始与 SYSTEM 输出契约对齐。此为「怎么呈现侧重点」的展示层，非 SYSTEM 本身。
 * @param part         题型 1 或 2
 * @param questionText 英文题面
 * @param focusPoints  这道题的答题侧重点（title 中文小标题 + desc 中文说明），生成结果按其顺序逐点对齐
 * @param corpus       用户中文口述语料
 * @returns            送给模型的 user 消息正文
 */
export function ankiAnswerUserPrompt(
  part: 1 | 2,
  questionText: string,
  focusPoints: { title: string; desc: string }[],
  corpus: string,
): string {
  const focusList = focusPoints.map((p, i) => `${i}. ${p.title}：${p.desc}`).join('\n')
  return `题型：Part ${part}
英文题面：${questionText}

【答题侧重点】（为每一个判断有没有素材，有就生成一句例句、没有就留空，idx 从 0 开始）
${focusList}

【用户中文口述语料】
${corpus}

现在为每一个侧重点判断并输出，按 JSON 格式输出。`
}
