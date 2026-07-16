# 题库 JSON 拼写/笔误审查清单

扫描文件：
- `src/data/ielts_questions.json`（已全量扫描）
- `src/data/ielts_questions_enriched.json`（已全量扫描）

扫描日期：2026-06-07  
**本清单只读，未修改任何文件。**

---

## 错误汇总（共 15 项）

两个文件内容一致，相同错误均出现在两处。

| # | 题目 / 话题 | 字段 | 错误原文（节录） | 错误 → 修正 | 根因 |
|---|------------|------|------------------|------------|------|
| 1 | Part 1 / ACCOMMODATION | `questions[]` | `"What kind of house or at do you want to live in…"` | `at` → `flat` | OCR "fl" 丢失 |
| 2 | Part 1 / Life Stages | `questions[]` | `"Do you have any plans for the next ve years?"` | `ve` → `five` | OCR "fi" 丢失 |
| 3 | Part 1 / Life Stages | `questions[]` | `"Are you satis ed with your current life?"` | `satis ed` → `satisfied` | OCR "fi" 丢失 |
| 4 | Part 2 / A Friend Who Is Good at Music | `part3_questions[]` | `"Do you think music is bene cial for children at school?"` | `bene cial` → `beneficial` | OCR "fi" 丢失 |
| 5 | Part 2 / A Relaxing Place | `part3_questions[]` | `"Why is it dif cult for some people to relax?"` | `dif cult` → `difficult` | OCR "fi" 丢失 |
| 6 | Part 2 / Something You Can't Live Without | `part3_questions[]` | `"…buy new things? tablet fancy black, stunning cracks, screen…"` | 删除 `? tablet` 之后的全部杂记，保留 `"What do you think influences people to buy new things?"` | 答题笔记混入题目 |
| 7 | Part 2 / A Piece of Technology | `part3_questions[]` | `"…online and face-toface communication?"` | `face-toface` → `face-to-face` | 连字符缺失 |
| 8 | Part 2 / A Shopping Mall | `part3_questions[]` | `"…shopping online and instore?"` | `instore` → `in-store` | 连字符缺失 |
| 9 | Part 2 / A Disappointing Movie | `part3_questions[]` ×4 | `"What are the different types of lms in your country?"` 等 4 条 | `lms` → `films` | OCR "fi" 丢失 |
| 10 | Part 2 / A Story | `part3_questions[]` ×2 | `"What lms are popular in China right now?"` 等 2 条 | `lms` → `films` | OCR "fi" 丢失 |
| 11 | Part 2 / A Water Sport | `cue_text` | `"…whether it is dif cult…"` | `dif cult` → `difficult` | OCR "fi" 丢失 |
| 12 | Part 2 / A Time You Broke Something | `part3_questions[]` ×3 | `"…like to x things by themselves?"` / `"xing things"` / `"how to x things"` | `x` → `fix`；`xing` → `fixing` | OCR "fi" 丢失 |
| 13 | Part 2 / The Time You First Talked in a Foreign Language | `part3_questions[]` | `"Does learning a foreign language help in nding a job?"` | `nding` → `finding` | OCR "fi" 丢失 |
| 14 | Part 2 / A Time When Electricity Went Off | `part3_questions[]` | `"Is it dif cult for the government to replace all the petrol cars…"` | `dif cult` → `difficult` | OCR "fi" 丢失 |
| 15 | Part 2 / A Time You Needed To Use Your Imagination | `cue_text` | `"how dif cult or easy it was"` | `dif cult` → `difficult` | OCR "fi" 丢失 |

---

## 规律总结

- **主因：OCR 连字丢失（ligature dropout）**。`fi` 连字在扫描时整体丢失，导致：
  - `film` → `lm` / `lms`（10 处）
  - `five` → `ve`
  - `satisfied` → `satis ed`
  - `beneficial` → `bene cial`
  - `difficult` → `dif cult`（5 处）
  - `finding` → `nding`
  - `fix/fixing` → `x/xing`
  - `flat` → `at`（`fl` 丢失变体）
- **次因：连字符缺失**：`face-toface`、`instore`（2 处）
- **三因：答题笔记混入**：Something You Can't Live Without 的最后一条 Part 3 题目末尾附有手写笔记残留

---

## 修改建议

可用脚本对两个 JSON 做批量 `sed` 或 `jq` 替换，建议：
1. 先对 `ielts_questions.json` 修改并验证，
2. 再同步到 `ielts_questions_enriched.json`（两者结构不同，需分别处理）。

修改后应跑一遍 `npm run build` 确认无 JSON 解析错误。
