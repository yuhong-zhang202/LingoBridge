# Anki 题卡 · 后端开发进度（滚动）

> 双线并行中：金标校准（产品方盲判）与后端开发。本文件只记后端。对齐 `方案-Anki题卡-v0.1.md`(v0.2)。

## ✅ 已完成（feat/anki-cards）
| 块 | commit | 内容 | 验证 |
|---|---|---|---|
| 数据模型 | `14aad46` | 迁移 0030 anki_cards / 0031 生成任务队列 / 0032 question_analyses；RLS own-rows；part3 不变式触发器 | 真实 PG 实测 8 项约束 |
| 生成流水线核心 | `9dc5bce` | 生成器 anki-answer.ts（TIER_SPLIT=6.25 初值）；drain（密钥鉴权+SKIP LOCKED+退避）；入队；0033 RPC；prompt 同源守卫 | tsc / 单测 8/8 / drain 逻辑真实 PG 实测 |
| 写路径端点 | `<本轮>` | POST cards(存对子,409) · PATCH cards(存编辑) · PUT/DELETE corpus(换/删语料) · POST review(SRS 懒物化) · 存对子额度计次 | tsc 过；**换/删语料清 generated_answer 红线已核**；⚠️ 真库验证未做 |

- **prompt 同源**：`src/lib/ai/anki-answer-prompt.ts` 唯一真相源，探针各存一份靠锚点 + 漂移守卫单测互锁。
- **换/删语料正确性红线（§11）已核**：`anki-cards-server.ts` 的 `rebindCorpusForSwap`/`unbindCorpus` 均清 `generated_answer` 并处理在途任务（换=改指新语料、删=撤任务）；review `upsertReview` 只更新 SRS 字段、不误伤已绑内容。
- **计次已接**：存对子/换语料走 `bumpDailyUsage(userId,'anki')`，置于校验/归属/409 之后、enqueue(付费 AI)之前。
- **均未真调 DashScope**。

## 🟠 待产品方拍板（产品数字/策略，不阻塞，金标填完一起定）
1. **匿名能否存 Anki 卡**：现实现 `requireUserAllowAnon`（匿名可试用）。但 Anki 卡是**跨天持久 SRS 资产**、且档位依赖用户档案目标分（匿名无目标分→只能默认档）——倾向改 **注册专属 `requireUser`**。请拍。
2. **换语料是否再计配额**：现"每次触发生成=记一次"，换语料也扣。若"换语料不该再扣"需改。
3. **额度限值**：现 `ANON_ANKI_LIMIT=5` / `REG_ANKI_DAILY_LIMIT=50`（照 matching 拍的初值）。请确认。

## ⏳ 待办（带出处）
### 🔴 阻塞「生成真正跑通」
- **卡主 band 来源未落地**：`resolveTargetBand` 现恒返回默认 6.5→B 档。规格 §64 band 应存**用户档案**。落地需 profiles 加目标综合分列 + 注册弹窗写入 + 打通取值。属用户档案块（0030/0031 字段已冻结）。

### 🟡 剩余后端块（方案 §5/§6/§9）
- **list 读端点** `GET /api/anki/cards?scope=&part=`：需先建 `get_anki_cards` RPC（新迁移号，方案 §5：questions LEFT JOIN cards + season 过滤 + scope + 排序 + part2 带 part3 成组）。
- `scripts/pregen-analyses.ts`：当季全库预生成分析（含 part3 分支，去风险第一步）。

### 🟡 竞态/验证收口
- **真库验证写路径**：换/删语料 job 竞态 + review 懒物化 upsert，本轮环境无就绪库、仅静态验证+推演，需接一轮真库跑数据流。
- **残留在途竞态**（fix-engineer 标注，交 red-team + drain 侧收口）：任务已被 drain 领取(processing、语料快照进 worker 内存)时，换/删语料拦不住那一次在途生成——极窄秒级窗口，收口方案=drain 侧任务版本号/取消令牌。
- **drain 跨调用/多实例严格串行**：现靠 SKIP LOCKED + 部分唯一索引防同 job 双取，方案 §2「天然限流」量级下判断够用（非实测）。

### 🔵 审计（凑齐后端切片后送）
- **security-auditor**：RLS/越权、drain 密钥鉴权、service_role 写边界（anki-cards-server 全走 service_role 绕 RLS、靠应用层按 user_id 过滤，是重点审查面）、question_analyses 公开可读面。
- **code-health-auditor**：流水线技术债、错误处理、可测性。

## ⚠️ 既有技术债（非 Anki）
- 全量 jest **16 个既有失败**（consent / account-delete / api-auth-allowlist，`jose` ESM 无法被 jest 转换、加载即崩），stash 回退本轮改动复跑仍 16 failed，**与 Anki 无关**——但 base 已红，内测前宜单独修。

## 切点/参数（金标回填前均为初值，方案 §11 冻结门）
- `TIER_SPLIT = 6.25`（T 6.0→A / 6.5→B），`src/lib/ai/anki-answer.ts`。
- `DEFAULT_TARGET_BAND = 6.5`（band 来源落地前的占位）。
- `ANON_ANKI_LIMIT = 5` / `REG_ANKI_DAILY_LIMIT = 50`（额度初值，待拍）。
