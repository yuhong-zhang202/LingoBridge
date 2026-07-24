/**
 * Anki 卡背金标 · 第一批盲判表生成器
 * 从 report.md 精确提取 16 条 A/B 档样本（不手敲、防抄错），按固定打乱映射出：
 *   - round1-blind-sheet.md：给产品方盲判（隐藏目标档 + 考官判分，样本用盲 ID S01–S16）
 *   - round1-key.md：密钥（S→真实ID+目标档+词数+holdout），产品方判完前别看
 * 打乱映射与 holdout 硬编（可复现，不用随机）。
 * 用法：node scripts/anki-probe/blind-judge/build-sheet.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const md = readFileSync('scripts/anki-probe/report.md', 'utf8')

// ── 解析 report：4 输入 × A/B 档 × run1/2（跳过已砍的 C 档）──
const inputs = {}
for (const b of md.split(/^## 输入 /m).slice(1)) {
  const idm = b.match(/^(\w+)（Part (\d)/)
  if (!idm) continue
  const id = idm[1], part = Number(idm[2])
  const title = (b.match(/英文题面：(.+)/) || [])[1]?.trim()
  const corpus = (b.match(/\*\*中文语料\*\*：(.+)/) || [])[1]?.trim()
  const runs = {}
  for (const tb of b.split(/^### /m)) {
    const tm = tb.match(/^([ABC]) 档/)
    if (!tm || tm[1] === 'C') continue
    const runRe = /- \*\*run(\d)\*\*（(\d+) 词[^\n]*\n\s*> (.+)/g
    let m
    while ((m = runRe.exec(tb))) runs[`${tm[1]}${m[1]}`] = { words: Number(m[2]), text: m[3].trim() }
  }
  inputs[id] = { id, part, title, corpus, runs }
}

// ── 盲 ID 映射：S## → [inputId, tier, run]（手工打散，同输入不相邻、同档不连续）──
const MAP = {
  S01: ['B1', 'A', '1'], S02: ['A2', 'B', '1'], S03: ['B2', 'B', '1'], S04: ['A1', 'A', '1'],
  S05: ['B2', 'A', '2'], S06: ['A1', 'B', '2'], S07: ['B1', 'B', '1'], S08: ['A2', 'A', '1'],
  S09: ['B2', 'B', '2'], S10: ['A1', 'A', '2'], S11: ['B1', 'B', '2'], S12: ['A2', 'B', '2'],
  S13: ['B1', 'A', '2'], S14: ['A1', 'B', '1'], S15: ['B2', 'A', '1'], S16: ['A2', 'A', '2'],
}
// 留出集（只考不教）：B1·A档(S01,S13) + A2·B档(S02,S12)
const HOLDOUT = new Set(['S01', 'S13', 'S02', 'S12'])

const ids = Object.keys(MAP)
// 校验 16 条全覆盖、无缺文本
for (const s of ids) {
  const [id, tier, run] = MAP[s]
  if (!inputs[id]?.runs[`${tier}${run}`]) throw new Error(`缺样本 ${s} → ${id}-${tier}-${run}`)
}

// ── 盲判表 ──
let sheet = `# Anki 卡背金标 · 第一批盲判表（产品方填）

> **这是校准第一批：16 条真机生成的卡背，你独立判"像哪档 + 有没有硬伤"。目标档和考官的判分都藏起来了，判完才揭晓——这样你和考官是两个独立判官，才能量出真实一致率（不是你给考官盖章）。**

## 填表纪律（重要）
1. **16 条全判完、存好，再去看考官判分**（\`round1-judge-*.md\`）。中途别对照，否则被带偏、这批白做。
2. **判档就凭整体印象"像哪档"**，别去数 past perfect、别反推评分表——那是机器的活。
3. 每条 4 个动作：① 盲判档位 ② 忠料事实层 ③ 对题 ④ 念着顺不顺。
4. **硬伤一票否决（与档位无关）**：忠料事实层"失"（编了语料没有的地点/人名/数字/时间/事件）或 对题"失"（part2 漏答题目要的方面）→ 这条卡不可用，备注点出是哪句。
5. **拿不准档位** → 填 \`A?\` 或 \`B?\`（带问号），这条不进一致率、单算，别硬掰。
6. 耗时：part1 每条 ~1.5–2 分钟，part2 每条 ~3–4 分钟，全 16 条约 **50–70 分钟**。
7. 填在每条的 \`→\` 后面即可（直接改这个文件）。

**判据速记**：
- **档位**：A=基础（短句、简单词、刚达标考生念得出）；B=自然（日常口语、有话语标记、稍长）。
- **忠料·事实层**：回答里的事实只能来自中文语料；新增语料没有的具体事实=失。
- **对题**：part2 看有没有覆盖题目 "You should say" 的几个方面；part1 看有没有直接答问题。
- **念着顺不顺**：你出声念一遍，顺=smooth，别扭/拗口=awkward。

---
`

for (const s of ids) {
  const [id, tier, run] = MAP[s]
  const inp = inputs[id]
  const r = inp.runs[`${tier}${run}`]
  sheet += `
### ${s} · Part ${inp.part} · ${r.words} 词

**题面**：${inp.title}

**中文语料**：${inp.corpus}

**生成英文**：
> ${r.text}

**你的判定**（判完 16 条再看考官）：
- 盲判档位（A / B，骑墙填 A? 或 B?）→
- 忠料·事实层（过 / 失，失→哪句）→
- 对题/cue（过 / 失）→
- 念着顺不顺（顺 / 别扭）→
- 备注 →

---
`
}

// ── 密钥（产品方判完前别看）──
let key = `# 第一批盲判 · 密钥（⚠️ 产品方盲判完成前请勿打开）

对照用：盲 ID → 真实样本 + 目标档（生成时指定的档）+ 词数 + 是否留出集。

| 盲ID | 真实样本 | 目标档 | 词数 | 留出集(只考不教) |
|---|---|---|---|---|
`
for (const s of ids) {
  const [id, tier, run] = MAP[s]
  const r = inputs[id].runs[`${tier}${run}`]
  key += `| ${s} | ${id}-${tier}档-run${run} | **${tier}** | ${r.words} | ${HOLDOUT.has(s) ? '✅ hold-out' : ''} |\n`
}
key += `\n> 留出集 4 条 = B1·A档(S01,S13) + A2·B档(S02,S12)：产品方今晚一并盲判，但其分歧封存，优化考官 prompt 时**不许用**，只用于改完后验证"真变好还是过拟合"。\n`

mkdirSync('scripts/anki-probe/blind-judge', { recursive: true })
writeFileSync('scripts/anki-probe/blind-judge/round1-blind-sheet.md', sheet, 'utf8')
writeFileSync('scripts/anki-probe/blind-judge/round1-key.md', key, 'utf8')

// ── 自检：打印映射 + 词数，供人核对无抄错 ──
console.log('生成 16 条盲判表 + 密钥。核对（盲ID→真实→词数）：')
for (const s of ids) {
  const [id, tier, run] = MAP[s]
  console.log(`  ${s} → ${id}-${tier}-r${run}  ${inputs[id].runs[`${tier}${run}`].words}词 ${HOLDOUT.has(s) ? '[holdout]' : ''}`)
}
console.log('档位分布：A档', ids.filter(s => MAP[s][1] === 'A').length, '条 / B档', ids.filter(s => MAP[s][1] === 'B').length, '条')
