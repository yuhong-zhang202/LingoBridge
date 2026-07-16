# LingoBridge 工作路线图

> 整理日期：2026-06-04 晚（北京时间）
> 用途：记录 VALUE 解锁块的进度，以及之后各梯队的后续工作与优先级。
> 配套文档：LingoBridge-产品介绍-2.0.md（维度体系与匹配机制设计定稿）、
> LingoBridge-开发交接文档-2026-06-04-晚.md、ENGINEERING.md、DESIGN.md。

---

## 当前主线：VALUE 维度解锁

按依赖顺序，命中即停的硬依赖：**任务 3 必须在任务 4 之前完成**（否则萃取到 value 却无题可配，体验比锁死还糟）。

### ✅ 任务 2 · 产品设计（已完成）

定稿在《LingoBridge-产品介绍-2.0.md》。核心结论：
- VALUE 解锁为 3 个观察点：VAL_01 公平感与正义、VAL_02 诚实与信任、VAL_03 坚持原则。
- 三层漏斗匹配机制（primary → secondary → 温柔收尾）。
- 灵魂标记机制（primary 全程跟随故事，传到练习环节）。
- 第二层质量闸门（secondary 是"角度"非"提到的实体"）。
- 题库公平缺口处理：方案 3（三层漏斗诚实兜底 + 不自造题 + backlog 留口子）。
- Part3 覆盖率 100%（故事模式 84% + 雅思模式兜底 15%，两条入口分工无遗漏）。

### ▶ 任务 3 · 数据落库（用户在 Supabase 手动跑 SQL，不让 Claude Code 碰生产库）

- **3.0 侦察先行**（已写好只读侦察 prompt，待用户在 Claude Code 跑）：确认三样事实——
  - `question_observation_links` 表结构（能否一题多观察点 + 区分主/副？）
  - `getQuestionsByObservation` 查询（是否只查 is_primary=true？）
  - 萃取 prompt 的 primary/secondary 输出与 secondary 定义
- **3.1** insert 三个 VALUE 观察点到 observation_points（VAL_01/02/03）。
- **3.2** 标注 Part2 卡：
  - "A Time You Told a Truth"（现 NULL）→ 标 VAL_02（顺带激活该卡，回收 4 道 Part3）。
  - "An Important Decision" → **保持 GRO_07 不动**（坚持原则类故事靠 secondary=GRO_07 回到此卡）。

> ⚠️ 侦察回报拿到后，才能给出精确到字段和 SQL 语句的 3.1/3.2 清单。当前产品介绍 2.0 第九章的清单是基于推断，细节待核。

### 任务 4 · 解锁萃取 + 完整版匹配（走 Claude Code 改代码，严格依赖任务 3）

- **4.1** 解锁萃取 prompt：删两处 value 锁 + 把 VAL_01/02/03 加进观察点清单。
- **4.2** 写入第二层质量闸门：prompt 明确"secondary 是角度/主题，不是提到的实体"。
- **4.3** 完整版匹配改造（用户已选完整版）：
  - 改 `getQuestionsByObservation`：主标签、副标签都查。
  - 加排序：副标签命中的题相关性更弱，排在主标签命中之后。
  - 数据层：`question_observation_links` 支持一题多观察点且区分主/副。
- **4.4** 三层漏斗 + 灵魂标记：matching 实现"primary 空→secondary→温柔收尾"；primary 透传到 practice。
- **4.5** 温柔收尾页：分析/匹配页新增"无题"状态，渲染场景 B 文案（共情句 AI 现场生成）。
- **验证**：讲 PayPal（公平）+ 说实话（诚实）两个故事走完整链路实测——①公平故事走第二/三层且文案贴合；②诚实故事直接匹配到"A Time You Told a Truth"。

---

## 第一梯队 · 核心质量（VALUE 之后）

- **小任务 1 收尾**：REL_11 平台冲突的萃取调优——代码已落。**2026-06-04 用户用 PayPal 故事实测，已确认归到 REL_11、生效**，可勾掉。
- **analysis 完全围绕用户故事重写**（用户要的重度版）：分析围绕用户故事、但不脱离题目（"用你的故事来答这道题"）。需先侦察 analysis 怎么拿数据、corpusId 怎么传到 analysis 页、generateAnalysis 的 prompt。地基已具备（corpus 有真实内容）。
- **practice 结合 analysis**：练习对话根据 analysis 产出来聊。依赖 analysis 先改好；practice 是多轮 + scaffold，比 analysis 复杂。**顺序：先 analysis、验证好，再 practice。**

---

## 第二梯队 · 修坏链接 / 清假功能

- **MyStoriesTab"查看"坏链接**：跳 `?storyId=`，但 matching 读 `?story=&corpusId=`——改 URL 参数，便宜。
- **article 功能 100% mock**：决策——真做（接 AI 生成）还是从导航隐藏？不能留假内容上架。

---

## 第三梯队 · 上架准备

- 录音页布局 bug（手机端 /recording 要下滑才能看完整提示，Orb 顶部被遮挡）。
- PWA 图标（icon-192.png 404，manifest 引用但文件不存在）。

---

## 第四梯队 · 数据归属 + 登录（放最后，纯接线）

- **Apple Sign In + 匿名账号升级**（用户上架 iOS，无需国内 ICP 备案）。前置：Apple Developer Program 付费账号（未开通）+ Supabase 配 Apple provider。
  - **关键认知**：登录可最后做、风险不大——前提是数据已按 user_id 持久化（已做到）。匿名 user_id 升级为 Apple 身份时 user_id 不变、数据自动保留。
- saved_phrases / 手机号 迁 Supabase（依赖登录）。
- targetBand 真实化（需 user_settings 表，可和登录一起）。

---

## 单独评估的大功能块

- TTS / AI 发声（practice 的 AI 和 feedback 播放按钮目前不发声）。
- "我的表达库"浏览页（收藏已落库/localStorage，但无浏览全部收藏的入口）。

---

## Backlog（非紧急，记录备查）

- **补"价值观/冲突"类题**：方案 3 的留口子。题库本身无"公平/冲突"题材，等产品成熟或有真题来源再评估自编或引入。
- **给 9 张 topic_only 卡补观察点**：野生动物、科学、微笑、想象、弄坏东西、停电、好服务、传统故事、等待。
  - ⚠️ **不是修遗漏的必做项**（雅思模式切换池已兜住这些卡的 Part3）。补观察点的目的仅是"让这些题材也能从**故事模式**萃取进入"——锦上添花的体验优化，**优先级低，别当紧急 bug 做**。
- **未被任何题使用的约 12 个观察点**：故事萃取到这些点作 primary 时第一层匹配为空，落到第二/三层。属"故事模式覆盖广度"优化空间，非遗漏。
- **8 个只被 Part1 用、Part2 没用的观察点**（家乡、住所、宠物、规则、人生阶段、早晨、散步、休息日）：讲这些主题的故事配到 Part1 题但带不出 Part3 深聊。同上，优先级低。

---

*本路线图记录截至 2026-06-04 晚间的工作规划，随进度更新。*
