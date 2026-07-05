# 桌面端核心链路重设计方案

> 范围：仅桌面端（≥1024px）核心链路 6 页（story/录音 → restructure → matching → analysis → practice → feedback）。
> 移动端一像素不动。首页、题库、素材库、我的不在本次范围。
> 架构：跟随项目已有成熟模式 —— `page.tsx` 只取数并按 `lg` 断点分发 `XxxMobile` / `XxxDesktop` 两套独立组件（本决定已由你确认，覆盖任务原文"不新建独立文件"一条）。
> 硬约束：品牌色不变（暖橙 `#D4875A` + 绿蓝 `#7BA699`）；颜色只用 token；组件复用 `<Card>/<Tag>/<Chip>/<GradientButton>/<TopBar>` 等；字体/圆角/间距 token 不变。

---

## 一、总体设计方向（全局）

### 1.1 一句话定位

核心链路是一条**线性练习会话**（录音 → 确认 → 匹配 → 分析 → 练习 → 反馈），不是可自由跳转的管理页。所以桌面端不套用管理页的 `TopNav + 1120px 容器` 那套导航外壳，而是走**"沉浸流程"** 范式：进入链路即进入专注态，去掉全站导航诱饵，只在**顶部保留一条极简进度栏**指示"在旅程哪一步"。这条决定不是新发明——现有代码在这 6 页上已经用 `lg:hidden` 把 TabBar 藏掉、并写了"流程页桌面端沉浸"的注释，本方案把这个未完成的意图正式做成设计。

> 设计演进记录：本方向最初尝试过"左侧 240px 竖向旅程轴（FlowRail）"，经三轮评审（竖轴太行政感、与柔和的 Orb 舞台不协调）后**改为"去掉左栏 + 顶部极简进度"**，FlowRail 组件已删除。下文 §1.2 起均为最终实现。

### 1.2 桌面整体布局策略

**去掉左栏；顶部一条极简进度栏（`FlowShellDesktop`）取代移动端顶部横向 StepBar + 底部 TabBar，下方是整片留白里居中的舞台区。** 无侧面板、无硬边框分隔，整页同底色，让柔和的 Orb 舞台成为唯一主角。

```
┌──────────────────────────────────────────────────────┐
│ ◆ LingoBridge      ●▬ ● ● ● ●  故事            ✕     │  ← h-[72px] 顶栏
├──────────────────────────────────────────────────────┤
│                                                      │
│                   舞台内容区（居中）                    │
│                                                      │
│                focus 档  max-w-[600px] 居中           │
│                split 档  max-w-[960px] grid-cols-2   │
│                master 档 max-w-[1040px] 列表+详情     │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**`FlowShellDesktop` 规格（新增桌面外壳组件；顶栏进度内联，复用 `StepBar` 的步骤数据 `STEPS`）：**
- 根容器：`min-h-screen bg-bg-page flex flex-col`。
- 顶栏 `<header>`：`relative h-[72px] px-8 flex items-center justify-between`，**无边框**、与舞台同底色（沉浸无缝）。
  - **左·品牌**：`w-9 h-9 rounded-[10px] bg-brand-primary` 里放 `<Mic size={18}/>` + `text-[17px] font-bold` "LingoBridge"，点击回首页（逃生口之一）。
  - **中·进度（绝对居中）**：5 个圆点 + 当前步名。圆点 `h-[7px]`，当前为**拉长胶囊** `w-[26px] bg-brand-primary`、已完成 `w-[7px] bg-brand-primary`、未到达 `w-[7px] bg-[#DDDDDD]`；点距 `gap-[14px]`，与步名间距 `gap-5`。步名 `text-[13px] font-semibold text-v2-text-primary`。整组安静、仅当前胶囊用品牌暖橙，不与 Orb 抢注意力。附 `sr-only`「第 N 步，共 5 步：X」。
  - **右·退出**：`w-9 h-9 rounded-full` 的 ✕ 按钮，`hover:bg-bg-muted`（逃生口之二）。
- 舞台内容区：`flex-1 min-h-0`，承载各页 `XxxDesktop`。
- 进度点**不可点跳转**，只作指示（`aria-hidden`）。

6 个 `XxxDesktop` 统一包在 `FlowShellDesktop` 内，进度由 `activeStep` prop 驱动，状态一致。

**内容区宽度三档（全局统一，避免每页各拍脑袋）：**
| 档位 | 宽度 | 用于 | 依据 |
|---|---|---|---|
| focus | `max-w-[600px]` 居中单列 | story、practice、feedback | 单焦点/情绪性/阅读性内容，窄列更专注 |
| split | `max-w-[960px]` `grid-cols-2 gap-8` | restructure、analysis | 天然成对信息（原话\|整理、侧重点\|词组）左右并置 |
| master | `max-w-[1040px]` 列表+详情 | matching | 题目列表 + 选中题实时详情（master-detail） |

### 1.3 桌面 vs 移动的差异化原则（桌面做移动做不到的）

1. **沉浸 + 顶部进度**：移动端 StepBar 是一条 10px 高的横条夹在内容里；桌面把导航压成顶部一条极简进度栏（5 点 + 当前步名），其余空间全部让给居中的 Orb 舞台，给出"专注当下这一步"的沉浸感。进度点编码"在旅程哪一步"这一真实信息，安静克制、不喧宾夺主。
2. **多列同屏**：restructure 的"原话 \| 整理后"、analysis 的"侧重点 \| 词组"从移动端的上下堆叠改为左右并置，减少滚动、让"输入→产出"的对照关系一眼可见（restructure/analysis 现有代码已有 `lg:grid-cols-2` 雏形，本次把它做成正式两栏版式）。
3. **master-detail**：matching 从移动端"点卡片展开"改为"左列表 + 右侧选中题实时详情"，鼠标点不同题右侧即时刷新，去掉逐张展开的滚动。
4. **鼠标 hover + 键盘**：桌面补上移动端没有的 hover 态（卡片浮起、动作按钮渐显）与键盘流转（Enter/→ 进入下一步、数字键选题、Space 停止录音），让高频链路可"手不离键"走完。

### 1.4 参照对象（借鉴的是具体设计决策，不是外观）

- **Linear** —— 借鉴其"**键盘优先流转**"这一决策，用于全链路快捷键（如录音页 Space/R/Esc）；**不**借鉴其深色/acid 配色，配色仍是本项目暖橙+绿蓝。
- **Typeform / onboarding 流** —— 借鉴其"**流程进行中隐藏全站导航、一屏一焦点、顶部只留一条极简进度**"的决策，正是本方案"去左栏 + 顶部进度栏 + 桌面藏 TabBar"的取舍来源。
- **Raycast** —— 借鉴其"**列表在左、活体详情在右**"的 master-detail 决策，用于 matching 页。
- **Notion** —— 借鉴其"**正文阅读列有克制的最大宽度**"这一决策，用于 restructure/analysis 的文本列宽（不让整理后的故事拉满整屏）。

### 1.5 全局复用 vs 新增

**复用（不改）：** `<Card>`、`<Tag>`、`<Chip>`、`<GradientButton>`、`<TopBar>`（移动端保留）、`<Orb>`、`<Waveform>`、`<Skeleton>`、`<EmptyState>/<OfflineState>`、`StepBar`（移动端保留 + 桌面复用其步骤数据/token）、各业务子组件（`MatchedQuestionCard`、`NoMatchView`、`PhraseDetailCard` 等）、所有 hooks/service/数据层（`useAudioRecorder`、`/api/*` 全不动）。

**新增（桌面专用，均在 `lg` 分支渲染，移动端不受影响）：**
- `src/components/desktop/FlowShellDesktop.tsx`（顶部进度栏 + 舞台外壳；顶栏进度内联）
- 6 个 `XxxDesktop.tsx`（RecordingDesktop / RestructureDesktop / MatchingDesktop / AnalysisDesktop / PracticeDesktop / FeedbackDesktop）
- 各 `page.tsx` 抽出的 `XxxMobile.tsx`（把现有移动端 JSX 原样搬进去，不改样式）
- 每页一个 `types.ts`（`XxxViewProps`：移动/桌面视图共享的状态+回调，逻辑集中在 `page.tsx` 外壳持有）

> 已决策（原开放项，均已定）：
> 1. **组件架构**：走"拆分独立文件"（`page.tsx` 外壳持有状态/逻辑 + `XxxMobile`/`XxxDesktop` 纯展示），跟随 library/profile/question-bank 成熟模式；覆盖任务原文"不新建独立文件"。
> 2. **退出入口**：保留。顶栏右上 ✕ + 品牌 logo 点击回首页，两个逃生口。
> 3. **旅程轴形态**：由左侧竖轴（FlowRail）改为顶部极简进度栏；FlowRail 已删除。

---

## 二、每个页面的重设计方案

> 本轮按执行方式只先产出 `/story`（录音页）一节。你确认审美方向后，我再补 2.2–2.6（restructure/matching/analysis/practice/feedback）。

### 2.1 /story —— 录音页（`src/app/recording/page.tsx`）

> 角色：核心链路第 1 步。用户对着 Orb 讲一段真实经历，完成后转写进入整理流程。是整条链路里情绪最"软"、最需要低压感的一屏。

#### 2.1.1 现状诊断

桌面端只是把移动端布局塞进一个 `lg:max-w-3xl` 居中列：260px 的小 Orb 浮在大片空白中央，底部是一条移动端式的"完成录音"贴底按钮——像一台手机截图漂在网页正中，既没有"这是旅程第 1 步"的位置感，也没有利用桌面的空间做出"被安静聆听"的氛围。

#### 2.1.2 重设计思路

- **布局架构**：`FlowShellDesktop` 外壳（顶栏进度"故事"激活），舞台内 focus 档 `max-w-[600px]` 居中单列、整列垂直+水平居中（`justify-center`）。
- **信息密度：刻意压到最低。** 讲真实故事是脆弱时刻，这一屏要"留白比信息多"。桌面多出来的空间不拿去堆内容，而是拿去做呼吸感。
- **Orb 升为主角（hero=thesis）**：从 260px 放大到 `size={340}`，作为"安静聆听的 AI 在场"这一情绪锚点——Orb 本就是产品核心视觉，桌面给它主舞台。保留 `ambient-light`（DESIGN.md 允许 `/recording` 用 ambient-light），桌面上这团弥散光晕在 Orb 背后铺开，就是本页的氛围签名。
- **视觉节奏**：Orb（大）→ 实时波形 + "listening…" → 计时器（`text-[22px] tracking-[2px]`，token 不变）→ 一行录音建议，之间用大间距（`gap-8`）拉开；下方是**居中的动作簇**（"完成录音"主按钮 + "重录"次按钮），不再是贴底工具条——桌面已隐藏 TabBar，按钮回到内容流里居中，不必 `fixed` 贴底。
- **与移动端差异**：移动端 Orb 小（260）、完成按钮 `fixed` 贴 safe-area；桌面把整屏组成一个居中的"聆听舞台"，Orb 更大（340）、顶部一条极简进度栏、计时与提示有更多留白，动作簇随内容居中、不再贴底。移动端版式与逻辑一字不改。

#### 2.1.3 关键交互变化（桌面特性，3 个）

1. **键盘控制录音（手不离口）**：`Space` = 完成录音、`R` = 重录、`Esc` = 退出。依据——用户正在开口说话，伸手找鼠标会打断表达节奏；说完一句"空格"收尾最自然。（移动端靠触屏点按，无此层。）
2. **更宽的波形 + 计时可读性**：桌面 Orb 下方 `<Waveform active className="scale-[1.55]">` 放大展示"聆听中"（注：`Waveform` 是纯 CSS 动画、不吃 `audioLevel`，真正随声音实时起伏的是 **Orb**）；计时器进入 30s 后用 `text-success` 轻点一下（`transition-colors` 平滑），暗示"已进入推荐时长区间"，不打断、不弹窗。（移动端只放极小 Waveform + 静态提示。）
3. **hover 态**：完成录音按钮 `hover:-translate-y-[2px]` + 阴影轻微浮起（移动端无）；"重录"文字按钮 `opacity-60 → 100` 渐显。

#### 2.1.4 复用的现有组件 vs 需要新增的组件

**复用（不改）：**
- `<Orb>`（仅调 `size` prop 到 340）、`<Waveform>`、`<Toast>`、`RequireAccountGate`
- `useAudioRecorder`、转写/整理 `/api/*` 调用与所有业务逻辑（`handleFinish`/`handleRerecord` 等原样）
- 完成录音按钮沿用现有 `.btn-gradient` 大按钮样式（带停止方块图标）——DESIGN.md 的 `GradientButton` 例外清单里录音类专用控件本就不强制换，保持一致

**新增（桌面）：**
- `RecordingDesktop.tsx`：本页桌面"聆听舞台"，包在 `FlowShellDesktop` 内；含内联键盘监听（`Space/R/Esc`，按视口过滤仅桌面生效、且置于账号闸门放行后才挂载）
- `RecordingMobile.tsx`：现有渲染原样搬入、改为接 props 的纯展示组件（移动端零改动）
- `recording/types.ts`：`RecordingViewProps`（两视图共享的状态+回调）
- 复用全局新增的 `FlowShellDesktop`
- `page.tsx` 改为外壳：**集中持有录音逻辑（`useAudioRecorder` 单实例、单麦克风流）**，按 `lg` 分发两视图（移动 `RecordingMobile` / 桌面 `FlowShellDesktop` + `RecordingDesktop`）；`recording` 无远程取数，主要是 `Suspense` + `qid` 透传

> 拆分要点（防坑）：录音逻辑不能复制进两个视图——`useAudioRecorder` 的防重入守卫是"每实例一份 ref"，双挂载会开两路麦克风。故逻辑集中在 `page.tsx` 外壳，视图纯展示（与 library 模式一致）。

---

> §2.2–2.5（restructure / matching / analysis / practice）仍待补。以下 §2.6 为第二批第 1 页。

### 2.6 /feedback —— 反馈卡片页（`src/app/feedback/page.tsx`）

> 角色：核心链路**最后一步**（练习之后）。回顾本场练习中你点 🔨 优化过的句子，逐张决定「跳过」或「收藏进表达库」，是"讲→练→反馈"闭环的收尾与奖赏时刻。
> ⚠️ 进度归属：feedback 属于「练习」步的收尾，移动端本就用 `<StepBar currentStep="practice">`。`FlowShellDesktop` 的 `activeStep` 类型 `StepKey` **不含 `feedback`**，故桌面用 **`activeStep="practice"`**（与移动端一致，进度栏第 5 点「练习」为当前态）。不新增第 6 步——那会给移动端所有流程页的 StepBar 多一个点，违反"移动端零改动"。
> ⚠️ feedback 是 DESIGN.md 的移动端视觉基准页，`FeedbackMobile` 已字节级搬运、零改动；本节只设计桌面视图。

#### 2.6.1 现状诊断

桌面端只是把移动端的窄卡片列（`lg:max-w-xl` 居中）塞在大屏中央：一张小卡片顶在页面上方（`pt-6`），下面跟着跳过/收藏两个按钮，四周大片空白，没有"专注回顾一张张卡"的舞台感，也没用上桌面的键盘/hover。

#### 2.6.2 重设计思路

- **布局**：`FlowShellDesktop` 外壳（顶栏进度 practice 激活），focus 档 `max-w-[600px]` 居中单列、垂直居中，延续 recording「专注舞台」气质。
- **卡片主角化**：`FeedbackCard` 居中占舞台中心；保留身后的**叠卡** peek（`rotate(2.5deg) scale(0.96)`，还有下一张时显示），暗示"还有卡在后面"。卡片宽度收在 `max-w-[460px]` 居中，避免被拉到 600 显得空。
- **计数换位**：移动端把 `index/total` 放在 TopBar 右侧；桌面顶栏是 5 步进度、放不下，所以把「本场回顾 · N / 总」作为**卡片上方一行安静 caption**（`text-v2-text-muted`）。
- **保留强调基调**：`FeedbackCard` 内的 AI 优化标签、渐变边框等原样（复用组件，视觉不动）——满足"保留移动端所有强调卡片视觉基调"。
- **信息密度低、留白足**：与 recording 一致的沉浸收尾感；空态/完成态为居中 emoji + 文案 + 回首页 `GradientButton`，复用移动端文案。

#### 2.6.3 关键交互变化（桌面特性，3 个）

1. **键盘评审（鼠标不动刷完）**：`←` 跳过、`→` 收藏、`Esc` 退出回首页——一路方向键刷完本场卡片。与 recording 一样按视口过滤（仅 ≥1024px 生效）、且置于内容渲染处（空态/完成态不挂监听）。
2. **鼠标拖拽保留 + hover**：沿用外壳已有的 mouse drag（左滑跳过 / 右滑收藏，`onMouseDown/Move/Up/Leave`）；hover 时收藏按钮轻微浮起、跳过按钮描边加深，明确可点。
3. **叠卡 / 飞出动画在大屏更可读**：`offset` 拖拽位移与 ±500 飞出动画原样复用，桌面卡片更大、方向更明确。

#### 2.6.4 复用 vs 新增

**复用（不改）：** `<FeedbackCard>`、`<GradientButton>`、`FlowShellDesktop`、`X`/`Heart` 图标；拖拽/收藏/跳过/读暂存全部复用外壳里已持有的逻辑（`dragStart/dragMove/dragEnd/collect/skip`），经 `FeedbackViewProps` 传入。

**新增（桌面）：** `FeedbackDesktop.tsx`（本页桌面视图，含内联键盘监听）。**无新增共享组件**（外壳复用 `FlowShellDesktop`）。

---

## 三、实施进度（/story）

- ✅ Step 1：`recording/page.tsx` 拆为外壳 + `RecordingMobile`（纯展示）+ `types.ts`；移动端视觉/逻辑零改动
- ✅ Step 2：新增 `FlowShellDesktop`（初版为左轴，后改顶部进度）
- ✅ Step 3：`RecordingDesktop` 聆听舞台（Orb 340 + 宽波形 + 计时器 30s success + 居中动作簇 + 键盘控制）
- ✅ 左栏方向调整：FlowRail 三轮评审后废弃 → 顶部极简进度栏；顶栏进度指示加宽（点距 14px、当前胶囊 26px）
- ⏳ Step 4：视觉验收待人工在 ≥1024px / <1024px 双断点确认；`tsc --noEmit` 与 `next lint` 已通过

*首轮范围为 /story。审美方向确认后再补 §2.2–2.6（restructure/matching/analysis/practice/feedback）。*
