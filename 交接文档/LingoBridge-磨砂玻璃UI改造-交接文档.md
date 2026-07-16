# LingoBridge 磨砂玻璃（Frosted Glass）UI 改造 — 交接文档

> 给新会话：这份文档自包含。目标是把现有 UI 换成**磨砂玻璃皮肤**，但**布局 / 尺寸 / 间距 / 字号 / 圆角值 / 组件结构 / 文案一律不变**——只换"表面材质"（背景 → 半透明模糊，实色白面 → 磨砂玻璃）。一句话：**同一副骨架，换一层玻璃皮。**

---

## 0. 怎么用这份文档
- 沿用"**一次一个可 review 的小改动 → 自检 → 提交 → push**"的节奏，不要一把大改。
- 强烈建议把磨砂做成**可开关的主题**（根节点加 `.theme-glass` 或一个 feature flag），方便 A/B 和一键回退。
- 落地顺序建议：**先只在反馈页接上磨砂 → 真机看效果 → 满意再铺全站**。静态图和真机的 backdrop-blur 差别不小。

## 1. 项目背景
- LingoBridge：雅思口语练习 App，Next.js + Tailwind。
- 仓库：`github.com/yuhong-zhang202/LingoBridge`，分支 `feat/ui-redesign`（以最新为准）。
- 设计规范见 `DESIGN.md`。UI 已收口为 4 个组件：`<Card>`（`plain`/`gradient`）、`<Tag>`、`<Chip>`、`<GradientButton>`，外加 `TopBar` / `TabBar` / `StepBar` 等。
- 当前卡片标准：`bg-white rounded-[16px] border border-black/[0.05] shadow-[0_2px_12px_rgba(0,0,0,0.06)]`，全站圆角统一 16px。
- 当前页面背景：纯平米色 `#F8F5F1`（token `bg-page` / `bg-base`）。

## 2. 硬约束（最重要）
**只允许改这两类东西：**
1. **背景层** —— 平米色 → 一层极淡的彩色晕（让磨砂能"显形"）。
2. **所有"面"的材质** —— 卡片 / 顶栏 / 底栏 / 按钮 / 胶囊 / 弹窗 的 `bg-white` → 半透明白 + `backdrop-blur` + 淡边。

**绝对不要碰：**
- 任何 `padding` / `margin` / `gap` / 宽高 / 字号 / 圆角值 / 布局 / 组件结构 / 文案。
- 渐变描边的几何（`GRADIENT_BORDER_STYLE` 的描边宽度与圆角）。
- 已做好的一致性成果（颜色 token、4 个组件、无障碍 `aria-label`）。

> 自检口诀：每改一处，问自己"我只换了 `bg`/`border`/`shadow` + 加了 `backdrop-blur` 吗？`px-*`/`py-*`/`rounded-*`/`text-*` 有没有被我动？"——后者一个都不能动。

## 3. 磨砂玻璃配方（精确值，来自已确认的样式图）

### 3.1 背景层（关键——没有它磨砂"糊不出东西"）
全部用产品自有的**浅色 token**，压淡：
```css
/* 页面底层背景 */
background: linear-gradient(160deg, #F7EBE1, #F8F5F1 38%, #EAF0EC 76%, #E9EEF4);
```
再叠 3 团极淡色晕（每团 `filter: blur(30px)`，约 110–160px）：
```
浅桃   rgba(242, 213, 192, 0.55)
浅雾青 rgba(200, 221, 217, 0.50)
浅蓝   rgba(233, 238, 244, 0.60)
```
实现：一个固定在 app 内容**下方**的背景层（建议做成 `<GlassBackground>` 组件，挂在 root layout 内容层之下，`.theme-glass` 时显示），盖住原来的纯平 `#F8F5F1`。

### 3.2 玻璃面（卡片 / 顶栏 / 底栏 / 按钮 / 胶囊 通用）
```css
.glass {
  background: rgba(255, 255, 255, 0.52);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);   /* Safari 必带 */
  border: 1px solid rgba(255, 255, 255, 0.66);
  box-shadow: 0 4px 18px rgba(120, 90, 60, 0.08);
}
```
- **圆角和内边距沿用各自原值**，`.glass` 只负责 `bg`/`border`/`shadow`/`blur`。
- 次级面（如关闭按钮 ✕ 这种）可更透：`background: rgba(255,255,255,0.40)`。

### 3.3 玻璃面里的颜色点缀（图标垫底块等）
半透明浅色 token 垫底，呼应品牌又不抢：
```
浅桃   rgba(242, 213, 192, 0.60)   图标块（暖）
浅雾青 rgba(200, 221, 217, 0.55)   图标块（青）
浅蓝   rgba(233, 238, 244, 0.70)   图标块（蓝）
奶白   rgba(247, 235, 225, 0.80)   图标块（米）
```
- 文字色**沿用 v2 暖调**：`#2C2420` / `#6B5B52` / `#A89990`，保证对比度。
- 绿色强调标签（如优化关键词）：底 `rgba(237,246,235,0.7)`、边 `rgba(192,221,185,0.7)`、字 `#3D7A38`。
- 渐变描边卡（`<Card variant="gradient">`、`<GradientButton>`）：**描边渐变保留**，只把内层白底换成半透明磨砂。

## 4. 推荐实现路径（改组件，不改页面）
关键优势：UI 已收成 4 个组件 + `TopBar`/`TabBar`，所以**"换面" ≈ 改这几个组件 + 加背景层**，页面布局一律不动。

每步一 review：
1. **globals.css**：加 `.glass` 工具类（§3.2）。
2. **`<GlassBackground>`**（§3.1）：挂到 root layout 内容层下方，`.theme-glass` 时显示。
3. **`<Card>`**：`plain` 和 `gradient` 的白底都换成半透明磨砂 + `blur`，**保留圆角/边框几何**。
4. **`TopBar` / `TabBar`**：实色白 → 玻璃（底栏建议略高透明度，配 `blur`）。
5. **`<Chip>` / `<GradientButton>`**：实色白 → 玻璃，**尺寸不变**。
6. **非组件的"面"**（逐个把 `bg-white` 换 `.glass`）：
   - `src/components/FeedbackCard.tsx`（反馈主卡，注意它内层是 `GRADIENT_BORDER_STYLE_FULL` 渐变描边 + 白底 → 白底换磨砂、描边保留）
   - `src/app/practice/_components/PronounceCapturePopup.tsx`、`RephrasePopup.tsx`（弹窗）
   - `src/app/library/page.tsx` 的列表/分区卡
   - `src/app/practice/page.tsx` 的录音条（专用输入组件，单独处理）
7. **收尾**：在 `DESIGN.md` 记录磨砂玻璃皮肤规范 + `.glass` 用法 + `.theme-glass` 开关；记得改完 `DESIGN.md` 后同步项目知识库副本。

## 5. 改的时候具体怎么动（示例）
```diff
- <div className="bg-white rounded-[16px] border border-black/[0.05] shadow-[0_2px_12px_rgba(0,0,0,0.06)] px-4 py-4">
+ <div className="glass rounded-[16px] px-4 py-4">
```
- 只把 `bg-white` + `border ...` + `shadow-[...]` 三件换成 `glass`。
- `rounded-[16px]` / `px-4` / `py-4` **原样保留，一个不动**。
- 对用 `<Card>` 的地方：改 `Card.tsx` 内部即可，调用处不动。

## 6. 坑与注意
- **背景层是前提**：纯平 `#F8F5F1` 上铺玻璃 = 看不出磨砂。先把 §3.1 背景层做对，再做面。
- **可读性**（你们文字密集，重点）：卡片白底**别低于 0.5**，文字保持深色（v2 暖调），必要时图标块/标签底色再压一点透明度别太花。
- **性能**：`backdrop-filter` 在移动端**多层叠加会卡**。限制同屏 `blur` 层数；低端机可降级（用半透明实色代替 `blur`，可借 `@supports` / 媒体查询）。
- **兼容**：`backdrop-filter` 必带 `-webkit-` 前缀；现代 Safari / Chrome 支持。
- **务必可逆**：放在 `.theme-glass` / flag 后面，先在反馈页验证真机，满意再铺全站。

## 7. 验收标准
- 任意页面：布局 / 间距 / 字号 / 圆角 与改造前**逐像素一致**，只是材质变成玻璃。
- 背景出现极淡色晕；卡片有磨砂透感；文字清晰可读。
- 磨砂主题可**一键开关、可回退**。
- `npm run build` 通过。

---

## 附录 A：产品色卡（精确 hex，`tailwind.config.ts`）
```
bg-page / bg-base   #F8F5F1      bg-surface / bg-card #FFFFFF
bg-muted            #EEEBE6      bg-inner             #F4F4F4
brand-primary       #D4875A      brand-primary-light  #F2D5C0
brand-primary-dark  #B5663A      brand-accent         #7BA699
brand-accent-light  #C8DDD9
v2-text-primary     #2C2420      v2-text-secondary    #6B5B52
v2-text-muted       #A89990
phrase-warm-bg      #F7EBE1      phrase-blue-bg       #E9EEF4
phrase-blue-text    #4A6178      phrase-blue-border   #CCD8E6
success #5BA08A   warning #C4965A   error #C47A6A   band-70(雾紫) #9A7DB8
```
磨砂背景层只用这里的**浅色**：`#F7EBE1` / `#F2D5C0` / `#C8DDD9` / `#E9EEF4`（+ `#F8F5F1` 打底）。

## 附录 B：关键文件位置
```
组件      src/components/{Card,Tag,Chip,GradientButton,TopBar,TabBar,FeedbackCard}.tsx
常量      src/lib/constants.ts          （GRADIENT_BORDER_STYLE / _FULL 等渐变常量）
全局样式  src/app/globals.css           （加 .glass 工具类、背景层样式）
token     tailwind.config.ts
规范文档  DESIGN.md
根布局    src/app/layout.tsx            （挂 GlassBackground）
```

## 附录 C：背景层 + 玻璃面 参考片段（仅作起点，按上面规范微调）
```tsx
// GlassBackground —— 挂在 app 内容层之下
export default function GlassBackground() {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden"
      style={{ background: 'linear-gradient(160deg,#F7EBE1,#F8F5F1 38%,#EAF0EC 76%,#E9EEF4)' }}>
      <div className="absolute rounded-full" style={{ width:160,height:160,filter:'blur(30px)',
        background:'rgba(242,213,192,0.55)', top:-30, left:-25 }} />
      <div className="absolute rounded-full" style={{ width:160,height:160,filter:'blur(30px)',
        background:'rgba(200,221,217,0.50)', bottom:60, right:-30 }} />
      <div className="absolute rounded-full" style={{ width:120,height:120,filter:'blur(30px)',
        background:'rgba(233,238,244,0.60)', top:'40%', left:'30%' }} />
    </div>
  )
}
```
```css
/* globals.css */
.glass {
  background: rgba(255,255,255,0.52);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  border: 1px solid rgba(255,255,255,0.66);
  box-shadow: 0 4px 18px rgba(120,90,60,0.08);
}
```
