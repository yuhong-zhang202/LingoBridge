# LingoBridge 项目现状与交接文档

> 本文档用于把 LingoBridge 的完整进度交接给下一个 AI / 协作者。
> 读完应能完全接手：知道产品是什么、做到哪了、结构怎样、用了哪些 API、接下来做什么。
> 最后更新：2026-06-03

---

## 0. 给接手 AI 的关键提示（务必先读）

1. **工作方式**：开发以"给 Claude Code 写 prompt"的方式推进。每个功能 = 一份 markdown prompt，用户在本地用 Claude Code 执行。
2. **⚠️ GitHub 分支不是最新代码**：用户在本地跑 Claude Code，**不 push 到分支**。远程分支 `feat/home-ielts-toggle` 一直停在**最初的 mock 状态**。
   → **不要以 GitHub 分支为准**。当前真实状态 = 分支初始状态 + 已交付的 Prompt 9~15（用户本地已执行）。以本文档为准。
3. **仓库**：`github.com/yuhong-zhang202/LingoBridge`，分支 `feat/home-ielts-toggle`。
4. **本地运行**：`npm run dev`。**用麦克风必须 localhost 或 HTTPS**（浏览器安全限制）。
5. **密钥**：全部在 `.env.local`（不提交 git），通过 `src/lib/env.ts` 统一访问。
6. **每次写 prompt 的开头模板**：先读 ENGINEERING.md 和 DESIGN.md；只改指定文件；颜色用 Tailwind token 不内联；冲突时用项目原有 token。

---

## 1. 产品是什么

**LingoBridge** 是一款面向中国雅思口语备考生的练习 App（移动端 web / PWA）。

**一句话定位**：用"讲自己的真实故事"来练口语，而不是背模板、刷题库。把用户真实经历整理成素材，反向匹配到当季真题，再通过低压 AI 对话练习，让用户在即兴表达中学会开口。

**情感目标**：让人更轻松地表达——不评判、不打分、不制造考试焦虑。

**灵魂功能 🔨 重新表达**：练习对话中，用户对自己刚说的某句话点 🔨，AI 给出更地道的版本（"Do you wanna try: '…'"）+ 一句中文说明，用户可照着重新说。灵感来自"最想重新表达的一瞬间，是话说出口才发现说错的那一刻"。纯用户触发，不打断、不自动标红。

---

## 2. 当前进度总览

**整个核心闭环已全部真实化**（从录音到反馈收藏，端到端真实 AI 驱动）：

| 步骤 | 页面 | 状态 | 驱动 |
|---|---|---|---|
| 1 语料输入 | `/recording` | ✅ 真实 | OpenAI Whisper |
| 2 AI 整理 | `/restructure` | ✅ 真实 | 千问 Qwen Flash |
| 3 题目匹配 | `/matching` | ✅ 真实 | Claude（萃取观察点→反向匹配） |
| 4 侧重点分析 | `/analysis` | ✅ 真实 | Claude Sonnet 4.6 |
| 5 练习对话 | `/practice` | ✅ 真实 | Claude Haiku 4.5（教练 + 🔨） |
| 6 卡片反馈 | `/feedback` | ✅ 真实 | localStorage 收藏 |

**剩余为支撑性工作**（见第 9 节）：无意义语料处理、登录、Empty 界面、测试。

---

## 3. 完整用户流程（6 步主流程）

顶部 5 步进度条：**故事 / 整理 / 题目 / 分析 / 练习**。页面间用 URL params 传值。

1. **`/recording`**：按住说话讲一段真实经历（中文）→ Whisper 转文字 → 跳 `/restructure?rawText=...`
2. **`/restructure`**：千问把口语化叙述整理成清晰中文短文，用户可编辑 → 进 `/matching`
3. **`/matching`**：Claude 从故事萃取观察点 → 反向查询题库 → 展示"你这个故事能答的真实当季真题"。选题 → `/analysis?questionId=<UUID>&storyId=1`
4. **`/analysis`**：Claude 针对该题生成"答题侧重点"+"可用句式框架"。→ `/practice?questionId=...&storyId=1`
5. **`/practice`**：Claude Haiku 当**对话教练（非考官）**，顺侧重点引导、自然融入 Part 3 追问；用户按住说话→Whisper→AI 回复。每句话左上角有 🔨 可优化。点"结束"→ 把本场 🔨 优化暂存 → `/feedback`
6. **`/feedback`**：把本场点过 🔨 的句子做成卡片（原句+优化句），**左滑跳过/右滑收藏**，收藏进 localStorage 表达库。

**另一入口——首页切换**：首页有"故事模式 / 雅思模式"切换。雅思模式随机抛一道真题作灵感，引导用户针对它讲想法，再进同一条流程。

---

## 4. 产品结构

### 4.1 维度体系（底层骨架）

6 维度、44 观察点，用来理解用户、驱动反向匹配：

| 维度 | code 前缀 | 含义 | 观察点数 |
|---|---|---|---|
| 情绪内核 | EMO | 如何与自己相处 | 13 |
| 人际羁绊 | REL | 如何与他人/动物联结 | 11 |
| 空间感知 | SPA | 与物理空间的关系 | 7 |
| 精神栖所 | SPI | 书影音/物件/数字栖居 | 6 |
| 成长演进 | GRO | 如何蜕变（技能/复盘/未来） | 7 |
| 价值底色 | VALUE | 相信/看重什么（横向萃取，未做） | — |

观察点 code 形如 `EMO_04`、`SPA_03`。**饱和度算法**：维度覆盖度 = Σ min(该点语料数, 阈值) ÷ Σ阈值。

### 4.2 题库（Supabase 已 seed）

当季真题 **657 道**：Part 1 = 224 / Part 2 = 63 / Part 3 = 370。
- **277 道**映射到观察点（可被故事覆盖、参与反向匹配）
- **8 道** topic_only（知识题，进首页切换池）
- Part 3 通过 `parent_card_id` 挂在对应 Part 2 卡片下，练习对话中自然融入

---

## 5. 技术架构

### 5.1 技术栈
- **前端**：Next.js 14（App Router）+ PWA、Tailwind CSS v3、TypeScript（strict）
- **部署**：Zeabur + 腾讯云香港 VPS（移动端 web 为主，max-w-[430px] 居中）——非 Vercel（大陆访问不稳）
- **后端/数据**：Supabase（PostgreSQL，project `jzoxnxgbvshiwctwvrwd`，区域 ap-southeast-1 / 新加坡；2026-07 迁自 `tvdzkcnnszjynzzvtptk`/eu-central-1）
- **依赖**：`@supabase/supabase-js`、`framer-motion`、`lucide-react@^1.14.0`（老版，部分图标缺失，必要时用 emoji）、`next-pwa`、`server-only`、`clsx`、`tailwind-merge`

### 5.2 目录结构

```
src/
├── app/
│   ├── page.tsx                 # 首页（故事/雅思模式切换；用 ambient-light）
│   ├── recording/page.tsx       # 录音（用 ambient-light）
│   ├── restructure/page.tsx     # AI 整理
│   ├── matching/page.tsx        # 题目匹配
│   ├── analysis/page.tsx        # 侧重点分析
│   ├── practice/
│   │   ├── page.tsx             # 练习对话
│   │   └── _components/         # OrbSoft / AiBubble / UserBubble / RephrasePopup
│   ├── feedback/page.tsx        # 反馈卡片
│   └── api/                     # 见 5.4
├── components/                  # Orb / StepBar / TabBar / TopBar / Waveform
│   │                            #  / PartTag / GradientNumber / FeedbackCard
├── services/                    # 见 5.3（server-only，含 AI 调用）
├── hooks/                       # useAudioRecorder（真录音）/ useRecording（legacy 已弃用）
├── lib/
│   ├── types.ts                 # 全部类型
│   ├── constants.ts             # GRADIENT_BORDER_STYLE(_FULL)、DIMENSION_LABEL 等
│   ├── env.ts                   # 环境变量统一入口
│   ├── storage.ts               # 浏览器存储封装（session/local）
│   ├── utils.ts                 # cn() 等
│   └── db/                      # questions / observation-points / dimension-scores / corpus
└── data/                        # mock（questions.ts；analysis.ts 已弃用不删）
```

**工程规范**：单文件 ≤ 1000 行；Page ≤ 150 行、UI 组件 ≤ 80 行（超出拆 components）；每文件顶部 `@module` 注释；AI 调用必须 30s 超时（AbortController）；server 专用密钥不加 `NEXT_PUBLIC_`；`useSearchParams` 必须包 `<Suspense>`。

### 5.3 服务层（`src/services/`，均 server-only）

| 文件 | 职责 | 调用的 AI |
|---|---|---|
| `transcription.ts` | 录音→文字 | OpenAI Whisper（`whisper-1`, language=zh） |
| `restructure.ts` | 口语中文→清晰短文 | 千问 Qwen Flash（DashScope） |
| `extraction.ts` | 中文语料→43 观察点分类（主/副维度） | Claude `claude-sonnet-4-6` |
| `matching.ts` | 萃取→反向匹配真题 | （复用 extraction + db 查询） |
| `analysis.ts` | 题目→侧重点 + 句式框架 | Claude `claude-sonnet-4-6` |
| `practice.ts` | `buildScaffold` / `coachReply`（对话教练）/ `polishSentence`（🔨） | Claude `claude-haiku-4-5` |

### 5.4 内部 API 路由（`src/app/api/`）

| 路由 | 方法 | 作用 |
|---|---|---|
| `/api/transcribe` | POST (FormData 音频) | Whisper 转写 |
| `/api/restructure` | POST | 千问整理 |
| `/api/extract` | POST | 萃取观察点 |
| `/api/matching` | POST | 反向匹配 |
| `/api/analysis` | GET `?questionId` | 生成侧重点分析 |
| `/api/questions` | GET | 查题（首页切换池等） |
| `/api/practice` | POST `{questionId,messages,scaffold?}` | 对话：首轮建脚手架+开场，后续续聊 |
| `/api/practice/polish` | POST `{sentence,aiQuestion?}` | 🔨 优化一句英文 |

### 5.5 AI 模型分工（按任务选最优）

| 任务 | 模型 | 为什么 |
|---|---|---|
| 语音转写 | OpenAI Whisper | 简单同步、直接 multipart |
| 语料整理 | 千问 Qwen Flash | 中文口语化整理 |
| 维度萃取 + 题目分析 | Claude Sonnet 4.6 | 精准结构化判断 |
| 练习对话教练 + 🔨 优化 | Claude Haiku 4.5 | 延迟最稳（TTFT~600ms、p95 稳）、指令遵循最强（角色不出戏）；已对比验证优于 Gemini Flash |

**环境变量（`lib/env.ts`）**：Supabase URL/key、`DASHSCOPE_API_KEY`（千问）、`ANTHROPIC_API_KEY`（Claude）、`OPENAI_API_KEY`（Whisper）。

### 5.6 数据层

**Supabase 表**：`questions`（题库）、`question_observation_links`（题↔观察点）、`observation_points`（观察点）、`dimension` 相关、`corpus`（语料，但**故事目前未真正持久化**，`storyId` 在流程中写死 `'1'`）。

**db 函数（`lib/db/questions.ts`）**：`getQuestions(part?)`、`getQuestionsByObservation(...)`、`getRandomSwitchQuestion(...)`、`getQuestionById(id)`、`getQuestionsByParent(cardId)`（查 Part 2 的 Part 3 追问）。另有 `observation-points.ts`、`dimension-scores.ts`、`corpus.ts`。

**浏览器存储（`lib/storage.ts`）**：
- `sessionStorage` key `lingobridge:session_polishes` —— practice→feedback 本场暂存
- `localStorage` key `lingobridge:saved_phrases` —— 持久收藏（"我的表达库"）
- ⚠️ 登录后把 `saved_phrases` 迁到 Supabase，**只需替换 `storage.ts` 实现**，其他代码不动

---

## 6. 关键设计决策（重要的"为什么"）

1. **practice 是"温暖对话教练"，不是考官**：低压、不评判、不打分、不纠错；英文对话但语气随和；Part 3 追问**化进自然 follow-up，绝不报"现在 Part 3"**；移除了 mock 里的 `Round X` 标签和 `1/3` 计数器（去考试味）。
2. **🔨 纯用户触发**：不做自动标红/enhance 提示（多轮里会越来越吵、打击积极性）。🔨 安静待在每个用户气泡左上角，想用才用。点了弹"Do you wanna try" + 一句中文说明；重新说 = 正常新消息，AI 顺新句继续；不点则对话照常。
3. **AI 暂以文字气泡呈现（无 TTS）**：practice 的 AI 回复是文字（不是假语音条）；让 AI 真发声（TTS）是后续。
4. **feedback 是"保留你优化过的句子"，不是成绩单**：卡片左滑跳过/右滑收藏，攒成个人表达库。
5. **存储分层**：本场暂存 sessionStorage（不需登录）+ 持久收藏 localStorage（登录后迁 Supabase）。feedback 不持久化整段对话，只存被收藏的句子。
6. **analysis 只针对题目生成**（不结合用户故事）：因 `storyId` 是占位 `'1'`、故事未持久化。故事关联是后续增强。
7. **🔨 与对话共用 Claude Haiku**：已集成、无需新 provider。

---

## 7. 设计规范速查（DESIGN.md）

- **色彩**：暖橙主色 `#D4875A`（`brand-primary`）+ 绿蓝副色 `#7BA699`（`brand-accent`）；页面底色米色 `#F5F2EE`（`bg-bg-page`）；卡片纯白 `#FFFFFF`。
- **渐变**：仅用于**描边**（橙→绿 135°，外层渐变 + padding:1px + 内层白底），**禁止渐变填充背景**。常量 `GRADIENT_BORDER_STYLE` / `GRADIENT_BORDER_STYLE_FULL`（`lib/constants.ts`）。
- **主按钮**：白底 + 渐变描边 + `text-[#444]`，`rounded-full`，**严禁渐变填充**。
- **普通卡片**：`bg-white` + `border border-black/[0.05]`，`rounded-[20px]`，无阴影。**强调卡片**（AI 输出）：`GRADIENT_BORDER_STYLE_FULL`。
- **强调标签**：全局统一绿色系 `bg-[#EDF6EB]` / `border-[#C0DDB9]` / `text-[#3D7A38]`。
- **用户气泡**：`bg-[#EDF6EB]` + `border-[#C8E0C4]`（绿）；AI 气泡白底 + 🌿 绿叶头像。
- **TopBar**：`bg-bg-page`，`h-[52px]`，返回按钮 30×30 圆形白底 shadow-sm。**TabBar**：`bg-bg-page`，56px，除 `/recording`、`/practice` 外所有页面显示。
- **ambient-light**：仅 `/` 和 `/recording` 两页允许，其他页面禁止。
- **核心视觉**：Orb（弥散光晕球，响应音频电平）、OrbSoft（练习页底部云团）、🌿 绿叶 emoji 头像、胶囊按钮。
- 禁止内联色值、禁止 v1 旧色板、禁止通用字体（Inter/Roboto/Arial）。

---

## 8. 已交付 Prompt 清单（本阶段）

> 早期（Prompt 1~8 等）已完成基础：题库 seed（657 题入库）、维度萃取服务、饱和度计算、首页故事/雅思切换、GitHub 上传等。本阶段（9~15）把前端 mock 逐页接真：

| # | 标题 | 做了什么 |
|---|---|---|
| 9 | matching 真实化 | 故事→萃取观察点→反向匹配真实真题；加 `DIMENSION_LABEL`、`MatchedQuestion` 等 |
| 10 | restructure 真实化 | 首页副标题统一；restructure 真调千问（修 `rawText` 参数 bug、加错误态） |
| 11 | recording 真实化 | Whisper 真转写；新建 `useAudioRecorder` hook + `/api/transcribe`（不改 `useRecording`） |
| 12 | analysis 真实化 | Claude 针对题目生成侧重点+句式；加 `getQuestionById`、`services/analysis.ts` |
| 13 | practice Phase 1 | Claude Haiku 对话核心；脚手架（侧重点+真实 Part 3）；录音转写续聊；AI 文字气泡；去 Round/计数器 |
| 14 | practice Phase 2 | 🔨 重新表达机制；`polishSentence` + `/api/practice/polish`；用户气泡加 🔨；回复建议改 "Do you wanna try" |
| 15 | feedback 真实化 | 本场 🔨 优化→卡片左滑跳过/右滑收藏→localStorage 表达库；`lib/storage.ts`；空态/完成态 |

> 另交付：`LingoBridge-产品详细介绍.md`（产品全貌文档）。

---

## 9. 待办 Roadmap

**接下来要做（用户已规划，按建议优先级）**：
1. **无意义语料处理** —— 用户空录音/瞎说/跑题时如何处理（影响整条链路稳定性，建议优先）
2. **登录界面 + Supabase 迁移** —— 引入用户身份；把 localStorage 的 `saved_phrases` 迁到 Supabase（按 user_id），首次登录合并
3. **Empty 界面** —— 首次启动、无任何数据时的全局空态（区别于 feedback 页"本场无优化"的局部空态）
4. **功能性测试 + 稳定性测试**

**已知技术债 / 后续增强**：
- **故事持久化**：当前 `storyId` 写死 `'1'`，故事未真正入库；做了之后 analysis 可结合用户故事生成
- **"我的表达库"浏览页**：收藏已落 localStorage，但还没有浏览所有收藏的入口（建议放「素材库」或「我的」，随登录一起做）
- **TTS / AI 发声**：practice 的 AI 和 feedback 卡片的播放按钮目前不发声（可接浏览器 SpeechSynthesis 或 TTS API）
- **VALUE 价值底色维度**：横向萃取尚未实现
- `useRecording` hook 已无人使用（可清理）；`data/analysis.ts`、`practice/_components/SuggestionsPopup.tsx` 已弃用

---

*本文档为 LingoBridge 截至 2026-06-03 的完整开发现状，供下一个对话/协作者无缝接手。*
