# Anki 题卡 · 后端开发进度（滚动）

> 双线并行中：金标校准（产品方盲判）与后端开发。本文件只记后端。对齐 `方案-Anki题卡-v0.1.md`(v0.2)。

## ✅ 已完成（feat/anki-cards）
| 块 | commit | 内容 | 验证 |
|---|---|---|---|
| 数据模型 | `14aad46` | 迁移 0030 anki_cards / 0031 生成任务队列 / 0032 question_analyses；RLS own-rows；part3 不变式触发器 | 真实 PG 实测 8 项约束 |
| 生成流水线核心 | `<本轮>` | 生成器 anki-answer.ts（TIER_SPLIT=6.25 初值）；drain（密钥鉴权+SKIP LOCKED+退避）；入队；0033 RPC；prompt 同源守卫 | tsc 过 / 单测 8/8 / drain 逻辑真实 PG 实测 |

- **prompt 同源**：`src/lib/ai/anki-answer-prompt.ts` 为唯一真相源，探针 `generate.mjs` 各存一份靠锚点注释 + 漂移守卫单测互锁（改一处漏改另一处 → 测试红）。
- **均未真调 DashScope**（探针已验证同 prompt 同模型的生成能力，省钱；真实集成测试留后续）。

## ⏳ 待办（带出处）
### 🔴 阻塞「生成真正跑通」的缺口
- **卡主 band 来源未落地**（fix-engineer 缺口①）：`resolveTargetBand(userId)` 现恒返回默认 6.5→B 档。规格 §64「注册强制设目标综合分」= band 应存**用户档案**。落地需：profiles 加目标综合分列 + 注册弹窗写入 + `resolveTargetBand` 真取。**属用户档案块、非本流水线字段**（0030/0031 已冻结，不在此加列）。
- **计次/额度限流未做**（fix-engineer 缺口①）：属「用户发起请求」的闸门，归**存对子端点**（沿用 phrases 路由 `bumpDailyUsage` 前置范式）。drain 本身只做成本记账 + 同意复核（对）。

### 🟡 剩余后端块（按方案 §6/§9）
- 端点：`POST /api/anki/cards`(存/绑,409) · `PUT/DELETE .../corpus`(换/删语料) · `POST .../review`(SRS+懒物化 upsert) · `PATCH .../{editedAnswer}` · `GET .../cards?scope=&part=`(list RPC)。
- **换/删语料时应用层要清空 `generated_answer`**（方案 §11 自动重生成，触发器不管）。
- `scripts/pregen-analyses.ts`：当季全库预生成分析（含 part3 分支，去风险第一步）。
- **drain 跨调用/多实例严格串行**（fix-engineer 缺口②）：现靠 SKIP LOCKED + 部分唯一索引防同 job 双取；方案 §2「天然限流」量级下判断够用，**但为判断非实测**；如需同用户跨调用硬串行，需分布式锁/租约。待复核是否满足预期。

### 🔵 审计（凑齐后端切片后送）
- **security-auditor 审**：RLS/越权、drain 共享密钥鉴权、service_role 写边界、question_analyses 公开可读面。等端点写完一起送（越权多在 API 层）。
- **code-health-auditor 审**：流水线技术债、错误处理、可测性。

## ⚠️ 既有技术债（非 Anki，但记账）
- 全量 jest **16 个既有失败**（consent route / account-delete 头像分页 / api-auth-allowlist），`git stash` 回退本轮改动复跑仍 16 failed，**确认与 Anki 无关**——但 base 已是红的。内测前宜单独修，别让它盖住新增测试的信号。

## 切点/参数（金标回填前均为初值，方案 §11 冻结门）
- `TIER_SPLIT = 6.25`（T 6.0→A / 6.5→B），`src/lib/ai/anki-answer.ts`。
- `DEFAULT_TARGET_BAND = 6.5`（band 来源落地前的占位）。
