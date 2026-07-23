# Anki 题卡 · 综合技术+设计方案 v0.1

> Plan（技术）/ metric-designer（AI 金标）/ ux-reviewer（UI）三面方案汇总，2026-07-23。对齐 `功能规格-Anki题卡.md`。供 **red-team 审查**、产品方拍板。

## 0. 核心结论：大量复用现有轮子（非从零造）
| 需求 | 复用什么 | 状态 |
|---|---|---|
| SRS 调度 | `src/lib/srs.ts`（Leitner box 1..7，间隔 {1,2,4,7,15,30,60} 天）+ `phrase_cards`(0004) 表模板 | 已上线在跑 |
| 闪卡 UI | `src/components/review/FlashCard.tsx`（翻面/左右滑/键盘 ←→/进度点）+ `/review` 骨架 | 词组闪卡已实现 |
| 档位阶梯 | `analysis.ts generatePhrases` 已有雅思分→英语难度 4 档 | 对齐，别造第二套 |
| 已存态/滑动/分组配色 | `SwipeToDelete`、`Bookmark/Star` 已存约定、`PHRASE_CHIP_STYLES` | 复用 |

→ 本功能 ≈ **新数据模型 + 新生成器 + 拼装现有 UI/SRS**。

## 1. 数据模型（迁移 0030–0032）
- **`anki_cards`(0030)**：`(user_id,question_id)` 唯一 + `corpus_id`(可空=真相源) + `generated_answer` + `edited_answer` + Leitner(`box/due_at/last_reviewed_at`)。RLS own-rows。
- **派生模型**（避免两套卡）：有无语料/已回答/背面内容/可编辑 **全从 `corpus_id` 空不空 + part + parent_card_id 推导**。part3 卡 `corpus_id` 恒 null、`generated_answer` 恒 null，可编辑性经 parent part2 卡推导、用户自填存 `edited_answer`。
- **稀疏表 + 懒物化**（关键）："全部题卡" = `questions(当季) LEFT JOIN anki_cards`；无卡行的题按"默认卡"(背面=分析,box1,due=now)渲染；**首次 SRS 手势/存对子才 INSERT 行** → 几百题不预插、SRS 随行保留。
- **`question_analyses`(0031)**：预生成静态分析(含 part3)，question_id 主键 + season + analysis jsonb，公开可读。
- **`anki_generation_jobs`(0030 同批)**：生成任务队列（serverless fire-forget 会丢，必须落表）；status/attempts/退避。

## 2. 生成流水线（后台生成、成功才写库）
存对子 → 同步 upsert 卡行(绑 corpus_id) + 入队；`generated_answer` 先 null、**成功才回填**（用户此刻在别处、不等卡）。**drain 处理器**（香港 PaaS 常驻/cron，`FOR UPDATE SKIP LOCKED`，按 user 串行+全局限并发=天然限流，失败指数退避重试）。生成器 `anki-answer.ts`：分析+part+中文语料+档位→英文回答(part1短/part2长)，`bandToTier()` 隔离切点。沿用同意闸/计次/记账范式。

## 3. 预生成题目分析
`scripts/pregen-analyses.ts`（照 `import-season.ts`：service-role、dry-run 默认、幂等续跑）。遍历当季全库(**含 part3**)→ part-aware 分析。⚠️ 现 `generateAnalysis` prompt 写死排除 part3，须新增 part3 分支。

## 4. SRS
复用 `srs.ts`：左滑不熟→box1、右滑熟→box+1(封顶 60 天)。绑/删语料只改 `corpus_id`、不 touch SRS → 进度保留。⚠️ **大 deck**：当季几百张首刷全 `due=now` 一次涌来，不设上限会淹；建议前端分批取 + 后端预留"每日软上限"过滤位（加个过滤即可、表结构不改）。

## 5. 查询（RPC 0032 `get_anki_cards(scope, part)`）
`questions(当季,part) LEFT JOIN cards` + season 过滤 + `scope='answered'` 过滤 corpus_id + 排序(有语料批次→无语料；批次间按 `corpus.created_at`；段内近似匹配页序) + part2 带其 part3 成组。逐像素还原匹配页序需给 `corpus_question_matches` 加 `display_index`(可选增强)。

## 6. 存对子 + 端点
`POST /api/anki/cards`(存/绑, 409 冲突) · `PUT .../corpus`(换语料) · `DELETE .../corpus`(删对子,回退分析) · `GET /api/anki/cards?scope=&part=`(RPC) · `POST .../review{remembered}`(SRS+懒物化) · `PATCH .../{editedAnswer}` · `POST /api/anki/generate/drain`(内部/cron) · `scripts/pregen-analyses.ts`。
⚠️ **换语料边界**：换语料 = 新语料源，旧 `generated_answer` 必错配 → 技术上应清空+重排队生成（与"禁手动重生成按钮"不矛盾）——**待产品裁定**。

## 7. AI 金标（metric-designer）
- **分层测法**：硬规则(机器) / 档位(人判档→档位一致率) / 软质量(人工各维通过率)。生成无唯一解，不设"整体感觉良好率"。
- **目标综合分→口语下限→3档**：推导 S≥T−1.0(极限)，稳妥 T−0.5~T−1.0；**A(4–5.5)/B(6–7,默认6.5)/C(7.5–9)** 三档 + CEFR 依据。切点待拍板。
- **质量维度 D1–D7**：忠于语料/对题/档位复杂度/part长度/口语化/无中式英语/格式无泄漏。
- **指标 M1–M5 + 先基线后红线**：生成成功率/硬规则/档位一致率/软质量/稳定性；不预设及格线。
- **金标集** ≥48 组合(part×档×有语料)×3 次；双人标注报一致率。
- ⚠️ **最大风险·低档可行性**：LLM 爱写复杂/地道，"简单"vs"不中式"可能打架，低档整段生成稳定性从未验证。**建议正式建金标前先跑小批"探针生成"(3档各几条)验模型分不分得开档**，否则可能白建集。

## 8. UI/UX（ux-reviewer）
- 命名 **「题卡」**(不露 Anki)；扩展现有 FlashCard 范式。
- **素材库 IA**：现已有"词组闪卡"入口，题卡是第二套 → 「今日复习」区**并排双中卡(平级)** 或 **题卡升满宽 Hero(主推)**——产品优先级决策，两解。
- **卡片**：正面英文题(part2 带 cue bullets)；背面英文回答(带档位小标)或分析；点击翻面；编辑态原地转 textarea(锁滑动防误触)。
- **SRS 复习**：复用 `/review` 骨架；左滑不熟(暖底)/右滑熟(绿底)拖动实时反馈；桌面左右按钮+键盘；卡叠剩余感；完成态。
- **筛选**：{全部|已回答}×{part1|part2} 两组 Chip(注意 44px 命中区)。
- **分组"同批语料相邻"**：卡顶彩色 chip(`PHRASE_CHIP_STYLES` 循环色)同色=同语料；段内"第2/3题(同语料)"；建议素材库入口先列表浏览再进滑动。
- **存对子**：匹配页移动右滑(Gmail式,绿底Bookmark)/桌面详情卡图标；雅思整理确认页图标；换语料弹窗(对比当前vs新语料)；已存态防重复。
- **空态**：EmptyState 分完全无卡/某筛选无卡(轻量)。
- ⚠️ **a11y 欠账**：现 FlashCard/lib-deck-float 未做 `prefers-reduced-motion`，题卡必须补；手势外必留按钮+键盘；44px 命中区；图标 aria-label。

## 9. 实施顺序（后端先行）
1. 迁移 0030–0032 + RLS
2. `pregen-analyses.ts` 跑通当季全库分析（**去风险第一步**，AI 质量早暴露）
3. 生成器 + drain + 存对子端点
4. SRS review/edit + list RPC
5. 前端拿冻结的 mock 契约搭素材库入口/卡叠/滑动骨架 → 后端就绪直连

## 10. 待产品方拍板（合并三面，按重要性）
| # | 事项 | 谁提的 |
|---|---|---|
| 🔴1 | **【建议先探针】低档简单英语能否稳定生成**——先跑小批探针再决定投入完整金标/开发 | metric-designer |
| 🔴2 | **换语料是否重新生成卡背**（技术倾向重生成；与"禁手动重生成"不矛盾） | Plan |
| 🟡3 | **大 deck 要不要"每日新卡软上限"**（你之前说不设，三面都提示后果，再确认） | Plan/ux |
| 🟡4 | 目标综合分→口语下限换算(T−0.5/T−1.0)+三档切点 | metric-designer |
| 🟡5 | 两套闪卡素材库并列：**平级双卡 vs 题卡主推 Hero** | ux |
| 🟢6 | 命名 **「题卡」** 不露 Anki，OK？ | ux |
| 🟢7 | SRS 用现有 **Leitner**(建议) 还是规格写的 SM-2(interval/ease/reps) | Plan |
| 🟢8 | 更细：词数区间/软质量抽样/忠实度容忍/中式英语黑名单/金标语料来源 → 金标阶段定 | metric-designer |

## 11. 决策更新（滚动记录，2026-07-23）
> 探针过闸后并入方案 v0.2。以下为产品方已拍 / 已采纳的更优默认：
- **换语料 = 自动重新生成**：换语料时清空旧 `generated_answer` + 重排队生成；删语料/unbind 同样清空 `generated_answer`（修 red-team 🔴3 残留错配）。[产品方拍板]
- **命名「题卡」**（界面不露 "Anki"）。[采纳 ux]
- **SRS 用现有 Leitner box**（复用 `srs.ts`），不引 SM-2。[采纳]
- **deck 每日新卡软上限**：设默认（初值约 20/天，可调、可关），覆盖前"暂不设"——red-team 证明不设会淹用户。[采纳更优解，待产品方如坚持不设可回退]
- **素材库 IA**：v1 先"平级双卡"、不预设主次，上线看数据再定是否主推题卡。[默认]
- **待探针 / 金标阶段定**：目标分→档位切点具体值、part1/2 词数区间、忠实度容忍度、中式英语黑名单、金标语料来源。[延后]

## 12. red-team 待并入 v0.2 的修正
- 🔴 探针作为**第 0 步 go/no-go 闸**（本轮进行中）。
- 🟡 `FlashCard` 按**重写**估（非扩展）；part3 分析**独立框架+金标**（非加 if）；档位体系**先统一钉死一套**再写 `bandToTier()`；卡背成本**按"活跃用户×存卡×part2长文"重估**；懒物化 review 走 `upsert on conflict`；`drain` 端点加共享密钥鉴权、按卡主 `user_id` 取 band；part3 借 parent 推导的**隐性不变式写成显式约束**。
