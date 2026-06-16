# LingoBridge Design System

> 每次新建或修改 UI 页面前必读。与 ENGINEERING.md 配套使用——本文件管理视觉决策，ENGINEERING.md 管理工程规范。

---

## ⚠️ 视觉基准页面（强制）

所有新页面的视觉风格必须以下列已完成页面为基准，
开发新页面前必须先阅读这些文件的源代码：

- 主要基准：src/app/feedback/page.tsx（反馈卡片页）
- 辅助参考：src/app/feedback/page.tsx（反馈卡片页）

具体要求：
- 背景色、卡片样式、阴影、边框、按钮必须与基准页面视觉上完全一致
- 遇到 design.md 文字描述与基准页面实际代码冲突时，以基准页面代码为准
- 新页面开发前，必须先检索基准页面中同类组件的实现方式，直接复用其 class 组合
- 禁止自创新的 class 或色值，所有样式从基准页面或 design.md token 中取

---

## 1. 色彩系统

### v2 Token（新页面一律用 v2）

| Token | 色值 | 使用场景 |
|---|---|---|
| `bg-base` | `#F8F5F1` | v2 页面底层背景（设计稿参考值） |
| `bg-surface` | `#FFFFFF` | 卡片、面板、输入框表面 |
| `bg-muted` | `#EEEBE6` | 次级区域、分隔填充、骨架屏 |
| `brand-primary` | `#D4875A` | 主品牌色（暖橙）：主按钮描边、步骤条激活态、强调文字 |
| `brand-primary-light` | `#F2D5C0` | 主品牌浅色：tag 背景、卡片点缀 |
| `brand-primary-dark` | `#B5663A` | 主品牌深色：hover 态、强调标题 |
| `brand-accent` | `#7BA699` | 副品牌色（绿蓝）：AI 优化标签、辅助图标 |
| `brand-accent-light` | `#C8DDD9` | 副品牌浅色：辅助背景、AI tag 背景 |
| `v2-text-primary` | `#2C2420` | 正文主色 |
| `v2-text-secondary` | `#6B5B52` | 次要文字 |
| `v2-text-muted` | `#A89990` | 辅助文字、字数统计、时间戳 |
| `phrase-warm-bg` | `#F7EBE1` | analysis 词组分组色（暖橙底）；文字/描边复用 `brand-primary-dark` / `brand-primary-light` |
| `phrase-blue-bg` | `#E9EEF4` | analysis 词组分组色（雾青蓝底） |
| `phrase-blue-text` | `#4A6178` | analysis 词组分组色（雾青蓝文字） |
| `phrase-blue-border` | `#CCD8E6` | analysis 词组分组色（雾青蓝描边） |

### v1 备用 Token（仅旧页面维护，新页面禁用）

| Token | 色值 | 说明 |
|---|---|---|
| `bg-page` | `#F8F5F1` | 当前全局页面背景（已更新，见下节） |
| `bg-card` | `#FFFFFF` | 卡片背景 |
| `bg-inner` | `#F4F4F4` | 内嵌区域 / `.surface` |
| `text-1` | `#111111` | 主文字 |
| `text-2` | `#444444` | 次要文字 |
| `text-3` | `#888888` | 辅助文字 |
| `text-4` | `#BBBBBB` | 禁用 / 占位文字 |
| `success` | `#5BA08A` | 成功态 |
| `warning` | `#C4965A` | 警告态 |
| `error` | `#C47A6A` | 错误态 |

### IELTS 分数段色

| Token | 色值 | 场景 |
|---|---|---|
| `band-55` | `#AAAAAA` | Band 5.5 |
| `band-60` | `#7BA699` | Band 6.0（同 brand-accent） |
| `band-65` | `#D4875A` | Band 6.5（同 brand-primary） |
| `band-70` | `#9A7DB8` | Band 7.0+ |

### 渐变参数

**主 CTA 描边渐变（橙→绿→黄绿）：**
```css
linear-gradient(135deg,
  rgba(240,188,160,0.85) 0%,
  rgba(168,210,196,0.80) 50%,
  rgba(188,210,168,0.75) 100%
)
```

**顶部氛围光 ambient-light：**
```css
radial-gradient(
  circle,
  rgba(240,188,160,0.18) 0%,
  rgba(168,210,196,0.13) 35%,
  rgba(188,210,168,0.08) 55%,
  transparent 72%
)
filter: blur(60px)
position: fixed; top: -160px; width: 400px; height: 400px; z-index: 0
```

---

## 核心视觉原则

> **所有新页面强制遵守，优先级高于各章节具体规范。**

### 背景与卡片层次

- **页面背景**：`bg-bg-page`（`#F8F5F1`），永远不用有色背景，禁止内联色值
- **普通卡片**：白色背景（`bg-white`）+ 0.5px 浅色边框（`border border-black/[0.05]`）+ 轻阴影（`.card` 类含 `box-shadow: 0 2px 12px rgba(0,0,0,0.06)`）
- **强调卡片**（AI 输出内容）：白色背景 + 1px 渐变边框，使用 `GRADIENT_BORDER_STYLE_FULL` 常量

### 渐变色使用规范

渐变方向：`brand-primary`（橙 `#D4875A`）→ `brand-accent`（绿 `#7BA699`），对应 `globals.css` 中已定义的渐变参数。

**允许使用渐变的场景：**
- 卡片 / 按钮描边（border-box 渐变）
- 主按钮 `.btn-gradient` 描边
- StepBar 已完成连线

**严禁使用渐变的场景：**
- 卡片背景、页面背景、大面积色块

**渐变边框标准实现方式：**

```tsx
// 外层：渐变背景 + padding 1px 充当边框
// 内层：白色背景
<div style={{ background: 'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80))', borderRadius: 21, padding: 1 }}>
  <div style={{ background: '#FFFFFF', borderRadius: 20 }}>
    {/* 内容 */}
  </div>
</div>
```

或直接使用 `GRADIENT_BORDER_STYLE_FULL` / `GRADIENT_BORDER_STYLE`（`src/lib/constants.ts`）。

### 主按钮规范（强制规范）

- **正确样式**：白色背景 + 渐变描边 + 渐变文字（或品牌主色文字）
- **错误样式**：渐变填充背景（严禁）、纯橙 / 纯绿填充（严禁）

**实现方式**（参考 `src/app/feedback/page.tsx` 里的主按钮）：

```tsx
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'

<button
  className="flex items-center gap-1.5 px-6 py-3 rounded-full text-[14px] font-medium text-[#444] active:scale-[0.97] transition-transform duration-150"
  style={GRADIENT_BORDER_STYLE}
>
  开始匹配题目 →
</button>
```

`GRADIENT_BORDER_STYLE` 使用 CSS `background-clip: padding-box / border-box` 技巧，内层白底，外层渐变边框，无需额外包裹 div。

| 属性 | 规范值 |
|---|---|
| 圆角 | `rounded-full`（全圆角胶囊） |
| 内边距 | `px-6 py-3`（宽松版）/ `px-5 py-2.5`（紧凑版） |
| 字重 | `font-medium` |
| 文字色 | `text-[#444]`（深灰），如需渐变文字另加 `background-clip: text` |
| 交互 | `active:scale-[0.97] transition-transform duration-150` |

- **禁止**：自行内联渐变背景替代 `GRADIENT_BORDER_STYLE`，所有页面必须使用同一常量

### 次要元素规范

| 元素 | 规范 |
|---|---|
| 小标签 / badge | 极浅底色（`brand-accent-light #C8DDD9` 或 `brand-primary-light #F2D5C0`）+ 对应浅边框，文字用对应深色 token |
| 辅助文字按钮 | `text-v2-text-muted`（`#A89990`），不使用品牌色 |
| 图标 | 使用 lucide-react outline 风格，`size` 传 px 数值，颜色跟随父元素 |

### 颜色冲突处理原则

若新页面 prompt 中指定的颜色值与 design.md 或 tailwind.config.ts 中已定义的 token 冲突，**一律采用项目原有 token，不新增色值**。例如：prompt 写 `#E8883A`，项目 token `brand-primary` 为 `#D4875A`，则使用 `text-brand-primary`，不修改 token 表。

---

## 2. 背景色规范

### 全局页面背景

**唯一来源：`bg-bg-page`（Tailwind `bg-page` token，值 `#F8F5F1`）**

| 位置 | 值 | 写法 |
|---|---|---|
| `html, body`（globals.css） | `#F8F5F1` | 硬编码（与 token 同步） |
| Tailwind `bg-page` token | `#F8F5F1` | `bg-bg-page` |
| `layout.tsx` themeColor | `#F8F5F1` | viewport meta（与 token 同步） |
| TopBar（`TopBar.tsx`） | `#F8F5F1` | `bg-bg-page` ✓ |
| TabBar（`TabBar.tsx`） | `#F8F5F1` | `bg-bg-page` ✓ |
| 各页底部操作栏 | `#F8F5F1` | `bg-bg-page` ✓ |
| 所有页面外层容器 | `#F8F5F1` | `bg-bg-page` ✓ |

**强制规则：**

1. **新页面一律用 `bg-bg-page`**，顶栏、底栏、Tab 区、页面容器全部相同
2. **禁止用 `bg-white` / `bg-[#FEFEFE]` / `bg-[#FFFFFF]` 作为页面级或栏级背景**（只有按钮的圆形底色除外）
3. **卡片用 `bg-surface`（`#FFFFFF`）保持纯白**——比页面底色 `#F8F5F1` 更白，形成刻意的层次感，不算违规

> **背景色统一原则**：TopBar/TabBar/底部操作栏是实心背景（`z-index ≥ 20`），实心栏叠加任何手工配制的渐变都配不准光晕浓度，会产生正向或反向色差。根治方案：**内页不用 ambient-light**，全页只用单一底色 `#F8F5F1`，彻底消除交界线。

### ambient-light 使用范围

**仅允许**在以下两个页面使用 `<div className="ambient-light" />`：

| 页面 | 路由 | 说明 |
|---|---|---|
| 首页 | `/`（`src/app/page.tsx`） | 页面无固定顶栏，光晕可自然穿透 |
| 录音页 | `/recording`（`src/app/recording/page.tsx`） | 顶栏为 `relative z-10`，光晕可自然穿透 |

**所有其他页面禁止使用 `ambient-light`**。原因：这些页面使用 `TopBar`（`sticky z-30`）或其他实心顶栏，光晕会被遮挡，手工补偿渐变无法精确对齐，必然产生横向色差带。整页单一底色 `#F8F5F1` 是唯一无副作用的方案。

### 卡片背景

`#FFFFFF`（`bg-surface` / `bg-white`）——纯白，比页面底色 `#F8F5F1` 明显更亮，形成清晰的卡片层次感。

### 组件背景

| 组件 | 背景色 | 说明 |
|---|---|---|
| `.surface` 内嵌区域 | `#F4F4F4` | 文本输入框、引用内容、代码块 |
| `.card` 卡片 | `#FFFFFF` | 带 `border-radius: 20px` 和阴影 |
| Tab 选中态 | `#F4F4F4` | Tab 切换器激活背景 |
| 搜索框、统计卡 | `#FFFFFF` | 带细边框 |
| 用户原句 / AI 优化句区域 | `#F8F7F5` | feedback 页内嵌内容块 |
| AI 标签背景 | `#EEF7F3` | feedback 页"AI 优化"标签 |
| TopBar 返回按钮 | `#FFFFFF` | 圆形 w-30px，shadow-sm |

---

## 3. 字体规范

**字体栈：** `'Plus Jakarta Sans', 'PingFang SC', 'Noto Sans SC', sans-serif`
**渲染：** `-webkit-font-smoothing: antialiased`

### 字号层级

| 层级 | 用途 | 字号 | 字重 | 颜色参考 |
|---|---|---|---|---|
| Display | 首页 Hero 大标题 | 24px | 700 | `#111` |
| H1 | 页面主标题（素材库） | 18px | 700 | `#111` |
| H2 | 页面副标题、卡片标题 | 15–16px | 600 | `#111` |
| Body-lg | 正文（输入框内容） | 15px | 400 | `#1A1A1A` |
| Body | 正文（卡片、对话） | 14px | 400–500 | `#444` / `#1A1A1A` |
| Caption | 辅助说明、字数、时间戳 | 12–13px | 400 | `#888` / `#AAAAAA` |
| Label | tag、步骤条标签 | 10–11px | 500–600 | 视语境 |
| Timer | 录音计时器 | 22px | 600 | `#111`，tracking `2px` |
| Button | 主按钮 | 14px | 600 | `#333` |
| Button-sm | 次按钮 | 13px | 500 | `#666` |

### 行高

- 正文（body）：`leading-relaxed`（约 1.625）
- 标题：默认（约 1.2–1.3）
- 辅助文字：默认

---

## 4. 间距与圆角

### 页面边距

| 场景 | 值 |
|---|---|
| 标准页面横向内边距 | `px-5`（20px）或 `px-6`（24px） |
| 首页内容区 | `px-7`（28px） |
| 录音底部控制区 | `px-8`（32px） |
| TopBar 高度 | `h-[52px]` |
| TabBar 高度 | `56px` |
| 页面底部留白（有 TabBar） | `pb-[56px]` |
| 页面内容区顶部 | `pt-6`（24px） |

### 组件内边距

| 组件 | 内边距 |
|---|---|
| 标准卡片内容区 | `px-[22px] pt-[16px] pb-[22px]` |
| `.surface` 实时转写区 | `px-4 py-3` |
| 搜索框 | `px-3 h-[40px]` |
| 统计小卡片 | `p-3.5` |
| Tab 切换器 | `p-1`（外层）/ `h-[34px]`（按钮高度） |

### 圆角档位

| 用途 | 值 |
|---|---|
| 主按钮 / 胶囊 / 标签 | `rounded-full`（9999px） |
| 卡片（`.card`） | `rounded-[20px]` |
| 小卡片 / 搜索框 | `rounded-[12px]` |
| 统计卡内层 / Tab 按钮 | `rounded-[14px]` / `rounded-[10px]` |
| `.surface` 内嵌区域 | `rounded-[14px]` |
| 文本输入框 | `rounded-[16px]` |
| 返回按钮（圆形） | `rounded-full` |
| 自定义 xl2 | `24px` |
| 自定义 xl3 | `32px` |

---

## 5. 组件规范

### 主按钮

所有页面的唯一主操作（继续、确认、开始、完成）统一使用以下样式，不得例外。

```tsx
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'

<button
  className="flex items-center gap-1.5 px-6 py-3 rounded-full text-[14px] font-medium text-[#444] active:scale-[0.97] transition-transform duration-150"
  style={GRADIENT_BORDER_STYLE}
>
  按钮文字
</button>
```

```
形状：rounded-full（9999px 全圆角）
边框：1.5px 渐变描边，由 GRADIENT_BORDER_STYLE 常量提供
背景：white padding-box（内部纯白，由常量提供）
文字：14px / font-medium / text-[#444]
内边距：px-6 py-3（宽松）/ px-5 py-2.5（紧凑，如底栏内联按钮）
交互：active:scale-[0.97]，transition-transform duration-150
```

> `.btn-gradient` CSS class（globals.css）与 `GRADIENT_BORDER_STYLE` 实现原理相同，二者均可用，新页面优先用常量方式，便于 TypeScript 类型推断。见「核心视觉原则 → 主按钮规范」。

### 录音圆形按钮 `.btn-gradient-circle`

```
形状：圆形（border-radius: 50%）
边框：2px 渐变描边（橙→绿）
背景：white padding-box
交互：active → scale(0.93)，transition 150ms
```

### 次要按钮 `.btn-ghost`

```
形状：圆角胶囊
边框：1px solid rgba(0,0,0,0.11)
背景：transparent
文字：13px / 500 / #666666，gap 6px
交互：active → opacity 0.6
```

用于：跳过、重录、返回、次要操作。

### 禁用态按钮

统一 `disabled:opacity-50` + `cursor-not-allowed`（保留按钮原样式，整体降到 50% 透明度，不改灰底）。

### 文字按钮（无边框）

```
text-[13px] text-[#AAAAAA]
无背景、无边框
用于：「或用文字输入」「← 改用录音」等低优先级入口
```

### 卡片 `.card`

**普通卡片（信息展示）：**
```css
background: #FFFFFF
border-radius: 20px
border: 1px solid rgba(0,0,0,0.05)   /* 0.5px 视觉等效 */
box-shadow: 0 2px 12px rgba(0,0,0,0.06)
```

**强调卡片（AI 输出内容）：**
```css
/* 使用 GRADIENT_BORDER_STYLE_FULL 常量，外层渐变 + 内层白底 */
border-radius: 20px
```

使用 `GRADIENT_BORDER_STYLE_FULL` 常量（`src/lib/constants.ts`），padding-box + 渐变 border-box，border-radius: 20px。见「核心视觉原则 → 渐变边框标准实现」。

### 内嵌表面 `.surface`

```css
background: #F4F4F4
border-radius: 14px
```

用于：实时转写预览、文本引用块、可编辑区域。

### Tag / Chip 尺寸规范（全局强制）

| 类型 | 用途 | padding | 字号 | 字重 | 圆角 |
|---|---|---|---|---|---|
| 信息标签 Tag | 当季热题、语料梳理、AI 优化、Part 标签 | `px-[10px] py-[5px]` | `text-[11px]` | `font-medium` | `rounded-full` |
| 交互按钮 Chip | 全部/Part筛选、编辑/完成、练习 | `px-[14px] py-[5px]` | `text-[12px]` | `font-medium` | `rounded-full` |

实现：使用 `src/components/Tag.tsx` 和 `src/components/Chip.tsx`，禁止页面内直接手写同类样式。

### 强调标签（全局统一规范）

所有带有强调含义的小标签（包括但不限于：当季热题、语料梳理、AI整理后、热门、推荐等），
全局统一使用绿色系样式，禁止使用橙色或其他颜色：

| 属性 | 值 | 说明 |
|---|---|---|
| 背景 | `bg-[#EDF6EB]` | 无对应 token，使用该色值 |
| 边框 | `border border-[#C0DDB9]`（0.5px 视觉等效） | 无对应 token，使用该色值 |
| 文字 | `text-[#3D7A38]` | 无对应 token，使用该色值 |
| 圆角 | `rounded-full` | — |
| 字号 | `text-[11px]` | — |
| 字重 | `font-medium` | — |

若有对应项目 token 则优先使用 token，没有则使用以上色值。
此规范适用于所有页面，新页面开发时必须遵守。

> 例外：analysis 页「可用词组」chip 按分组循环使用 暖橙 / 标准绿 / 雾青蓝 三色（见 `PHRASE_CHIP_STYLES` 与 `phrase-*` token），这是唯一允许的多色场景——它编码「词组分组」而非「强调」。其余强调标签仍只能用绿。

### StepBar 步骤条

流程步骤：`story → restructure → matching → analysis → practice`

| 状态 | 圆点样式 | 文字样式 | 连线 |
|---|---|---|---|
| 已完成（done） | `bg-brand-primary`（8×8px 实心） | `text-brand-primary`，10px | `bg-brand-primary`，h-1.5px |
| 当前（current） | `bg-brand-primary` + `ring-2 ring-brand-primary/30 ring-offset-1` | `text-brand-primary font-semibold` | — |
| 未到达 | `bg-[#DDDDDD]` | `text-[#BBBBBB]` | `bg-[#EEEEEE]` |

容器：`flex items-center px-4 py-3`，连线为 `flex-1 h-[1.5px] mx-1 mb-[14px] rounded-full`。

### TabBar 底部导航

```
背景：bg-bg-page（#F8F5F1）
高度：56px + env(safe-area-inset-bottom)
边框：border-t border-black/[0.06]
位置：fixed bottom-0，max-w-[430px]，居中
图标：20px，激活 text-[#111]，未激活 text-[#BBBBBB]
文字：10px / 500，激活 #111，未激活 #BBBBBB
激活指示器：3×3px 圆点 bg-[#111]
```

Tab：首页（/）、题库（/question-bank）、素材库（/library）、我的（/profile）

显示原则：用户正在产出内容时（录音中 /recording、练习对话 /practice）不显示 TabBar，其余所有页面均显示。

### TopBar 顶部导航

```
背景：bg-bg-page
高度：h-[52px]
内边距：px-5
返回按钮：30×30px 圆形，bg-white，shadow-sm，chevron-left 15px #333
标题：16px / 600 / #111
右侧插槽：支持自定义 ReactNode（进度、操作按钮等）
```

---

## 6. 动效规范

### Orb 弥散光晕

Orb 是全局核心视觉元素，由 4 层模糊色球 + 42 个粒子组成，支持 `audioLevel` 实时响应。

| 层 | 颜色 | 基础尺寸（300px 参考） | 偏移方向 |
|---|---|---|---|
| 绿色 | `rgba(145,200,122,0.95)` | 175px | 左上 |
| 蓝青 | `rgba(112,182,176,0.95)` | 155px | 右侧 |
| 橙色 | `rgba(248,168,118,0.95)` | 165px | 下方 |
| 黄绿 | `rgba(210,226,168,0.80)` | 130px | 左侧 |

音频响应：`audioLevel`（0–1）控制各层尺寸 `+18px`、粒子位移 `+10px`、粒子半径 `×1.12`、透明度 `+0.12`，过渡 `0.08s ease`。

静态动画：

```
orb-breathe：scale(1.00→1.03)，opacity(0.88→1.00)，3.5s ease-in-out infinite
orb-pulse：  scale(1.00→1.07)，2.2s ease-in-out infinite
```

| 页面状态 | 行为 |
|---|---|
| 待机 / 首页 | `pulse={false}`，静止展示 |
| 录音中 | `audioLevel` 实时传入，粒子随声音扩散 |

### 页面过渡

```
元素淡入上移：animate-fade-up（fadeUp 300ms ease-out，translateY 10px→0）
```

### 其他动效

```
波形（录音待机）：wave-1~5，750ms，交错 0/80/160ms
波形（录音激活）：wave-a1~a5，500ms，交错 0/80/160ms
底栏滑入：sheet-enter，250ms，cubic-bezier(0.32,0.72,0,1)
Accordion：accordionDown，200ms ease-out
按钮点击（按元素大小分 3 档）：
  - 普通按钮：active:scale-[0.97]，transition-transform duration-150
  - 圆形主按钮（.btn-gradient-circle）：scale(0.93)（由 class 提供）
  - 大卡片 / 列表行：active:scale-[0.99]（大元素轻按）
```

---

## 7. 新页面开发规范

### 必用结构模板

```tsx
<div className="relative min-h-screen bg-bg-page flex flex-col pb-[56px]">
  <div className="ambient-light" />
  <TopBar title="页面标题" />
  {/* 可选：<StepBar currentStep="xxx" /> */}
  <div className="flex-1 overflow-y-auto px-6 relative z-10">
    {/* 页面内容 */}
  </div>
  <TabBar />  {/* 除 /recording、/practice 外的所有页面均加 */}
</div>
```

### 背景色

- 页面背景：`bg-bg-page`（当前 `#F8F5F1`）
- 禁止直接写 `bg-white` 作为页面底色
- 卡片保持 `bg-white`，形成层次感

### 卡片样式参考

- 标准信息卡：参考 `library/MyStoriesTab.tsx`（`bg-white rounded-[18px] border border-black/[0.05]`）
- 渐变描边主卡：参考 `feedback/page.tsx`（`GRADIENT_BORDER_STYLE_FULL`）
- 统计数字卡：参考 `library/page.tsx`（渐变外框 + `bg-white rounded-[14px]` 内层）

### 必用组件

| 需求 | 组件 |
|---|---|
| 顶部返回 / 标题栏 | `<TopBar />` |
| 底部主导航 | `<TabBar />`（除 /recording、/practice 外的所有页面） |
| 流程进度 | `<StepBar currentStep="..." />` |
| AI 陪伴视觉 | `<Orb size={300} audioLevel={...} />` |
| 录音波形 | `<Waveform active={...} />` |

### 禁止事项

- 禁止内联色值（`style={{ color: '#xxx' }}`）替代 Tailwind token，颜色语义不可追踪
- 禁止新页面使用 v1 色板（`bg-page`, `text-1~4`, `bg-card`, `bg-inner`）
- 禁止 `bg-white` 作为页面级背景（只用于卡片）
- 禁止使用 Inter、Roboto、Arial 等通用字体
- 禁止自定义渐变色值偏离上方渐变参数（破坏视觉一致性）
- 禁止将渐变用于卡片背景、页面背景或大面积色块（见「核心视觉原则」）
- 禁止因 prompt 指定了不同色值而新增 token，冲突时一律用项目原有 token
- 禁止单文件超过 1000 行（参见 ENGINEERING.md §1）

---

*最后更新：2026-06-16（禁用态统一为 `disabled:opacity-50` + `cursor-not-allowed`；删除「按钮禁用态 #EEEEEE」灰底规则）*
*2026-06-16：analysis 词组分组色改为 暖橙/绿/雾青蓝并提为 `phrase-*` token；强调标签规范追加「分组色」例外*
*2026-06-16：统一页面背景为 `#F8F5F1`；主基准页引用修正为 `feedback/page.tsx`*
*2026-05-30：统一 TabBar 显示逻辑；Tab 改为首页/素材库/我的，移除练习；新增 /profile 占位页*
