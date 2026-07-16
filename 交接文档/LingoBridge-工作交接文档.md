# LingoBridge 工作交接文档

- **仓库**：github.com/yuhong-zhang202/LingoBridge
- **分支**：`feat/home-ielts-toggle`（最新 HEAD：`a7a924b`）
- **窗口范围**：2026-06-07 ~ 06-11
- **一句话**：继续打磨"真实生活故事 → 雅思口语素材 → 即时正反馈"的闭环。本窗口集中在**练习对话(Lior)、匹配稳定性、首页输入体验、词组收藏**四块。
- **本窗口给出的改动已全部提交并推送**（含 Prompt 9~15）。

---

## 一、本窗口已完成（已提交 + 已推送）

### 练习对话（Lior 对话页）— 主战场

| commit | 内容 |
|---|---|
| `85a692d` | 转写占位气泡移到用户侧；Lior 换渐变圆头像、用户换默认头像、🔨 → 线性图标 |
| `06d272d` | 用户头像改暖色 Orb（新组件 `OrbWarm`，与 Lior 冷色一冷一暖）；"换个说法"触发图标改 Sparkles ✨ |
| `cc2b274` | 流程轴 + 题目条固定在顶部，不随对话滚动 |
| `dcc5c25` | **Lior 按所选雅思水平调"问题难度"（英文始终自然、不降质）+ "换个说法"优化句子升半档**；`level` 从题目分析页经 URL 贯通到练习页，并存进 scaffold 跨轮保留 |
| `86b467d` | 外层改 `h-dvh` + `overflow-hidden`，顶部标题栏 / 流程轴 / 题目条加载时常驻、不被自动滚动推走 |
| `8cde2fe` | **低分档校准**：Lior 5.0~5.5 只问具体、一次一个的问题（禁抽象 / 多合一）；优化在低档克制、不塞 `zone out` / `flop down` 这类超纲习语 |

> 设定基准（务必保持）：Lior 永远说自然地道英文，**只调问题难度不降英文质量**；"换个说法"目标 = 所选水平 + 半档（"踮脚够得着"，不是别人的句子）。

### 匹配

| commit | 内容 |
|---|---|
| `358794e` | 萃取 / 排名 `temperature` 设 0，同一段故事稳定匹配同一题（消除"刷新一两次结果就变"的 bug）|

### 首页

| commit | 内容 |
|---|---|
| `a7a924b` | 文字输入态：云团缩小（96）、与文字区间距收窄（20）、输入框放大（`min-h` 240）——沉浸写作风格（A 方案）|

### 题目分析 / 词组 / 素材库 / 整理页

| commit | 内容 |
|---|---|
| `b9874c0` | 可用词组加雅思水平胶囊下拉，切换水平只重出词组 |
| `7126016` | 词组水平只调表达性词，时间 / 人物锚点保持朴素，6.0 更平实 |
| `da96318` | 整理页通用提示去方框、改分点提醒、下移到语料卡底部 |
| `f545604` | 词组收藏（localStorage）：星标收藏 → 素材库新增「词组收藏」Tab、左滑删除；语料卡左滑删除；"开始匹配"按钮随内容滚动 |

---

## 二、未完成 / 待办

### 功能打磨（可选，不阻断内测）
- **首页切换过渡动画**：目前是即时切换（云团光晕自带 0.08s 微动，不算硬切）。想要更明显的"缩放 / 上滑"过渡需单独加一条 prompt。
- **6.0 感受组词组仍偏高**：如 `all the tension just melts away` 更像 6.5–7；`tension melts away` / `coming back to life` 在多个档位复用。可后续一条微调 prompt，不阻断内测。
- **首页 B / C 风格**：已选 A（沉浸写作）；B（引导对话）、C（极简卡片）未做，想换随时回头。

### 待验证
- **5.0 vs 7.5 对比**：同一题用 5.0 和 7.5 各练一轮，确认 Lior 难度旋钮真的拉开差距（5.0 简单不问懵、7.5 更有深度）、优化幅度合理。低分档已用 5.0 实测并据此校准（`8cde2fe`），高档侧尚未对比验证。
- **首页 A 方案手机复核**：已提交，建议手机过一眼云团 / 输入框比例（可调：云团大小 `96`、输入框 `min-h 240`）。

### 内测前清单（更早记下，本窗口未处理）
- 邮箱真实验证
- matching 页 URL 隐私清理
- 各页空状态 / 错误态 / 边界态补全
- 首页右上角头像"死按钮"
- 素材库"…"菜单接删除
- PR：`feat/home-ielts-toggle` → `main`

---

## 三、环境 & 协作约定（给接手的人）

- **手机测录音**：dev / prod 都跑在 `localhost:3000`；手机测麦克风需 HTTPS——用 `npx cloudflared tunnel --url http://localhost:3000` 开临时 HTTPS 隧道，手机访问它输出的 `*.trycloudflare.com` URL（每次随机、需保持两个终端：一个 `npm start`，一个 cloudflared）。局域网 http（`192.168.x:3000`）**只能看页面 / 打字，麦克风会被浏览器拦**（非安全上下文）。纯视觉改动用局域网 http 即可。
- **样式经隧道加载不全时**：dev 模式偶发；`npm run build && npm start` 后样式稳定（cloudflared 不用重启）。
- **改动节奏**：拉最新（`git fetch && git reset --hard origin/feat/home-ielts-toggle`）→ 精确 find/replace 的可复制 md prompt → `npm run build` → 手机 / 浏览器确认 → commit → push。
- **只动指定文件**；颜色用 Tailwind token 或 `[方括号]` 色值，**不用内联 style 色值**（已有的除外）。
- **匹配 temperature**：萃取 / 排名已设 0（确定性）。若以后某类故事**稳定**匹配错，是萃取提示词 / 观察点定义的问题，不是 temperature。
- 沟通用中文，多确认；prompt 以可复制 md 形式给出。

---

## 四、关键文件速查

**练习对话**
- `src/app/practice/page.tsx` — phase 状态机、`handleUserTurn`、读 URL 的 `level`
- `src/app/practice/_components/` — `AiBubble` / `UserBubble` / `OrbSoft`(Lior 头像) / `OrbWarm`(用户头像) / `OrbMini` / `RephrasePopup`
- `src/services/practice.ts` — `buildScaffold` + `buildSystemPrompt`（Lior 提示词，含水平分档）；`POLISH_SYSTEM` + `polishSentence`（含升半档 / 低档克制）
- `src/app/api/practice/route.ts`、`src/app/api/practice/polish/route.ts` — 透传 `level`

**匹配**
- `src/services/matching.ts`（三层漏斗）、`extraction.ts`、`ranking.ts`（temperature 0）、`src/app/api/matching`

**题目分析 / 收藏 / 素材库 / 整理**
- `src/app/analysis/page.tsx`（词组卡、水平下拉、收藏、"开始练习"传 `level`）
- `src/components/library/SavedWordsTab.tsx`、`src/app/library/page.tsx`（三 Tab：我的语料 / 收藏卡片 / 词组收藏）
- `src/lib/storage.ts`（`saved_words` / `saved_phrases`）、`src/lib/types.ts`（`SavedWord`、`PracticeScaffold` 含 `level`）
- `src/app/restructure/page.tsx`

**首页**
- `src/app/page.tsx`（云团、故事 / 雅思切换、文字输入态）、`src/components/Orb.tsx`（接收 `className`，光晕自带 0.08s 过渡）

---

## 五、技术栈速记
Next.js App Router · Supabase（匿名会话 + RLS）· 千问 qwen-plus（萃取 / 排名 / 分析 / 优化）· 豆包 ASR（语音转写）。Tailwind token：`brand-primary` #D4875A / `brand-accent` #7BA699 / `v2-text-primary` #2C2420 / `bg-page` #F5F2EE。
