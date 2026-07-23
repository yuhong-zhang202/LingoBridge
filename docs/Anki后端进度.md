# Anki 题卡 · 后端开发进度（滚动）

> 双线并行：金标校准（产品方盲判）与后端开发。本文件只记后端。对齐 `方案-Anki题卡-v0.1.md`(v0.2)。

## ✅ 已完成（feat/anki-cards）
| 块 | commit | 内容 | 验证 |
|---|---|---|---|
| 数据模型 | `14aad46` | 0030 anki_cards / 0031 生成队列 / 0032 question_analyses；RLS own-rows；part3 触发器 | 真实 PG 实测 8 约束 |
| 生成流水线核心 | `9dc5bce` | 生成器(TIER_SPLIT=6.25)；drain(密钥鉴权+SKIP LOCKED+退避)；入队；0033 RPC；prompt 同源守卫 | tsc / 单测 8/8 / drain 真实 PG |
| 写路径端点 | `0807e4b` | 存对子(409)/换·删语料(清 generated_answer 红线已核)/review(懒物化)/编辑 + 计次 | tsc；真库验证未做 |
| 产品决策落地 | `3f60d00` | **匿名→注册专属**、**换语料不计配额**（产品方拍板） | tsc |
| list 读端点 + pregen | `44556df` | 0034 get_anki_cards RPC(排序/分组/scope/默认卡/按 user 过滤)；GET 端点；pregen 脚本(part3 独立框架) | RPC 真实 PG 四组断言 |

→ **方案 §6 端点全齐**（POST/PUT/DELETE/GET/PATCH/review/drain + pregen）。prompt 与探针同源守卫（漂移即测试红）。均未真调 DashScope。

## 🔵 审计完成（2026-07-23）——两份均无 🔴 阻断
安全侧越权/RLS/drain 密钥/被遗忘权/注入/同意闸**逐条核过挡住**；架构鉴权范式扎实、边界清晰。🟡 上线前处理清单：

| # | 来源 | 问题 | 需要什么 | 修法 |
|---|---|---|---|---|
| A | security | **匿名绕过**：`requireUser` 不拦匿名会话→"注册专属"未被代码强制 + 匿名**绕内测邮箱白名单**（影响不止 Anki）+ 每匿名会话新 50 额度=成本放大 | 确认 Supabase 匿名登录开关 | Anki 端点显式拒匿名（`isAnonymous→401`）；白名单绕过需全站层面处理 |
| B | security | **换语料 PUT 无限流**：拍板"不计配额"=单账号可脚本无限烧 AI 费（0031 索引只挡在途重复、job done 即可再入队） | 产品方定：加不加防滥用限流(≠配额) | 换语料走宽松日限/冷却（如 200/天 或 N 分钟冷却） |
| C | code-health | **换/删语料无事务**：§11 红线是多条独立 DML，中间失败→旧答案复活 / 卡背永久空白（与 enqueue 落 RPC 求原子性的理由自相矛盾） | 直接修（正确性红线） | 收敛成 plpgsql RPC 一个事务 |
| D | code-health | **processing 孤儿无回收**：容器重启/超时杀 drain→任务永卡 processing、永不重试、卡背空白（崩溃恢复真空） | 部署侧确认 Zeabur 容器超时行为 | claim 加 visibility-timeout 回收超时 processing |
| E | both 🟢 | 卡态 SQL/JS 双算 + 空串处理不一致；切点散落三处；drain 回填 `.eq('id',card_id)` 建议加 `user_id` 防御纵深；魔数记账 | 直接修/记账 | 对齐 + 集中常量 + 加 user_id 过滤 |

**可测性缺口（code-health 列 8 条行为级）**：换语料原子红线、删语料不复活、enqueue 幂等、懒物化 upsert 不覆盖、get_anki_cards 排序分组、drain 状态机、孤儿恢复、backKind 边界——关键不变式几乎全裸奔，仅 anki-answer.test.ts 覆盖生成器。

**被遗忘权注**：anki 两表靠 FK cascade 兜底删号，当前安全，但建议加进删号路由显式清单防未来 FK 漂移。

## ⏳ 待办
### 🔴 唯一剩的后端块：band 落地
- `resolveTargetBand` 现恒返回默认 6.5→B 档。规格 §64 band 应存**用户档案**。落地需 profiles 加目标综合分列 + 注册弹窗写入 + 打通取值。**牵扯注册流程（前端），非纯后端**。band 通之前生成全走默认 6.5→B。

### 🟡 验证/竞态收口
- **真库验证**：GET 完整 HTTP 链路、pregen `--commit` 真跑、写路径 job 竞态——本轮均静态验证/推演，未真跑（省钱/无就绪库）。上线前补。
- **残留在途竞态**：任务已被 drain 领取(processing)时换/删语料拦不住那次生成——极窄窗口，交 drain 侧（任务版本号/取消令牌）+ red-team。
- **drain 跨调用/多实例严格串行**：现靠 SKIP LOCKED + 部分唯一索引防同 job 双取（判断够用，非实测）。

## 🟠 待产品方确认（次要，不阻塞；金标/真机阶段一起看）
- 额度限值 `REG_ANKI_DAILY_LIMIT=50`（照 matching 拍）。
- list 批次排序方向：现 `corpus.created_at` **新→旧**（方案未指方向，fix-engineer 对齐 corpus 列表口径推断）。真机看着不对可一行改 asc。

## ⚠️ 技术债
- **16 既有失败测试**（`jose` ESM 转译，consent/account-delete/api-auth-allowlist），与 Anki 无关但 base 已红，内测前宜单独修。
- **匹配页序近似**：get_anki_cards 用档位近似（无 `corpus_question_matches.display_index`），精确页序需加该列（方案 §5 可选增强）。
- **part3 分析 prompt 初版**：pregen 的 PART3_SYSTEM_PROMPT 先跑通结构，质量待单独金标（part3 是观点追问、评分侧重不同）。

## 切点/参数（金标回填前均为初值，方案 §11 冻结门）
- `TIER_SPLIT = 6.25`；`DEFAULT_TARGET_BAND = 6.5`（band 落地前占位）；`REG_ANKI_DAILY_LIMIT = 50`。
