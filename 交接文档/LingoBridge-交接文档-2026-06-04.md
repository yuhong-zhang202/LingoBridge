# LingoBridge 开发交接文档

> 交接时间：2026-06-04 凌晨（北京时间）
> 用途：供下一个对话窗口的 Claude 快速接手。本文档接续上一份《LingoBridge-交接文档-2026-06-03.md》，记录 06-04 这次会话做了什么、当前卡在哪、下一步该做什么。
> 配套必读：项目内的 ENGINEERING.md、DESIGN.md、LingoBridge-产品详细介绍.md，以及上一份 06-03 交接文档，以及项目根的开发规则系统提示。

---

## 〇、最重要的事（先看这里）

**本次会话的工作分两段：**
- **前半段（已全部完成）**：登录页、我的页面登录态、EmptyState 组件、素材库空态、题库真实数据接入、素材库真实数据接入。
- **后半段（排查核心链路 bug，进行中）**：发现录音→整理→匹配→分析→练习这条核心链路其实从没真正跑通过，一路排查并修了多个 bug。**当前卡在"题目分析"这步的一个根因明确、但尚未修复的 bug（LLM 返回 JSON 字符串内含未转义引号）。**

**当前正等待一个【设计侦察】prompt 的结果**（详见第五节）。下一个 Claude 接手后，应先看用户有没有贴回那个侦察报告；若有，基于报告写"抽通用 LLM 调用+解析+重试工具函数"的落地实现 prompt。

**贯穿本次会话最重要的教训：看真实日志再下结论，绝不靠猜。** 本次至少两次因为"凭判断"差点改错（详见第六节），都是靠复现抓真实报错才纠正。务必延续这个铁律。

---

## 一、项目一句话背景（同上一份）

LingoBridge 是面向中国雅思口语备考生的 PWA 练习 App（Next.js 14.2.35 + Vercel + Supabase）。核心理念：把用户真实的人生故事转化成可脱口而出的口语素材。**用户计划后续上架 iOS 原生应用**。

主流程 6 步：语料输入(/recording) → AI整理确认(/restructure) → 题目匹配(/matching) → 侧重点分析(/analysis) → 练习对话(/practice) → 卡片反馈(/feedback)。

- **本地项目根目录（Mac）**：`/Users/yuhongzhang/Desktop/LingoBridge`
- **GitHub**：`github.com/yuhong-zhang202/LingoBridge`，当前分支 `feat/home-ielts-toggle`
- **本地运行**：`npm run dev`（端口 3000）

**TabBar 现为 4 个 tab**：首页(/) / 题库(/question-bank) / 素材库(/library) / 我的(/profile)。（注意：DESIGN.md 里写的是 3 个 tab，已过时；以 `feat/home-ielts-toggle` 分支的 `src/components/TabBar.tsx` 实际代码为准。）

---

## 二、本次会话完成的工作（前半段，已全部 tsc 通过）

### 块 1：登录页（方案 A 温暖欢迎型）

- **新建 `src/lib/auth.ts`**（mock 登录逻辑）：
  - `sendVerifyCode(phone)`：校验中国大陆手机号 `/^1\d{10}$/`，mock 发送（不调后端）
  - `verifyCode(phone, code)`：校验 `/^\d{6}$/`，**任意 6 位数字均通过**，通过后把手机号写 localStorage（key `lingobridge:phone`）
  - `getPhone()` / `isLoggedIn()` / `logout()` / `maskPhone(phone)`（脱敏成 138****5678）
  - **mock 性质**：当前只维护"UI 登录态"。**上架前要替换为 Supabase phone OTP + 匿名账号升级**（`updateUser` + `verifyOtp`），届时只改本文件，user_id 不变、数据自动保留。
- **新建 `src/hooks/useCountdown.ts`**：验证码倒计时（60s），useRef 持有 timer，无闭包陷阱。
- **新建 `src/app/login/page.tsx`**（117 行）：全屏，`bg-bg-page`，**无 TabBar、无 ambient-light**（DESIGN.md 限定 ambient-light 只在首页/录音页），氛围感由 `<Orb size={220}>` 自身提供。手机号 + 验证码表单，主按钮复用首页 `btn-gradient`，登录/暂不登录都 `router.push('/')`。

### 块 2：我的页面登录态

- **改 `src/app/profile/page.tsx`**（216 行，**超出 Page≤150 行规则**——已和用户说明：原文件本来就超标，本次没改更糟，等以后接真实数据大改时一起把两个登录态分支拆成组件）。
  - 水合安全：`loggedIn` 初始 `false`、`phone` 初始 `null`，在 useEffect 里读 localStorage 后再 setState（避免 SSR/CSR 不一致，项目踩过 Orb 这个坑）。
  - **未登录态**：头像照常显示，名字位置显示"未登录"，不显示 Band 胶囊；显示 `<LoginPrompt />`；**隐藏**连续打卡 Hero 卡、双列副数据卡、我的画像卡；保留功能列表卡；隐藏退出登录按钮。
  - **已登录态**：完全保持现状，仅 `name` 改为 `maskPhone(phone)`，退出登录按钮接 `logout()` + setState 切回未登录态。
- **新建 `src/app/profile/_components/LoginPrompt.tsx`**（38 行）：未登录引导卡，`GRADIENT_BORDER_STYLE_FULL`，文案"登录后保存你的故事与练习进度 / 匿名记录会在登录后自动同步，一条都不会丢"，按钮跳 `/login`。

### 块 3：EmptyState 通用组件 + 素材库空态

- **新建 `src/components/EmptyState.tsx`**（60 行）：通用空状态。图标用**首页同款 Orb 云团**（`<Orb size={110} pulse={false}>`）+ title + 可选 subtitle + 可选 CTA 按钮（`GRADIENT_BORDER_STYLE`）。props：`title / subtitle? / ctaLabel? / onCta? / orbSize? / className?`，组件本身不接 router。
- **改 `MyStoriesTab.tsx`**：空态用 `<EmptyState title="还没有故事" subtitle="去讲第一个，点亮你的表达地图" ctaLabel="去录一条" onCta={()=>router.push('/')}/>`
- **改 `CollectedCardsTab.tsx`**：空态用 `<EmptyState title="还没有收藏卡片" subtitle="练习时点 🔨 优化的句子，会收进这里"/>`（无 CTA，因为新用户还不能练习，放按钮会引导到死路）。

### 块 4：题库（question-bank）真实数据接入 ★ 重要

**这是把题库两个 Tab 从 mock 全换成真实数据库查询的大块。**

- **新增 `src/lib/db/corpus.ts` 的 `listMyObservationCodes(): Promise<string[]>`**：查当前用户所有语料命中的观察点 code（去重）。
- **新增 `src/lib/types.ts`**：`QBQuestion`（id/part/displayText/displayTextZh/dimension/matched）、`QBDimensionSummary`。
- **新建 `src/app/question-bank/useQuestionBank.ts`**（107 行）：统一数据加载与组装 hook。并行加载 `getDimensionScores / getDimensionProgress / listMyCorpus / listMyObservationCodes / getQuestions() / listObservationPoints()`，组装出雷达图、维度卡、277 道映射题、可练习/等待语料。
- **改 `page.tsx / DimensionTab.tsx / QuestionListTab.tsx`**：接 props，移除 useEffect/mock，加 loading/error。Part 筛选 chip 按真实数据动态生成（277 道里没有 Part 3，所以不出现 Part 3 chip——不是硬编码删的）。
- **`src/data/questionBank.ts`** 顶部加废弃注释（保留文件，确认无引用后可删）。
- **验证 console**：`[useQuestionBank] mapped=277 matched=0 parts=[1,2] userCodes=0`（新账号无语料时的正确空态）。

#### ⚠️ 题库的关键数据链路（务必记牢，下个 Claude 改题库相关一定要懂）

- `question_observation_links.observation_point_id` 存的是**观察点 code 文本**（如 `'SPA_03'`），**不是 UUID**。所以 `getQuestionsByObservation(code)` 的参数就是 code。
- 但 `corpus_point_links.point_id` 存的是 `observation_points` 的 **UUID**（不是 code）。
- 因此"用户命中了哪些观察点 code"这条链路是：`corpus_point_links.point_id(UUID)` → 去 `observation_points` 表查出对应 `code` → 得到 code 集合。
- 一道题命中 = 它的 `observation_points`(code 列表) 与"用户命中 code 集合"有交集。
- **题库只展示有观察点映射的 277 道题**（全是 Part 1 + Part 2，无 Part 3）。Part 3 共 370 道是追问，挂在 Part 2 卡下（`parent_card_id`），不在题库主列表平铺，靠练习对话自然追问。

### 块 5：素材库真实数据接入

- **改 `src/lib/storage.ts`**：新增 `removeSavedPhrase(id)`。
- **改 `src/app/library/page.tsx`**：移除 `SHOW_EMPTY` 开关，接 `listMyCorpus()`（我的语料）+ `getSavedPhrases()`（收藏卡片）。水合安全（useState + useEffect）。
- **改 `CollectedCardsTab.tsx`**：左滑删除接 `removeSavedPhrase`。
- **字段映射落差（重要，当前是临时处理）**：
  - `Corpus → MyStory`：`content` 取 `cleanedText ?? rawText`；`matchedCount` **暂设 0**、`dimension` **暂设 undefined**（真实匹配数依赖题目匹配链路，留待后续）。
  - `SavedPhrase → CollectedCard`：`part` 数字转 `Part ${n}` 字符串；`questionId`/`keywords` 暂空。
  - 时间用新增的 `formatRelativeTime` 工具格式化。

---

## 三、数据库 seed 与 RLS 问题（已解决，但过程很关键）

### 核心事件：题库数据从没灌进远端 Supabase

排查题库真实数据时发现：**`questions`(应 657) 和 `question_observation_links`(应 277) 两张表在远端 Supabase 是空的**——`seed_questions.sql` 从没对远端实例跑过。之前题库能显示数字全靠 mock 顶着。（**这纠正了之前以为"题库数据已真实接入"的错误认知。**）

### 解决步骤（已完成）

1. 用户在 **Supabase Dashboard → SQL Editor** 手动粘贴运行 `supabase/seed_questions.sql`（该文件开头有 `TRUNCATE ... CASCADE`，幂等、可重复跑、无外键依赖外表，安全）→ 灌入 `questions` 657 行、`question_observation_links` 277 行。
2. **RLS 问题**：这两张表开了 RLS 但**没有 SELECT policy**，导致除 service_role 外谁都读不到（Dashboard 用 service_role 能看到 657，但 app 和脚本用 anon/authenticated 被拦、读到 0）。
3. **修复**（在 Dashboard SQL Editor 跑）：
   ```sql
   DROP POLICY IF EXISTS "questions_read" ON questions;
   CREATE POLICY "questions_read" ON questions FOR SELECT TO authenticated USING (true);
   DROP POLICY IF EXISTS "qol_read" ON question_observation_links;
   CREATE POLICY "qol_read" ON question_observation_links FOR SELECT TO authenticated USING (true);
   NOTIFY pgrst, 'reload schema';
   ```
4. **验证**：脚本匿名登录后读到 `questions=657 / question_observation_links=277` ✅。

### 几个必须记住的 Supabase 事实

- **匿名登录用户的角色是 `authenticated`**（带 `is_anonymous` 标记），不是 `anon`。所以 app 通过 `ensureSession()`（`signInAnonymously()`）后能读"对 authenticated 开放"的表（dimensions/observation_points/questions/qol）。
- 侦察脚本如果**不登录**直接用 anon key 查，会被这些表的 RLS 拦、误报为 0。所以**侦察脚本必须先 `signInAnonymously()` 再查**。
- **临时侦察脚本**：`scripts/inspect-db.mjs`、`scripts/inspect-db-auth.mjs`（后者匿名登录后查，保留可重跑）。

### 当前数据库状态（截至本次会话末）

| 表 | 行数 | 说明 |
|---|---|---|
| dimensions | 6 | emotion/relationship/space/spirit/growth/value |
| observation_points | 44 | 含 migration 新增的 GRO_07。**value 维度无任何观察点**（44 个全来自其余 5 维度）——这是产品 WIP 状态，正常。题库/雷达图里 value 维度会一直显示 0/空，等以后补 value 观察点才会亮。 |
| questions | 657 | Part1:224 / Part2:63 / Part3:370 |
| question_observation_links | 277 | 全 `is_primary=true`，覆盖 31 个观察点 code |
| corpus / corpus_point_links / profiles | 按用户隔离 | RLS owner only。当前用户的 corpus 可能为空（取决于有没有成功录过语料并走完萃取）。 |

---

## 四、核心链路 bug 排查（后半段，重点）

### 背景：核心链路其实从没真跑通过

用户想验证题库匹配闭环时发现：录音→整理能通，但**题目匹配不准、题目分析报错、练习对话初始化失败**。进一步确认：**练习对话从来没真正跑通过**（一直是 mock）。于是开始系统排查。

### ⚠️ 重大纠正：model 名都是对的，别再改

排查初期 Claude Code 误判"`claude-haiku-4-5` 是无效 model 名、要带 `-20251001` 后缀"。**这是错的。** 经 web 搜索 Anthropic 官方文档确认：
- **`claude-haiku-4-5` 有效**（官方文档原文：直接通过 Claude API 使用 `claude-haiku-4-5` 即可）。
- **`claude-sonnet-4-6` 有效**（4.6 代及以后，不带日期后缀的 ID 就是该版本的标准 model ID；4.6 之前的模型才带日期快照）。
- **所以三个功能的 model 名都没问题，不要去改 model 名。**

调用方式：三个功能全用 **raw `fetch()` 直接调 Anthropic HTTP API**（`@anthropic-ai/sdk` 未安装，是设计选择）。`ANTHROPIC_API_KEY` 有效（余额 $4.45，能用）。restructure 用千问（`DASHSCOPE_API_KEY`）。

### Bug 1：JSON 提取——markdown 剥离正则太脆弱（已修）

- `extraction.ts` 等处用 `/^```(?:json)?/` **行首锚定**正则剥离 markdown 包裹。Claude 只要在 JSON 前加一句说明文字（中文模型常见），这个正则就完全失效 → `jsonText` 变脏串 → `JSON.parse` 失败。
- **盲点**：错误信息打印的是处理前的 `raw`（看着是合法 JSON），实际被 parse 的是处理后的 `jsonText`（脏串）。导致 debug 时误以为 JSON 没问题。
- **修复**：改成 `raw.slice(raw.indexOf('{'), raw.lastIndexOf('}')+1)` 花括号切片，对前后任意废话/markdown 健壮；catch 块**同时打印 jsonText 和 raw**。
- **已修四处**（同款脆弱正则）：`extraction.ts` / `practice.ts:173` / `analysis.ts:77` / `restructure.ts:69`（restructure 保留了 `{usable,cleanedText}` 兜底逻辑）。
- **结果**：**matching 已修通** ✅（能成功匹配、走到 analysis 页）。

### Bug 2：题目分析 500——LLM 返回的 JSON 本身不合法（★ 根因已定位，当前卡点，未修）

匹配修通后，走到分析这步报 `GET /api/analysis 500`，堆栈定位 `analysis.ts`。抓到真实 `jsonText` 后，**根因彻底明确**：

**Claude 返回的 JSON 字符串值内部含未转义的英文双引号。** 例（来自真实日志）：
- `"desc":"...避免泛泛而谈"走丢了"。"` ← `"走丢了"` 是裸的 `"`
- `"tip":"用"It happened + 时间"开头..."` ← `"It happened + 时间"`
- `"tip":"...避免只说"I was scared"。"`

JSON 规范要求字符串值内部的 `"` 必须转义成 `\"`，但 Claude 返回的是裸 `"`。于是 `JSON.parse` 解析到内部第一个 `"` 就认为字符串结束 → 后面变成非法语法 → `SyntaxError` → 抛"非法 JSON"。

**关键认知**：这跟 markdown 剥离、跟 `indexOf` 都无关——是 **LLM 返回的 JSON 内容本身就不合法**。这是比 Bug 1 更根本的问题。`indexOf('{')` 切片是对的（jsonText 开头确实是正确的 `{`），坏在字符串内部。

**这个病根 matching/extraction/practice/restructure 大概率都有**，只是它们之前 LLM 返回的内容恰好没在字符串里加引号，侥幸没触发。迟早会踩。

### 已和用户对齐的修复方案（待落地，这是下一步要做的）

**双保险，四处统一修：**

1. **治本（改 prompt）**：每处 system prompt 加硬约束——**JSON 字符串值内部禁止使用英文双引号 `"`，需要强调时改用中文引号 `「」`**。从源头不产生坏 JSON。
2. **兜底（抽通用工具函数）**：抽一个通用的"调用 LLM + 提取 JSON + 解析 + 失败重试"工具函数，让四处复用（`extraction / analysis / practice / restructure`）。
   - **重试逻辑**：`JSON.parse` 失败时，**把坏掉的 JSON 连同报错再发回给 LLM，让它重新输出一份合法的**（让 LLM 自己修，而不是在代码里写"智能修复未转义引号"的函数——那种要写半个 JSON 解析器，极易引入新 bug，已否决）。重试仍失败才真正抛错。
3. **范围**：用户已选"**改 prompt + 抽通用重试工具函数复用**"（最干净但改动最大）。

---

## 五、下一步该做什么（接手后第一件事）

### 立即：等设计侦察报告，然后写落地实现 prompt

会话末尾已经发给用户一个**【设计侦察】prompt**（只读、不改码），让 Claude Code：
- view 四处（`extraction.ts / analysis.ts / practice.ts / restructure.ts`）的真实调用方式（endpoint/model/env、system prompt 怎么传、messages 单轮还是多轮、解析+校验逻辑）；
- 提出通用工具函数的**接口设计草案**（放哪个文件、函数签名、内部逻辑）；
- **如实评估哪处适合统一、哪处差异太大该保留独立实现**（特别提醒：`practice` 要传多轮对话历史、`restructure` 用千问且有 `usable` 兜底，这两处可能不适合硬套同一函数——不要为统一而统一）。

**接手后**：先看用户有没有贴回这个侦察报告。
- 若已贴回 → 评估接口设计是否合理、哪处该特殊处理，确认后写**落地实现 prompt**（实现工具函数 + 四处接入 + 四处 prompt 加引号约束）。
- 若没贴回 → 提醒用户去 Claude Code 跑那个侦察 prompt。

### 修完核心链路后，逐项验证

让用户**一口气走完整条链路**：录音 → 整理 → 匹配 → 选题进分析 → 开始练习。每步是通是崩都要看真实日志。预期匹配和分析修好后能通；练习对话若还有独立问题再单独排查。

### 之后的待办（按优先级）

1. **api_usage_logs 的 RLS 报错**（无害但刷屏）：`new row violates row-level security policy for table "api_usage_logs"`（code 42501）。ApiLogger 写日志被 RLS 拦，不影响功能。核心链路通了后，统一给这张表加一个允许 authenticated INSERT 的 policy（或在写日志处容错）。
2. **我的页面真实数据**：打卡/语料数/练习数/画像雷达还是 mock（profileData 写死）。接真实统计（语料数用 `listMyCorpus().length`，画像用 `getDimensionScores()` 等）。届时顺便把 profile/page.tsx 拆组件解决超行问题。
3. **素材库真实匹配数**：当前 `MyStory.matchedCount` 暂设 0、`dimension` 暂 undefined。题库匹配链路通了后补上。
4. **完成练习后的登录提示**：在 /feedback 或练习结束节点弹登录引导（之前规划的第 8 步）。
5. **题目匹配/分析准确度调优**：用户反馈匹配不太准、分析质量有提升空间。这是 **prompt 质量调优**（matching 靠 `extraction.ts` 的萃取 prompt），留到核心链路全通、数据接入做完后再处理。
6. **录音页布局问题**（用户报告，待修）：手机端 `/recording` 页要下滑才能看完整提示，云团(Orb)顶部被顶部组件遮挡。需 view `src/app/recording/page.tsx` 看布局（可能缺安全区内边距，或 Orb 在小屏太大导致溢出）。
7. **icon-192.png 404 + PWA 图标**（B 类遗留，无害）：manifest 引用了但文件不存在，console 持续报 404。等图标/设计定稿处理。

---

## 六、本次会话的经验教训（给下个 Claude，务必内化）

1. **不靠猜，看真实日志。** Claude Code 本次至少两次基于"判断"下结论后被推翻：(a) 误判 model 名要加日期后缀；(b) 误判 analysis 是 `indexOf` 抓错花括号。都是靠"复现 → 抓终端真实报错"才纠正。**任何 500/失败，先复现抓真实堆栈，再动手。**

2. **错误信息打印的内容必须和实际处理的一致。** matching 和 analysis 都踩了"catch 块打印 `raw`、但实际 parse 的是 `jsonText`"的盲点——看到的 JSON 合法、实际解析的是脏串，严重误导排查。**写错误日志时，把"实际被处理的那个值"打出来。**

3. **LLM 返回 JSON 的两类坑要分清**：
   - (a) **提取问题**：markdown 包裹 / JSON 前后有说明文字 → 提取不出干净 JSON。修法：花括号切片。
   - (b) **JSON 本身不合法**：字符串值内含未转义引号（尤其中英混排、LLM 爱加引号强调时）→ JSON.parse 直接失败。修法：改 prompt 约束 + 失败重试。**第二类更根本，且本项目多处 LLM 调用都有此隐患。**

4. **model 名规则**（2026-06 时点）：4.6 代及以后**不带日期后缀**就是标准 ID（如 `claude-sonnet-4-6`、`claude-opus-4-8`）；4.6 之前的模型 ID 带日期快照（如 `claude-haiku-4-5-20251001`），同时有不带日期的别名（`claude-haiku-4-5`）指向最新快照。**`claude-haiku-4-5` 和 `claude-sonnet-4-6` 都有效，别改。** 涉及 model 名/产品事实，靠 web 搜官方文档验证。

5. **Supabase RLS + 匿名登录**：匿名用户角色是 `authenticated`；侦察脚本必须先 `signInAnonymously()` 再查，否则被 RLS 误拦报 0；参考表（questions 等）要有对 authenticated 的 SELECT policy。

---

## 七、与这个项目协作的工作方式（务必延续）

用户偏好**先对齐方案、再动手，严格控制改动范围**。每次给 Claude Code 的 prompt 应遵循：

- prompt 开头让其先读 ENGINEERING.md（UI 任务再加 DESIGN.md）。
- 明确「本次只改 X 文件，其他一律不动」，并要求**动手前先 view 现有文件确认结构**。
- 涉及不确定的现有结构时，**先发只读侦察 prompt，回报后再写改造 prompt**（本次靠这个避免了多次误改）。
- 颜色用 Tailwind token 不内联；渐变仅用于描边；页面背景 `bg-bg-page`、卡片 `bg-white`。
- 各文件行数限制：Page ≤150 行 / UI 组件 ≤80 行（hook、service、工具函数不在此限）；超了把逻辑抽到 hook/组件。
- 用户用 **Claude Code 执行**，**dev server 让用户自己在终端跑**（不要让 Claude Code 占后台 shell，否则用户看不到日志——上一份交接已记此坑）。
- 排查问题坚持「看到真实日志/报错再下结论，不靠猜改代码」。
- mock 数据文件改完后先加废弃注释、grep 确认无引用，不直接删。

### 测试环境要点（本次新增）

- **手机测录音必须 HTTPS**：iOS 上所有浏览器（含 iPhone Chrome）都是 WebKit 内核，非 HTTPS（localhost 除外）下 `getUserMedia` 拿不到真音频——会出现"录满 1 分钟却没声音"。
- 用户用 **cloudflared 隧道**测本地：`cloudflared tunnel --url http://localhost:3000`，给一个临时 `https://xxx.trycloudflare.com` 域名，手机打开它。或直接用**电脑 localhost:3000**（localhost 麦克风可用，且方便开 F12 看 Console）。
- **抓 bug 看两个地方**：浏览器 Console（前端报错）+ 跑 `npm run dev` 的终端窗口（后端 API 报错，如 `/api/matching`、`/api/analysis` 的 500 堆栈）。cloudflared 隧道日志里的 `context canceled`、webpack-hmr ws 报错、icon-192 404 都是噪音，可忽略。

---

*本文档记录截至 2026-06-04 凌晨的状态。当前最紧要的事：等设计侦察报告 → 写"通用 LLM 调用+解析+重试工具函数"落地 prompt → 修掉未转义引号 bug → 跑通整条核心链路。*
