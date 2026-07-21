# LingoBridge 开发交接文档

> 交接时间：2026-06-04 晚（北京时间）
> 用途：供下一个对话窗口的 Claude 快速接手。本文档接续此前的
> 《LingoBridge-交接文档-2026-06-03.md》《2026-06-04 凌晨版》《项目现状与交接文档00》，
> 记录 06-04 这一整天（白天到晚间）做了什么、当前状态、以及下一步该做什么。
> 配套必读：项目内的 ENGINEERING.md、DESIGN.md、LingoBridge-产品详细介绍.md，
> 以及项目根的开发规则系统提示。

---

## 〇、最重要的事（先看这里，有两条状态翻转）

### ★ 翻转 1：GitHub 现在是最新代码，可以读了

**此前所有交接文档都写"GitHub 分支是旧 mock 状态、不要信、以本地为准"——这条从 2026-06-04 晚间起作废。**

本次会话结束时，用户已把本地全部改动（61 个文件）打成一个 commit
（`76d0d1`）推送到 GitHub 分支 `feat/home-ielts-toggle`。

- **仓库**：`https://github.com/yuhong-zhang202/LingoBridge`
- **分支**：`feat/home-ielts-toggle`（已是真·最新，含本文档描述的全部功能）
- **下个 Claude 可以直接读 GitHub 上这个分支的代码来了解现状**，不再受"分支是 mock"的限制。
- 但注意：用户日常仍用本地 Claude Code 开发、不一定每次都 push。所以"GitHub = 最新"
  在本次推送后成立，再往后若用户又在本地改了没推，则 GitHub 会再次滞后。
  **接手时先确认：用户这次会话有没有新的本地改动未推。** 有则仍以本地为准。

### ★ 翻转 2：核心链路 + 数据持久化 已全部真实化

此前文档里的"核心链路从没真跑通""故事未持久化、storyId 写死 '1'"等问题，
本阶段已系统性解决。当前**录音→整理→匹配→分析→练习→反馈 6 步全链路真实可用**，
且**故事、语料-观察点关联、打卡、练习场次均已落 Supabase 按 user_id 持久化**。

### 贯穿始终的工作铁律（务必延续）

1. **看真实证据，不靠猜。** 代码 tsc 过 ≠ 运行时正确。每个写库/RPC 改动都要在
   Supabase Dashboard 跑 SQL 验证真实数据，或在 app 里实测，再往下走。本次至少 3 次
   靠"实测/查库"纠正了"代码看着对但其实没生效"（豆包静默失败、streak RPC 返回 0、
   api_logger 双重缺失）。
2. **先只读侦察、回报后再改。** 涉及不确定的现有结构，先发只读 prompt 摸清，
   再写改造 prompt。本次全程靠这个避免误改。
3. **严格控制改动范围。** 每个 prompt 明确"只改 X 文件，其他一律不动"，删文件前
   grep 证明零引用。
4. **危险/生产操作分层。** Supabase 的建表/RLS policy/RPC 等 DDL，给用户 SQL
   让他自己在 Dashboard 跑，不让 Claude Code 碰生产库。代码改动才走 Claude Code。

---

## 一、项目一句话背景

LingoBridge 是面向中国雅思口语备考生的 PWA 练习 App（Next.js 14.2.35 + Vercel + Supabase）。
核心理念：把用户真实的人生故事转化成可脱口而出的口语素材。**用户已确认目标是上架 iOS 原生 App**
（这影响登录方案选型，见第六节）。

主流程 6 步：语料输入(/recording) → AI整理确认(/restructure) → 题目匹配(/matching)
→ 侧重点分析(/analysis) → 练习对话(/practice) → 卡片反馈(/feedback)。
顶部 5 步进度条：故事 / 整理 / 题目 / 分析 / 练习。

- **本地项目根目录（Mac）**：`/Users/yuhongzhang/Desktop/LingoBridge`
- **GitHub**：`github.com/yuhong-zhang202/LingoBridge`，分支 `feat/home-ielts-toggle`（已最新）
- **本地运行**：`npm run dev`（端口 3000）。dev server 让用户自己在终端跑，
  不要让 Claude Code 占后台 shell（否则用户看不到日志，踩过坑）。
- **Supabase**：project `jzoxnxgbvshiwctwvrwd`，区域 ap-southeast-1（新加坡）。（2026-07 迁自 `tvdzkcnnszjynzzvtptk`/eu-central-1）

### AI 供应商分工（重要：成本与 key 隔离）

| 任务 | 供应商/模型 | env key |
|---|---|---|
| 语音转写 | 豆包（火山引擎）录音文件识别大模型·极速版 | DOUBAO_ASR_APP_ID / DOUBAO_ASR_ACCESS_TOKEN |
| 语料整理 | 千问 qwen-flash（DashScope/阿里云百炼） | DASHSCOPE_API_KEY |
| 萃取 + 分析 | Claude claude-sonnet-4-6 | ANTHROPIC_API_KEY |
| 练习对话 + 🔨优化 | Claude claude-haiku-4-5 | ANTHROPIC_API_KEY |

- **model 名都是对的，别改**（claude-sonnet-4-6 / claude-haiku-4-5 都有效，4.6 代及以后
  不带日期后缀）。
- **三个 Claude 功能用 raw fetch 直调 Anthropic HTTP API**（未装 SDK，设计选择）。
- **成本血泪教训**：本次曾以为"千问整理太贵"（50 元一晚烧光），排查发现是
  **用户另一个项目（校招爬虫 intern_run.py）和 LingoBridge 共用了同一个阿里云 DashScope key**，
  爬虫批量调 qwen-plus（不是 flash）按 128K 上下文窗口计费翻倍烧光的。LingoBridge 自己的
  整理（flash、小请求）极便宜。**已处理：用户关停爬虫、给 LingoBridge 换了独立的新千问 key。**
  教训：不同项目务必用独立 API key，否则账单混在一起分不清、互相烧预算。

---

## 二、本次会话（06-04 全天）完成的工作

按时间顺序，每项都已 tsc 通过 + 多数已实测/查库验证：

### 1. 通用 LLM JSON 调用工具函数 `src/lib/llm.ts`（callLLMJson）
- 起因：Claude 返回的 JSON 字符串值内含未转义英文双引号，导致 analysis 等处 JSON.parse 崩。
- 解法：抽 `callLLMJson<T>()`，统一封装 Anthropic / DashScope 两种 provider 的请求、
  文本提取、花括号切片提 JSON、解析+校验、**一次"把坏 JSON 退回让模型自己修"的重试**、
  可选 fallback（restructure 用）。
- 四处接入：extraction / analysis / practice(polishSentence) / restructure。
  coachReply（多轮纯文本）不走它。
- 四处 system prompt 都加了"JSON 字符串值内禁用英文双引号，改用中文引号「」"的硬约束。
- 注意：fallback 只在重试仍失败时调用，收到的是第一次的 raw/jsonText。

### 2. RLS session 竞态修复
- 问题：lib/db 查询函数没 await ensureSession()，服务端查 Supabase 时无 session、
  被 RLS 拦回 null，导致"题目不存在"间歇性报错。
- 解法（细粒度）：给 `src/lib/db/questions.ts` 所有查询函数加 `await ensureSession()`。
  （此前已给部分函数加过，本次补全。当前 lib/db 下所有读函数均已带 ensureSession，
  RLS 审计已确认全覆盖。）

### 3. profile 页真实数据接入 + 拆组件
- 真实化：语料数（listMyCorpus）、画像雷达（getDimensionScores 取前5维）、收藏数
  （getSavedPhrases）。targetBand 仍写死 7.0（无 user_settings 表）。
- 拆组件解超行：page.tsx(138行) + LoggedInView.tsx + FeatureListCard.tsx，均 ≤150 行。

### 4. 故事持久化（清掉老技术债 storyId='1'）★ 重大
- 此前：语料从不入库，corpus_id 全程写死 '1'。
- 现在：restructure 页点"开始匹配"时 createCorpus + updateCorpusCleaned 拿真实 corpusId，
  透传到 matching；api/matching 萃取出观察点后调 saveExtraction 写 corpus_point_links。
- saveExtraction 幂等（先 delete by corpus_id 再 insert，重复匹配不产生重复行）。
- 已查库验证：corpus 表有真实语料（user_id 真实匿名 id）、corpus_point_links 有真实关联。
- **遗留**：question-bank→analysis 路径仍传 storyId='1'（DimensionTab/QuestionListTab L74）；
  analysis/page.tsx L61 的 storyId 是死参数（analysis 根本不消费它）。这些是"非主链路"的
  storyId 残留，主链路（matching→analysis）已修真。

### 5. 素材库真实匹配数
- 新增 corpus.ts: getCorpusPointCodes(corpusId)；questions.ts: getQuestionCountByObservations(codes)
  （聚合查 + Set 去重，比逐个查省 DB 往返）。
- library 页 Promise.all 并行算每条语料的 matchedCount + dimension（主维度由 primaryCode
  前缀映射，用现有 codeToLabel/DIMENSION_LABEL）。
- getQuestionCountByObservations 有 `if(codes.length===0) return 0` 早返回在 ensureSession
  之前，但早返回不发 DB 请求所以安全，不会偶发 0。

### 6. RLS 全表审计（安全地基）
- 审计结论：**用户数据隔离是健康的**。corpus / corpus_point_links / profiles 都正确按
  `auth.uid()=user_id`（links 通过 corpus 间接隔离）。参考表（dimensions/observation_points/
  questions/question_observation_links）是 `using=true` 只读对 authenticated 开放——这是对的
  （公共参考数据）。所有 DB 读函数都有 ensureSession。
- **修复了 api_usage_logs 的 42501 报错**（双重缺失）：
  - 加了 INSERT policy（Dashboard 手动跑：`for insert to authenticated with check(true)`，
    运营日志不按终端用户隔离）。
  - 代码侧 api-logger.ts 的 logApiUsage 写库前补了 await ensureSession()；
    logApiUsage 整体 try/catch + 5 个调用 route 各加 .catch，保证写日志失败不影响主流程。

### 7. 打卡 + 练习计数（新功能块，全套真实持久化）★
- **新建 Supabase 表 practice_sessions**（id/user_id/question_id/created_at），RLS 照 corpus
  范式 `auth.uid()=user_id`，有 (user_id, created_at) 索引。
- **新建 RPC `get_practice_streak(p_user_id uuid)`**：按 Asia/Shanghai 时区算"连续打卡天数"，
  规则=宽限派（今天没练但昨天练了 streak 仍保留到昨天，今昨都没练才归 0）。
  **注意**：早先版本是无参 `get_practice_streak()` 依赖 auth.uid()，但在 SQL Editor 里
  auth.uid()=null 永远返 0、没法验证；已改成接收 p_user_id 参数，app 里显式传 userId
  （从 ensureSession 拿），更健壮且可在 Editor 验证。旧无参版已 drop。
- **新建 src/lib/db/practice-sessions.ts**：recordPracticeSession(questionId)、
  getPracticeCount()、getStreak()（rpc 传 p_user_id）。
- **接入 practice/page.tsx L161**："结束"按钮 onClick 里 fire-and-forget 写一条
  practice_sessions（不 await、.catch 静默，绝不阻塞跳 feedback）。
- **profile 接真实值**：连续打卡天数=getStreak()、练习数=getPracticeCount()；
  **删掉了"最长 X 天"那行（maxStreak 不做）**。
- 已实测：登录态"我的"页显示 连续 1 天 / 练习 1 / 语料 9 / 真实画像雷达，正确。
  "完成一次练习=当天打卡"，同一天多练 streak 不变、练习数 +1（按天去重正确）。
- **设计决策**：用户定"完成一次练习=一次打卡"，所以不需要单独打卡表，practice_sessions
  一张表同时承载练习计数和打卡 streak。maxStreak（历史最长）不做。

### 8. 死代码清理
- 删除（各经 grep 证明零引用）：useRecording.ts、data/library.ts、data/questionBank.ts、
  data/questions.ts、data/analysis.ts。
- 保留（有引用）：data/matching.ts（QuestionCard 引用其 MatchQuestion 类型）、
  data/article.ts（article 页仍引用，因 article 功能本身是 mock）、
  data/restructure.ts 的 MOCK_RAW_STORY（restructure 页 fallback，有意保留）。

### 9. 萃取 prompt 调优（小任务 1，本次最后一项）
- 改 src/services/extraction.ts 的 system prompt：
  1. REL_11 边界扩展为也包含"机构/平台/公司/组织"的摩擦冲突（原来只列了人）。
  2. 加了 3 条 few-shot 内容示例（平台冲突→REL_11、出差压力→EMO_09+SPA_06、
     失败+学习→GRO_04）。
- **未碰 value 锁**（value 解锁是独立任务，见第五节）。
- ⚠️ **状态：代码已落地+推送，但准确度改善尚未实测验证。** 下个 Claude 接手后，
  让用户讲一个"与平台/机构冲突"类故事走完整链路，确认 REL_11 边界改动生效。
  （value 类故事这次仍会偏，是预期，因 value 还锁着。）

---

## 三、当前产品状态：真实 vs 仍为 mock/占位/未实现

### 已真实化（可用）
- 录音转写（豆包）、AI整理（千问）、题目匹配、题目分析、练习对话、🔨优化 —— 6步全链路
- 故事持久化（corpus 落库）、语料-观察点关联（corpus_point_links）
- 素材库：语料列表 + 真实匹配数 + 主维度
- profile：语料数、画像雷达、收藏数、连续打卡、练习数（targetBand 仍占位）
- 题库（question-bank）：277 题真实数据
- RLS 隔离、api_usage_logs 日志

### 仍为 mock / 占位 / 未实现（按严重程度，来自本次全库 grep 侦察）

| # | 项 | 文件 | 状态 | 影响 |
|---|---|---|---|---|
| 1 | Auth 登录全 mock | lib/auth.ts | 任意手机号+任意6位码都能"登录"，不调后端 | 上架前必须换 Supabase OTP/Apple 登录 |
| 2 | article（口语文章）100% mock | services/article.ts 等 | generateArticle 无视输入，永远返回固定 ARTICLE_TEXT | /article 页永远同一篇假文章 |
| 3 | VALUE 维度被硬锁 | extraction.ts L24/L85 | prompt 写"绝不输出 value 的点" | value 类故事永远误归、无法匹配 value 题 |
| 4 | question-bank→analysis storyId=1 | DimensionTab/QuestionListTab L74 | 硬编码 | 题库进 analysis 链路传假 storyId（但 analysis 不消费） |
| 5 | MyStoriesTab"查看"坏链接 | components/library/MyStoriesTab.tsx L65 | 跳 ?storyId=，但 matching 读 ?story=&corpusId= | 点"查看"进空白/报错的匹配页 |
| 6 | analysis 不结合语料 | api/analysis/route.ts L43 | generateAnalysis 只收 {part,en,zh}，不读 corpus | 分析纯题目驱动，个性化为零（用户已吐槽） |
| 7 | storyId 在 analysis→practice 是死参数 | analysis/page.tsx L61/L162 | 透明传递、无人消费 | 无害死参数 |
| 8 | targetBand 写死 7.0 | profile/page.tsx L25 | 占位，无 user_settings 表 | "目标 Band"永远 7.0 |
| 9 | saved_phrases 仅 localStorage | lib/storage.ts | 收藏只存浏览器 | 换设备/清缓存丢失，依赖登录后迁库 |
| 10 | 手机号仅 localStorage | lib/auth.ts | lingobridge:phone，无 Supabase 持久化 | 与匿名 session 两个状态不同步 |
| 11 | bookmarkCount 初始闪 24 | profile/page.tsx L31 | useEffect 会覆写为真实值 | 短暂视觉抖动，无本质问题 |
| 12 | restructure MOCK_RAW_STORY | data/restructure.ts | 直接访问 /restructure 无 rawText 时 fallback | 正常链路不走，有意保留 |

---

## 四、关键技术事实（接手必懂，避免重复踩坑）

### Supabase / RLS
- 匿名用户角色是 `authenticated`（带 is_anonymous），不是 anon。
- 侦察脚本/SQL Editor 用 postgres 身份跑，**没有 auth.uid()**。所以依赖 auth.uid() 的
  RPC（security invoker）在 Editor 里测会返 0/空——这不是 bug，是 Editor 无用户上下文。
  打卡 RPC 改成传参就是为了能在 Editor 验证。
- ensureSession() 幂等（先 getSession 有就 return，没有才 signInAnonymously），重复调廉价安全。
- corpus 范式（新表照抄）：user_id 无 default、代码侧必须显式传（从 ensureSession 拿）；
  RLS using+with check 双向 `auth.uid()=user_id`；写前先 ensureSession。

### 萃取/匹配体系（调优前必懂）
- 43 个观察点 + 6 维度**全硬编码在 extraction.ts 的 prompt 里**，不从 DB 实时拉。
  listObservationPoints() 只在 matching.ts 用于把 code 转 meta 展示，不参与萃取。
- 6 维度：情绪内核 EMO(13) / 人际羁绊 REL(11) / 空间感知 SPA(7) / 精神栖所 SPI(6) /
  成长演进 GRO(6) / **价值底色 VALUE（0 个观察点，被锁死）**。
- 萃取输出 primary（必有）+ secondary（可 null），prompt 规则要求"必须选一个"，
  没有"不符合返回 null"的出口。
- 匹配：primary/secondary 两个 code 各调 getQuestionsByObservation（按单 code 查
  is_primary=true 的题），结果并集 Set 去重，无相关性评分、无二次筛选。
- **PayPal 误归类根因（三因叠加，value 锁死是主因）**：
  - 主因：VALUE 锁死，"被平台坑了/公平感"这种价值判断无处落，被迫归到最近的点（如 EMO_09）。
  - 次因：REL_11 边界原只列"人"没列机构（本次已修）。
  - 次因：无 few-shot 内容示例（本次已加）。
  - 所以：改 prompt 能缓解 REL_11+few-shot 两点；但 value 类故事必须解锁 VALUE+补数据才能根治。

### 测试环境
- 手机测录音必须 HTTPS（iOS 全 WebKit，非 HTTPS 拿不到真音频）。用 cloudflared 隧道
  或直接电脑 localhost:3000。
- 抓 bug 看两处：浏览器 Console（前端）+ npm run dev 终端（后端 API 500 堆栈）。
- 噪音可忽略：cloudflared 的 context canceled、icon-192.png 404、webpack-hmr ws 报错。
- **转写错误码区分**：豆包 45000030=授权/欠费未生效；20000003 no valid speech=
  音频无有效语音（多为麦克风没选对设备/没出声，不是代码 bug）。

---

## 五、后续工作 + 优先级

用户已确认顺序（第一梯队按"萃取调优→analysis结合语料→practice结合analysis"）。

### 第一梯队 · 核心质量（进行中）
- **小任务1：萃取 prompt 调优（REL_11+few-shot）** —— ✅ 代码已落，⚠️ 待实测验证。
- **VALUE 维度解锁（用户决定"直接一起做、拆成小任务"）** —— 下一个要做的块。拆法：
  - 任务2（产品设计，纯文档不写码）：和用户一起**定义 value 维度有哪几个观察点**
    （VAL_01...），各观察什么。这是用户的产品决策，是"6维骨架"最后一块，需专心做。
  - 任务3（数据落库，用户在 Supabase 手动跑 SQL）：把 value 观察点 insert 进
    observation_points；从 657 题里挑"价值观类"题标注到 value 观察点（question_observation_links）。
  - 任务4（解锁萃取，改 prompt）：删 extraction.ts 两处 value 锁、把 value 观察点加进
    prompt 清单。**严格依赖任务3先完成**（否则萃取到 value 却无题可配，比锁死更糟）。
- **analysis 完全围绕用户故事重写** —— 用户要"重度版"：分析完全围绕用户故事（但不能脱离
  题目，是"用你的故事来答这道题"）。需先侦察 analysis 现在怎么拿数据、corpusId 怎么传到
  analysis 页、generateAnalysis 的 prompt。地基已具备（corpus 有真实内容）。
- **practice 结合 analysis** —— 用户要练习对话根据 analysis 的产出来聊。依赖 analysis 先改好；
  practice 是多轮+有 scaffold 脚手架，要把 analysis 产出喂进去，比 analysis 本身复杂。
  **顺序：先 analysis、验证好，再 practice。**

### 第二梯队 · 修坏链接/清假功能
- MyStoriesTab"查看"坏链接（#5）——改 URL 参数，便宜。
- article 功能（#2）——决策：真做（接 AI 生成）还是从导航隐藏？不能留假内容上架。

### 第三梯队 · 上架准备
- 录音页布局 bug（手机端 /recording 要下滑才能看完整提示，Orb 顶部被遮挡）。
- PWA 图标（icon-192.png 404，manifest 引用但文件不存在）。

### 第四梯队 · 数据归属+登录（放最后，纯接线）
- **登录方案已定调**：用户上架 iOS，登录走 **Apple Sign In + 匿名账号升级**
  （不走国内短信+ICP备案那条重路——那是国内 Web 上线才需要的，iOS 用 Apple 登录无需备案）。
  **前置门槛**：需 Apple Developer Program 付费账号（用户尚未开通）+ 在 Supabase 后台配 Apple provider。
  **关键认知**：登录可以最后做、风险不大——前提是数据已按 user_id 持久化（已做到）。
  匿名 user_id 升级为 Apple 身份时 user_id 不变、数据自动保留。
- saved_phrases / 手机号 迁 Supabase（依赖登录）。
- targetBand 真实化（需 user_settings 表，可和登录一起）。

### 单独评估的大功能块
- TTS / AI 发声（practice 的 AI 和 feedback 播放按钮目前不发声）。
- "我的表达库"浏览页（收藏已落库/localStorage，但无浏览全部收藏的入口）。

---

## 六、与这个项目协作的工作方式（务必延续）

- 用户偏好**先对齐方案、再动手，严格控制改动范围**。
- 每次给 Claude Code 的 prompt：开头先读 ENGINEERING.md（UI 任务加 DESIGN.md）；
  明确"只改 X 文件，其他一律不动"；动手前先 view 现有文件确认结构。
- 不确定的现有结构：先发只读侦察 prompt，回报后再写改造 prompt。
- 危险操作（删文件）先 grep 证明零引用，有引用停下报告。
- Supabase 的建表/RLS/RPC 等 DDL：给用户 SQL 让他在 Dashboard 手动跑，不让 Claude Code
  碰生产库。代码改动才走 Claude Code。
- 每个写库/RPC 改动都要在 Dashboard 跑 SQL 或在 app 实测验证真实数据，再往下走。
  **代码 tsc 过不等于运行时正确。**
- 颜色用 Tailwind token 不内联；渐变仅描边；页面背景 bg-bg-page、卡片 bg-white。
- 行数：Page ≤150 行 / UI 组件 ≤80 行（hook/service/工具函数不限）；超了拆组件。
- dev server 让用户自己在终端跑，不要让 Claude Code 占后台 shell。
- 拆大任务为小步，每步能独立验证；不为统一而统一、不为清干净而误删。

---

## 七、接手第一件事

1. 确认用户本次会话有无新的本地改动未推 GitHub（有则以本地为准；无则可读
   github.com/yuhong-zhang202/LingoBridge 的 feat/home-ielts-toggle 分支了解现状）。
2. 让用户实测小任务1的萃取调优效果（讲一个"与平台/机构冲突"故事走链路，看 REL_11 是否生效）。
3. 然后进 VALUE 解锁块——**从任务2（和用户一起定义 value 观察点）开始**，这是产品设计对话、
   不写代码。

*本文档记录截至 2026-06-04 晚间的状态。*
