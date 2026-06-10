# LingoBridge 开发交接文档

> 日期：2026-06-07　|　工作分支：`feat/home-ielts-toggle`
> 配套阅读：仓库内 `DESIGN.md`、`ENGINEERING.md`、`LingoBridge-产品详细介绍.md`（设计/工程/产品权威文档，本文件只做"会话进度 + 剩余工作 + 关键须知"的交接，不重复它们）。

---

## 1. 一句话项目 & 当前状态

LingoBridge 是面向雅思口语备考的练习 App，核心理念：把用户真实的生活故事转化为口语素材，通过即时正反馈闭环备考。核心链路：**故事 → 整理 → 匹配 → 分析 → 练习 → 反馈**。

当前处于**内测准备阶段**。本次会话主要修了题库崩溃、补齐了主要页面的空状态、调整了"我的"页面，并清理了测试数据。代码可正常运行，剩余工作见第 5 节。

技术栈：Next.js（App Router）+ Supabase（Postgres + RLS + 匿名会话）+ 千问（qwen-plus / qwen-flash，DashScope）+ 豆包 ASR。

---

## 2. 分支与提交

- 仓库：`https://github.com/yuhong-zhang202/LingoBridge`
- **工作分支：`feat/home-ielts-toggle`（不是 main；main 是过时的五月原型，勿直接用）**
- **PR 尚未开**：分支持续累积提交，内测前功能齐了再合 main。

本次会话已确认的提交：

| commit | 内容 |
|---|---|
| `8dd08a3` | 练习教练 Lior 输出规则 + analysis/matching URL 清掉故事原文 |
| `525dfac` | 题库 JSON OCR 连字拼写修复 + spelling-review.md |
| `e1e9a82` | DB 空值/形状兜底（5 文件 7 处），修复题库 `.map is not a function` 崩溃 |
| `21783c9` | `getCorpusPointCodes` 兼容 Supabase 对象/数组/null 形状 |

另有 3 项已实现并真机测试通过、随后 commit（具体 hash 见 `git log`）：

- 题库空状态（corpusCount===0 时显示 EmptyState）
- "我的"画像卡空状态（模糊未解锁雷达 + 提示），提交描述：`feat(profile): 我的画像卡空状态（模糊雷达 + 去录故事引导）`
- "我的"页面调整（删目标 Band / 退出登录移底部 / 删学习偏好），提交描述：`chore(profile): 移除目标Band与学习偏好入口，退出登录移至页面底部`

---

## 3. 本次会话完成的工作

### 3.1 题库崩溃修复（原 backlog B）
`.map is not a function` 的根因是 **Supabase 把 many-to-one 嵌套关系返回成"对象"，而代码当数组 `.map`**（详见第 4 节）。修复点：`src/lib/db/corpus.ts` 的 `listMyObservationCodes`、`getCorpusPointCodes`，外加多个 db 函数的 `?? []` 兜底。题库恢复正常（雷达、维度覆盖 6/6、题目匹配 66/278）。

### 3.2 空状态走查（原 backlog A，主页面部分）
- **首页**：动作页，对新老用户一样，"说说你的故事 / 开始录音"本身即引导 → 无需空态。
- **素材库**：两个 tab 本就用共享组件 `EmptyState`（Orb + 文案 + CTA）→ 已 OK，未改。
- **题库**：新增空态 —— `corpusCount===0` 时用 `EmptyState` 替掉全 0 的雷达盘（"还没有匹配的题目 / 去录制"），并隐藏 tab 切换。
- **我的**：新增"我的画像"卡空态 —— 复用真实 `PortraitRadar` 喂占位形状 + 模糊 + 浮层（锁 + "录一条故事后，这里会生成专属语料维度"）。

> `EmptyState`（`src/components/EmptyState.tsx`）是全 app 通用空态组件，目前素材库、题库用到。

### 3.3 "我的"页面调整
- 删除"目标 Band 7.0"胶囊（连同只服务于它的 `getBandColors` 与 `Target` import）。
- "退出登录"从 `LoggedInView` 内部移到 `profile/page.tsx` 页面最下方（仅登录态显示）。
- 功能列表删除"学习偏好"（登录/未登录两态均删；之后再考虑是否上线）。

### 3.4 练习教练 Lior + 接入用户语料（承接上一会话）
`src/services/practice.ts` 把系统 prompt 重写为教练 Lior（结合用户语料、以题目分析侧重点为内心清单、只提问引导不给现成句子、前半打磨 Part2 后半自然滑进 Part3）。`buildScaffold` 读用户语料喂给分析。polish 改为"贴用户水平只升一档 + 口语化"。同时清掉了 analysis URL 里的故事原文（隐私）。

### 3.5 数据清理
素材库的测试语料（含大量重复）已**整库清空**（Supabase SQL：`delete from corpus;`，`corpus_point_links` 因 `ON DELETE CASCADE` 一并清掉）。这属操作层，无代码变更。

---

## 4. ⚠️ 关键架构须知 / 踩过的坑（接手前务必先读）

### 4.1 登录是两层 mock，本期定为"方案 B：无登录墙"
- **UI 登录态**（`src/lib/auth.ts`）：手机号存 localStorage（`lingobridge:phone`），验证码是 mock（任意 6 位通过）；`isLoggedIn()` = 有无手机号。
- **Supabase 匿名会话**（`src/lib/supabase.ts` 的 `ensureSession()`）：没 session 就 `signInAnonymously()`，保证 RLS 的 `auth.uid()` 有值 → **不登录也能用全部功能**，数据挂在匿名 user 上。
- **本期决策：方案 B（匿名优先，登录只为"保存/同步"），不做登录墙。** 曾评估方案 A（未登录跳登录页），因与匿名优先架构冲突、且 mock 登录非真鉴权而放弃。
- **session 在 localStorage 不在 cookie** → 任何登录守卫只能客户端做，middleware 读不到。
- **上架前必做**：把 `auth.ts` 换成真 Supabase 手机 OTP（匿名账号升级：`updateUser` + `verifyOtp`，user_id 不变、数据自动保留）。`auth.ts` 顶部注释已写升级路径。

### 4.2 Supabase 嵌套查询：to-one 返回"对象"不是"数组"（本期两次崩溃的根因）
`corpus_point_links.point_id` 是 many-to-one 指向 `observation_points`。`.select('observation_points(code)')` 回的是 `{ code }` **对象**，不是 `[{ code }]` 数组。代码若当数组 `.map`/`[0]` 就会 `x.map is not a function` 或静默取错。
**已用 `Array.isArray(op) ? ... : ...` 兼容 对象/数组/null**（见 `corpus.ts`）。
**今后写任何嵌套查询，务必先判断关系是 to-one 还是 to-many。** 注意：`question_observation_links`（一题多关联）是 to-many → 返回数组，那边是对的。

### 4.3 仓库里的 JSON 种子 / 迁移 schema ≠ 线上 DB，以线上为准
- 题库**显示文字读的是 DB**，`src/data/ielts_questions*.json` 只是种子源。本期题库拼写错只在 JSON、线上 DB 本就干净。
- 写 SQL / 排查时**列名、形状要以线上为准**：遇事先用 `select column_name, data_type from information_schema.columns where table_name='…'` 自查，别照搬仓库的迁移文件。

### 4.4 service_role 安全红线
- `src/lib/supabase-server.ts` / `src/lib/db/corpus-server.ts` 含 `service_role` key（完全绕过 RLS），**首行必须 `import 'server-only'`，禁被任何 `'use client'` 文件或前端 import 链路引用**。
- 改动相关文件后：`npm run build` + `grep -r "SUPABASE_SERVICE_ROLE_KEY\|service_role" .next/static` 确认 bundle 无泄露。

### 4.5 AI 全用千问 + 豆包
所有大模型调用走 qwen-plus / qwen-flash（DashScope），ASR 用豆包。`src/lib/api-logger.ts` 把每次调用的用量与人民币成本记到 `api_usage_logs` 表（失败只告警、不阻断主流程）。

---

## 5. 剩余工作

### 三大块（主线）

**C · 隐私安全**（内测前要有结论）
范围：语料内容保护、登录态、日志 PII、service_role 边界、**`/matching` 页 URL 仍带 story 全文**的彻底清理（本期已清掉 analysis URL 的故事原文，但 matching 页自身 URL 仍带全文——因匹配要跑全文萃取，彻底去掉是更大改动，单列）。

**D · 内测稳定性（核心链路不崩）**
每个 AI 调用加超时 + 空结果兜底；空状态/异常不崩（本期已修题库崩溃 + 补主页面空态，但流程页未逐一压测）；用 api-logger 盯成本与失败率。

**功能链优化**
核心链路 故事→整理→匹配→分析→练习→反馈 各环节质量打磨（prompt、匹配准确度、练习反馈体验等）。本期已优化"练习"环节（Lior 教练 + 接入用户语料）；修了 `getCorpusPointCodes` 后匹配的"主观察点"更准（建议录一条新故事走一遍验证）。

### 小尾巴（不完全归在三大块里，别丢）

- **页面/UI 收尾**（空状态走查的剩余）：4 个主 tab 页已完成；**流程页（录音 recording / 匹配 matching / 分析 analysis / 整理 restructure / 反馈 feedback / 文章 article）尚未逐页走查空 / 错误 / 边界态**。两个死按钮：① 首页右上角头像小圆圈（无功能）；② 素材库"我的语料"卡片右上"…"菜单（无功能、无删除）——后者可接成"删除语料"入口，省得以后跑 SQL。
- **上架前**：mock 登录 → 真 Supabase 手机 OTP（见 4.1）。
- **Lior 偶发破折号 `—`**：qwen 顽固习惯，prompt 压不死；根除方案 = `coachReply` 拿到 reply 后加 `.replace(/[—–]/g, ', ')`。本期决定先放着。
- **PR**：`feat/home-ielts-toggle` → main，内测前功能齐了再合。

---

## 6. 如何运行 / 调试

- 启动并记日志：`npm run dev:log`
- 看日志：`grep ApiLogger dev.log`（API 用量/成本）；`grep "\[Practice\]\|\[Polish\]" dev.log`（练习/优化）
- **看"真·空状态"**：开**无痕窗口**访问 → 全新匿名用户、零数据，正是"新用户第一次打开"。想看"已登录但零数据"，就在无痕里随便填手机号 + 任意 6 位验证码登一下。回正常窗口即回到原有数据。
- **数据操作**：Supabase SQL Editor，以 service_role 运行、**绕过 RLS**，删改务必先 `SELECT` 确认。注意 `corpus_point_links` 对 `corpus` 设了 `ON DELETE CASCADE`（删语料会级联删其萃取关联）。

---

## 7. 关键文件清单

- 鉴权/会话：`src/lib/auth.ts`、`src/lib/supabase.ts`、`src/lib/supabase-server.ts`
- 数据层：`src/lib/db/corpus.ts`、`corpus-server.ts`、`questions.ts`、`dimension-scores.ts`、`observation-points.ts`、`practice-sessions.ts`
- 服务/AI：`src/services/practice.ts`、`src/services/analysis.ts`、`src/lib/api-logger.ts`
- API 路由：`src/app/api/practice/route.ts`、`api/practice/polish/route.ts`、`api/analysis/route.ts`、`api/questions/route.ts`、`api/restructure`
- 页面：`src/app/page.tsx`（首页）、`question-bank/`（page + useQuestionBank + DimensionTab + QuestionListTab + RadarChart）、`library/page.tsx`（+ `components/library/MyStoriesTab`、`CollectedCardsTab`）、`profile/`（page + `_components/LoggedInView`、`LoginPrompt`、`PortraitRadar`、`FeatureListCard`）、`login/page.tsx`
- 通用组件：`src/components/EmptyState.tsx`、`TopBar`、`TabBar`、`Orb`
- 迁移：`supabase/migrations/0001_init_schema.sql`（corpus / corpus_point_links / RLS）、`0002_dimension_scores.sql`（RPC）、`0003_questions.sql`

---

## 8. 协作约定

- 所有给 Claude Code 的改动 = **精确 find/replace 的 md prompt（可复制）**；数据操作 = SQL 代码块。
- 改动原则：只动指定文件、其它不动；**颜色用 Tailwind token，不内联色值**；若与现有 token 冲突，采用项目原有 token。
- 每个改动节奏：改完 `npm run build` 通过 → 真机/无痕自测 → 确认后再 commit（涉及 service_role 的还要 grep bundle 验证无泄露）。
