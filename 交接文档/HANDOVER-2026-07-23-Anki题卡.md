# 交接文档 · Anki 题卡功能 + 卡背生成探针（2026-07-23）

> **给谁**：重启后的新会话，继续 Anki 题卡功能。**重启目的**：让新建的 `ielts-examiner`（雅思口语考官）agent 正式按类型加载、用它重新评估卡背生成质量。

## 0. 一句话现状
Anki 题卡功能处于**设计阶段**；卡背生成的 go/no-go **探针已跑完**，三方判官结论 = **有条件 GO**——模型能力过关，但 **Part2 的生成 prompt 需要修**（A 档降级、C 档收缰+忠料红线、纯文本），修完重跑验证即可推进到开发。

## 1. 分支与关键文件（都在 `feat/anki-cards`，已 push）
| 文件 | 是什么 |
|---|---|
| `docs/方案-Anki题卡-v0.1.md` | **先读这份**。三面综合方案 + §11 已拍板决策 + §12 red-team 待修 + §13 探针结论 |
| `docs/功能规格-Anki题卡.md` | 功能规格 v0.1（产品方拍板的设计基准） |
| `scripts/anki-probe/generate.mjs` | 探针脚本（qwen-plus，4输入×A/B/C×2run=24条） |
| `scripts/anki-probe/report.md` | 24 条探针输出（判分材料） |
| `.claude/agents/ielts-examiner.md` | 新建考官 agent（本轮新增） |

## 2. 功能速览（详见规格）
- **卡片**：正=英文口语题；背=① part1/2 有语料 → **仅** AI 按档位生成的英文回答（可编辑）② 无语料 / 所有 part3 → 题目分析（part3 借其 part2 的语料状态决定可否编辑；part3 从不生成回答）。翻面=点击。
- **生成**：题目分析+题型+中文语料 → 英文回答（part1短/part2长），档位由目标分粗分 2–3 档；存对子时后台生成、成功才写库。
- **筛选/排序**：{全部|已回答}×{part1|part2}；有语料卡(同批语料相邻,批次按语料创建时间)→无语料卡；part2 带其 part3 成组；无语料=当季全库未匹配。
- **SRS**：复用 `src/lib/srs.ts` Leitner；左滑不熟/右滑熟+桌面按钮+键盘。
- **存对子入口**：语料模式匹配页右滑/桌面图标；雅思模式整理确认页图标；一题一语料、换语料弹窗。
- **素材库**：新建独立入口（IA 重排）。

## 3. 已拍板决策（详见方案 §11）
换语料=**自动重生成**（清空旧 generated_answer+重排队；删语料同样清空）｜命名**「题卡」**不露 Anki｜SRS 用现有 **Leitner**｜deck **每日新卡软上限**(默认~20/天,可调可关)｜素材库 IA **v1 平级双卡**｜一题一语料换语料弹窗｜无重新生成按钮｜编辑存卡上不回写语料库。

## 4. 探针结论（详见方案 §13）——**三方判官：有条件 GO**
核心可行性**证实**：模型能产分档、非中式、对题、基本忠料的回答（red-team 怕的"核心假设未证"被证伪）。成本实测：24 条≈28.4k token，qwen-plus 极小。
- **metric-designer**：有条件 GO；唯一规律问题=C 档 Part2 过度渲染→编事实（忠料 22/24）。
- **ielts-examiner（联网核准官方 band descriptors）**：**Part1 GO**（三档读作 ~5/6.5/7.5，档位准）；**Part2 NO-GO 待修**——① A 档其实是 band6 完整叙事、超"基础可复现 4–5"，考生复现不了；② C 档滑向文学隐喻+编语料外事实（B1 尤甚：厨房/不堪重负/通宵）；③ B↔C(B1)、A↔B(B2) 分层不实。中式非问题。
- **Part2 待修 3 处（均 prompt 级，非模型不能）**：
  1. **A 档真降级**：短句、少 past perfect、允许基础重复、锚回 band 4–5 可复现。
  2. **C 档收缰**：限"地道习语（hit the hay 这种眼熟好记）**不搞文学隐喻**（melts the static 那种）"+ cap band 7.5 + 长度 ≤ B 档 +15% + **忠料红线**（禁新增语料没有的地点/动机/数字）。
  3. **纯文本禁 markdown**（有 C 档漏了 `*斜体*`）。
- 考官保留：纯文本 band 读数偏乐观，绝对分理想用真人复述录音复判（金标阶段深验，不挡现在）。

## 5. 下一步（新会话执行）
1. **确认在 `feat/anki-cards`**（`git checkout feat/anki-cards`；已 push）。
2. **按考官 3 条处方改探针生成 prompt**（`scripts/anki-probe/generate.mjs` 的 `SYSTEM` 里 A/C 档定义 + 加忠料红线 + 禁 markdown）。**走 AI 环节链路**：让 `metric-designer`/`diagnostician` 定稿修订版 prompt，别派通用 agent 拍脑袋（CLAUDE.md 硬性）。
3. **重跑 Part2 子集**（B1/B2 × A/B/C × 2 = 12 条）：把脚本 `INPUTS` 过滤成只 part2（或加 CLI 参数），`node scripts/anki-probe/generate.mjs`。⚠️ **需外网调 qwen → Bash 用 `dangerouslyDisableSandbox: true`**；需 `.env.local` 的 `DASHSCOPE_API_KEY`/`DASHSCOPE_BASE_URL`（worktree 已软链）。
4. **用正式的 `@ielts-examiner` + `@metric-designer` 复判修后的 Part2**——**这就是本次重启的核心目的**（新加载的考官 agent 重新评估）。若想，可先让 `@ielts-examiner` 复判原始 24 条 sanity-check 本轮 fallback 判分。
5. 过闸 → **方案 v0.2**：纳入 red-team §12 待修（FlashCard 按重写、part3 分析独立框架、档位统一钉死一套、卡背成本重估、懒物化 upsert、drain 鉴权、part3 不变式显式化）+ 探针定稿的可用 prompt → `red-team` 复审 v0.2 → **后端先行**开发（数据模型+生成流水线+SRS+预生成分析）。

## 6. 还没最终确认（问产品方）
- 接受"有条件 GO + 先修 Part2 prompt 再重跑"这个路径？（cowork 建议接受）
- C 档上限"地道习语禁隐喻、cap band 7.5、忠料红线"——产品方认吗？（这条定 C 档 prompt 怎么收）
- 方案 §10 更细的（切点具体值/词数区间/忠实度容忍/中式黑名单/金标语料来源）→ 金标阶段定。

## 7. 操作须知
- **全程中文**（CLAUDE.md 硬性）；产出一律中文。
- **AI 环节按"改动触及什么"派角色**：卡背生成/档位/金标 → `diagnostician`/`metric-designer`/`red-team`，别通用 agent。
- `ielts-examiner`：新会话应能按类型 `@ielts-examiner` 调；**若因启动分支不对没加载，退回让 `general-purpose` 读 `.claude/agents/ielts-examiner.md` 载入角色**（如本轮所做，效果一致）。它每次评分前会先联网核准官方 band descriptors。
- 提交在 `feat/anki-cards`；**别 push main、别 merge**（产品方合）。
- ⚠️ `ielts-examiner.md` 是**通用工具**（非 Anki 专用）：现随 feat/anki-cards；产品方若想让它在所有分支可用，可单独小 PR 并入 main。

## 8. 更大范围项目待办（背景，与本功能无关，别混）
见 `docs/未完成工作-上线路线图.md`：上线前新加坡控制台配置、**隐私前提重评（未闭环，🔴上线前必办）**、月额度 100→10、前端改动真机验证、内测后拆白名单/删测试账号、周末金标补标、Pause 旧法兰克福库。
