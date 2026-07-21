# Claude Code 操作指令 · 2026年5-8月题库换季导入

> 执行前提：《2026年5-8月题库合并审核清单》中的 ⚠️ 待审项已全部人工拍板，两份数据文件已按下方"步骤0"放入仓库。
> 总顺序：**0 放文件 → A 迁移 → B 翻译 → C 导入 → D remap → E 召回过滤 → F 题库页UI → G 体检**。每步跑完验证再进下一步。
> 环境提醒：C/D 两步会写数据库（走 `.env.local` 的 service-role 通道，与 apply-0017.ts 同惯例）。确认 `.env.local` 指向的是你想操作的库；两个脚本都默认 dry-run，看过报告再 `--apply`。

---

## 步骤 0（手动）：放置数据文件

把本次交付的两份文件复制进仓库并提交：

- `ielts_questions_2026_05_enriched.json` → `scripts/seed/ielts_questions_2026_05_enriched.json`
- `question-observation-remap.v3.json` → `scripts/data/question-observation-remap.v3.json`

---

## Prompt A：新建 0027 迁移（season 字段）

执行后：**打开 Supabase SQL Editor，手动执行 0027 的 SQL**（仓库无 supabase CLI，DDL 无法走 REST 通道，这是既有惯例；apply-0017.ts 文件头注释有说明）。执行完在 SQL Editor 里跑 `SELECT season, count(*) FROM questions GROUP BY season;` 应看到全部行为 `2026-01`。

```md
请先阅读 ENGINEERING.md 和 design.md。
本次任务只改 supabase/migrations/0027_questions_season.sql（新建），其他文件一律不动。
颜色用 Tailwind token，不内联色值。
若颜色与现有 token 冲突，采用项目原有 token。

任务：新建迁移文件 supabase/migrations/0027_questions_season.sql，为题库增加"季度"字段，支持换题季软下架（过季题保留但不进匹配召回）。

内容要求：
1. `ALTER TABLE questions ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT '2026-01';`
2. `CREATE INDEX IF NOT EXISTS idx_questions_season ON questions(season);`
3. 文件头注释仿照 0017_observation_points_rel06_rel12.sql 的格式：写明 Migration 编号/Desc/Created，并注明——
   - season 语义："该题最近一次在考的季度"，格式 'YYYY-MM'（每年 01/05/09 三个换题季）；存量行经 DEFAULT 自动标为 '2026-01'；
   - 保留题在换季导入时会被原地更新为新季度（行与 ID 不变，观察点链接因此自动保留）；消失题停留在旧季度即为"已过季"；
   - 本迁移须在 Supabase SQL Editor 手动执行（仓库无 CLI，DDL 不能走 REST 通道）。

只写迁移文件，不要写任何执行脚本，不要改动其他迁移。
```

---

## Prompt B：补齐 P1 缺失的中文翻译（84 题）

```md
请先阅读 ENGINEERING.md 和 design.md。
本次任务只改 scripts/seed/ielts_questions_2026_05_enriched.json，其他文件一律不动。
颜色用 Tailwind token，不内联色值。
若颜色与现有 token 冲突，采用项目原有 token。

任务：该文件是 2026年5-8月雅思口语题库数据。part1 各话题的 questions_with_zh 数组里，有 84 条 zh 为 null（来自无中文的题源）。请为这些题补上中文翻译。

要求：
1. 只填 zh 为 null 的条目，已有中文的一律不动；en 一个字符都不许改。
2. 翻译风格与本文件其余已有翻译一致：口语化、简洁、以"？"结尾（疑问句时）。
3. 全部补完后，把 metadata.translation_status.part1_questions 改为 "complete"。
4. 其他任何字段（observation_point、topic_only、season、review 等）一律不动。
5. 完成后输出一份统计：共翻译了多少条、分布在哪些话题。
```

---

## Prompt C：换季导入脚本

先 dry-run 看报告（三类各多少、有无未匹配项），确认无误后 `-- --apply`。

```md
请先阅读 ENGINEERING.md 和 design.md。
本次任务只改 scripts/import-season.ts（新建）和 package.json（仅新增一条 script），其他文件一律不动。
颜色用 Tailwind token，不内联色值。
若颜色与现有 token 冲突，采用项目原有 token。

任务：新建换季导入脚本 scripts/import-season.ts，把 scripts/seed/ielts_questions_2026_05_enriched.json（2026年5-8月题库）导入 questions 表。严格沿用 scripts/apply-0017.ts 与 scripts/remap-links.ts 的既有惯例：service-role REST 通道（getSupabaseServer）、默认 dry-run 只读只报告、加 `--apply` 才写库、写库前把受影响行备份到 scripts/data/backup/、幂等可重跑。

数据文件结构：metadata + part1[]（topic/topic_zh/is_new/questions_with_zh[{en,zh}]/observation_point/topic_only/season/carried_over/match_topic）+ part2[]（title/title_zh/is_new/cue_text/part3_questions[]/observation_point/topic_only/season/carried_over/match_title）。

导入算法（三类处理，NEW_SEASON = '2026-05'）：

一、保留的 Part2 卡（carried_over=true）：
1. 按 cue_card_title = match_title 且 part=2 查现有卡行。期望恰好 1 条；0 条或多条→记入"未匹配报告"，禁止猜测，跳过该卡。
2. 幂等分支：若 match_title 查不到，但已存在 cue_card_title = title 且 season = NEW_SEASON 的卡→视为已导入，no-op。
3. 匹配成功则原地 UPDATE（不删行、不换 ID，观察点链接自动保留）：topic=title、cue_card_title=title、cue_card_title_zh=title_zh、question_text=cue_text、is_new=false、topic_only=（取 JSON 值）、season=NEW_SEASON。
4. 刷新 Part3：DELETE 该卡 parent_card_id 下全部 part=3 行，再按 part3_questions 逐条 INSERT（part=3、topic=title、question_text=题目、question_text_zh=null、is_new=false、topic_only=false、parent_card_id=卡ID、season=NEW_SEASON）。

二、保留的 Part1 话题组（carried_over=true）：
1. DELETE part=1 且 topic = match_topic 的全部行（注意 Relax 的 match_topic 是 'Having a Break'，按旧名删）。链接随行级联删除，属预期——后续 remap:links v3 会按话题重建。
2. 按 questions_with_zh 逐条 INSERT：part=1、topic=（新 topic 名）、question_text=en、question_text_zh=zh、is_new=false、topic_only=false、season=NEW_SEASON。
3. 幂等分支：若旧 topic 查不到但新 topic 已有 season=NEW_SEASON 的行→视为已导入，no-op。

三、新增题（carried_over=false）：Part1 话题组与 Part2 卡（含其 Part3 子题）直接 INSERT，season=NEW_SEASON，is_new=true，字段同上。幂等：同 topic（P1）或同 cue_card_title（P2）已存在 season=NEW_SEASON 的行则跳过。本脚本不创建任何 question_observation_links——链接统一由 remap:links v3 建立。

四、消失题：任何未被上述规则触及的行一律不动（自然停留在 2026-01 = 已过季）。

报告与安全：
- dry-run 报告：三类各自的行数计划（更新/删除/插入）、未匹配清单、幂等跳过清单；对照 metadata 的 total_rows 给出校验。
- --apply 前备份：所有将被 UPDATE/DELETE 的 questions 行 + 保留 P1 话题现有的 question_observation_links 行，存 scripts/data/backup/（带时间戳，格式同现有备份文件）。
- 运行前预检：questions 表存在 season 列（select 一行探测），否则报错提示先执行 0027。

package.json 新增：`"import:season": "npx tsx --conditions=react-server --env-file=.env.local scripts/import-season.ts"`。
```

**验证**：apply 后在 SQL Editor 跑 `SELECT season, part, count(*) FROM questions GROUP BY season, part ORDER BY 1,2;`——season=2026-05 应为 part1≈286、part2=63、part3≈337；season=2026-01 剩余行即过季题。

---

## Prompt D：remap 切到 v3 并同步链接

先 dry-run。报告里重点看：未匹配项应只有"过季题的旧链接保留"类提示；若出现当季题匹配不到，回头查导入。确认后 `-- --apply`，跑完把报告发我一份。

> ⚠️ **2026-05 实测修正**：本步实际**不止改一行**。放进仓库的 `question-observation-remap.v3.json` 把 Part2 的键从 `title` 改成了 `cue_card_title`（63/63），而 `remap-links.ts` 读的是 `decl.title` —— 按本 Prompt「只改一行、对账逻辑不动」照做会让 dry-run 直接崩、63 张卡全部匹配不上。实际额外改了 `Part2Card` 接口 + `decl.title→decl.cue_card_title`（约 6 行）。下季若 remap 的 P2 键风格延续，请把本 Prompt 改为「同步 P2 键名」。

```md
请先阅读 ENGINEERING.md 和 design.md。
本次任务只改 scripts/remap-links.ts，其他文件一律不动。
颜色用 Tailwind token，不内联色值。
若颜色与现有 token 冲突，采用项目原有 token。

任务：把声明文件指向新版本。第 67 行 REMAP_PATH 由 question-observation-remap.v2.json 改为 question-observation-remap.v3.json，并同步更新文件头注释里提到的版本号。其余对账逻辑、dry-run/--apply/备份惯例一律不动。
```

---

## Prompt E：匹配召回按季度过滤

> ⚠️ **2026-05 实测修正**：`src/lib/constants.ts` **已存在**（放着 SCORE_*/MODEL_* 等常量），本步是**追加** `CURRENT_SEASON` 而非「新建」。另外为让 `getQuestions` 返回 `season` 字段，还需给 `src/lib/types.ts` 的 `DBQuestion` 加 `season` 字段——本 Prompt 任务文里「类型定义同步补上」这句与「只改两个文件」的表头自相矛盾，实际动了 constants.ts / questions.ts / types.ts 三个文件。

```md
请先阅读 ENGINEERING.md 和 design.md。
本次任务只改 src/lib/constants.ts（新建）和 src/lib/db/questions.ts，其他文件一律不动。
颜色用 Tailwind token，不内联色值。
若颜色与现有 token 冲突，采用项目原有 token。

任务：让匹配召回与切换池只取当季题，同时保证过季题的练习/分析入口不受影响。

1. 新建 src/lib/constants.ts，导出 `export const CURRENT_SEASON = '2026-05'`，附注释说明语义（每年 1/5/9 月换题季时更新此常量并配套跑换季导入）。
2. src/lib/db/questions.ts 改动（只加过滤与字段，不改函数签名与现有行为语义）：
   - getQuestionsByObservation、getQuestionCountByObservations、getRandomSwitchQuestion：查询加 season = CURRENT_SEASON 过滤（getRandomSwitchQuestion 里 topic_only 池与普通映射池两条查询都要加）。
   - getQuestions：不过滤季度（题库页需要展示过季题），但确保返回对象包含 season 字段（类型定义与行映射同步补上）。
   - getQuestionById、getQuestionsByParent：一律不加过滤——按 id 取题必须对过季题继续可用，这是"过季题仍可练习/分析"的兼容保证。
3. 如果你在检索中发现匹配链路还有其他直查 questions 表的调用点，只在结果里列出文件与行号报告给我，不要擅自修改。
4. 跑一遍 npm run lint 与相关单测，把结果附在回复里。
```

---

## Prompt F：题库页"已过季"分组 UI

```md
请先阅读 ENGINEERING.md 和 design.md。
本次任务只改 src/app/question-bank/ 目录内文件（useQuestionBank.ts、QuestionBankDesktop.tsx、QuestionBankMobile.tsx、QuestionListTab.tsx、QuestionListTabMobile.tsx，如确需微调同目录其他组件请先说明理由），其他文件一律不动。
颜色用 Tailwind token，不内联色值。
若颜色与现有 token 冲突，采用项目原有 token。

任务：题库页支持"已过季"题目分组展示。产品规则：
1. 判定：question.season !== CURRENT_SEASON（常量从 src/lib/constants.ts 导入）即为过季。
2. 题目列表视图：默认只展示当季题；列表底部提供一个可展开区块"已过季题目（N）"，默认收起，点击展开后列出过季题。
3. 过季题行内加"已过季"小标签（样式对齐现有"当季热题"is_new 标签的实现方式，用项目既有的 Tailwind token，弱化的中性色调）。
4. 过季题点击后照常进入练习/分析流程，交互与当季题完全一致，不加任何拦截。
5. 维度视图（DimensionTab）只统计与展示当季题，不混入过季题。
6. 桌面端与移动端两套组件都要实现，行为一致。
7. 不改任何数据获取函数签名；数据来自 getQuestions 已返回的 season 字段。
完成后：列出改动文件清单与关键 diff 摘要，并跑 npm run lint。
```

---

## Prompt G：回归体检

```md
请先阅读 ENGINEERING.md 和 design.md。
本次任务不修改任何业务代码文件，只运行检查并输出报告。
颜色用 Tailwind token，不内联色值。
若颜色与现有 token 冲突，采用项目原有 token。

任务：换季导入后的回归体检，依次执行并汇总报告：
1. node scripts/inspect-db.mjs（或按该脚本现有用法）：输出 questions 按 season/part 的行数、question_observation_links 总数、topic_only 卡数量，与预期对照（2026-05：P1≈286 / P2=63 / P3≈337；topic_only 以 remap.v3 定稿数为准）。
2. npm run eval:ranking：跑排序金标体检，输出与上一次结果（scripts/eval/results/ 最新一份）的分数对比。
3. npm run test 与 npm run lint。
4. 报告里单列：季度过滤生效验证——任选一个观察点调用 getQuestionsByObservation，确认返回题目全部 season=2026-05。
只报告，不修数据；发现异常先停下来描述现象。
```

---

## 收尾备忘

- eval:ranking 若因保留卡题干变体出现个别分差，属预期，把差异卡列出来人工看一眼即可；萃取金标不受题库更换影响。
  > ⚠️ **2026-05 实测修正**：实际远不止「个别分差」——ranking 金标按 questionId 标注，换季后 Part1 题整组换了新 UUID、旧题过季被季度过滤挡出，导致金标**近乎全量失配**（实测金标未召回 131 条=26 已删+45 过季，可见区金标缺口 91.4%，四闸门分母塌到个位数失效）。**这不是排序回归**（当季题漏召回=0，已取证）。判定法：查 score JSON `coverage.goldNotRecalled` 的 questionId 的 season，全是旧季/不存在即预期。**换季后必须按新季重标 ranking 金标**（金标=考卷，走 metric-designer + 产品方拍板），补标前 eval:ranking 闸门不是有效回归信号。详见记忆 `season-import-stales-ranking-gold`。
- 下个换题季（2026-09）重复本流程：出新 enriched JSON + remap.v4 → 迁移已就位无需再做 → C→D→E(改常量)→G。
- `观察点审计.md` 与权威文档如需登记本次 v3 结论，等映射定稿后再补一段"2026-05 换季记录"。

---

## 金标补标进度（2026-07-21 · 周末待续）

换季后 `eval:ranking` 四闸门失效 = 金标失配（非排序回归，当季漏召回=0，已取证）。补标方案已由 metric-designer 出、产品方 6 项拍板通过；**自动化 prep 已完成，人工盲标延至周末做**。

**prep 结果（主会话实测）**：旧金标 148 label → 桶A 保留卡沿用 17 / 桶B Part1换ID迁移 33 / 桶C 过季已删归档 95 / 冲突 3；回填进新骨架 29 条（复用率低，因换季替换了大半题库）。
**待人工盲标 134 行** = 可见区 **52**（必标，恢复 3/4 闸门）+ 隐藏抽样 **82**（仅埋没率，可减可缓）。
**复核只盯审核清单标注的 ~5 张变体卡**（自动 diff 被 bullet 重排误报，不可信）。

**草稿产物**（暂存 `scripts/eval/results/`，golden/ 未动，未提交）：
- `ranking-relabel-2026-05-盲标表.md`（周末填 `金标档` 列即可，每行带观察点+清单备注）
- `ranking-relabel-2026-05-scaffold.json`（机器骨架，回填+待标）
- `ranking-relabel-2026-05-archive.json`（桶C 过季判例归档）

**周末续做链路**：填盲标表 → 主会话合成 `golden/ranking.v3.json` → `baseline-engineer` 重钉 BASELINE 红线（版本互锁必做）→ 重跑 `eval:ranking:score` 验四闸门恢复。台账 122 有完整记录。
