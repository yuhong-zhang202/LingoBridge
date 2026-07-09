# LingoBridge 交接文档

> 整理日期：2026-06-12 · 分支：`feat/home-ielts-toggle` · origin HEAD：`b55eb17`
> 本文档覆盖本轮会话的全部改动、当前状态与待办，接手者请先读「协作约定」与「待办」两节。

---

## 一、项目速览

- **产品**：LingoBridge——面向雅思备考生的口语练习 App。
- **核心理念**：把用户真实的生活故事转化为口语素材，通过即时正反馈闭环备考，专注即兴表达训练，而非死记题库。
- **仓库**：`github.com/yuhong-zhang202/LingoBridge`，分支 `feat/home-ielts-toggle`。
- **技术栈**：Next.js（App Router）+ Supabase + 千问 `qwen-plus`/`qwen-flash`（LLM）+ 豆包 ASR（录音转写）+ 浏览器 `speechSynthesis`（TTS）。
- **必读文档**：`ENGINEERING.md`（工程规范）、`DESIGN.md`（视觉规范）。两者优先级高于单次 prompt 的措辞。

---

## 二、协作约定（接手必读）

1. **只改指定文件**：每个任务只动明确点名的文件，其它一律不动。
2. **颜色用 token**：走 Tailwind / `DESIGN.md` 的 v2 token，禁止新增内联色值；若 prompt 给的色值与现有 token 冲突，一律用项目原有 token。
3. **提交节奏（重要，最容易踩坑）**：每个发给 Claude Code 的 prompt 开头都是 `git fetch && git reset --hard origin/feat/home-ielts-toggle`——**这会冲掉本地未提交的改动**。所以**跑下一个 prompt 前，必须先把上一个 commit + push**。本轮多次差点因此丢代码。
4. **改 AI 逻辑要回归**：动 Lior / 分析 / 匹配等模型逻辑的改动，按 `ENGINEERING.md §11` 用真实故事跑一遍回归，并查 `dev.log` 的 ApiLogger 确认模型与调用正常。
5. **模型常量集中**：所有模型名放 `src/lib/constants.ts`（`MODEL_*`），不硬编码。
6. **密钥隔离**：`DASHSCOPE_API_KEY` 等只在服务端用，service 文件 `import 'server-only'`，走 `src/app/api/**/route.ts`。
7. **本地测试注意**：
   - **麦克风**需 HTTPS：用 `npx cloudflared tunnel --url http://localhost:3000`（两个终端：`npm run build && npm start` + cloudflared）。
   - **TTS**（`speechSynthesis`）在 `localhost` http 直接可用，不用开隧道。

---

## 三、当前状态

- **本轮所有功能改动已全部合并进 origin**（最新 `b55eb17`），可直接拉取运行。
- **唯一待落地**：首页「文字输入态」UI 重做（方案 B）——prompt 已交付，但**尚未应用、未在 origin 上**（已确认 `src/app/page.tsx` 未含本次改动）。详见第五节。

---

## 四、本轮完成（均已推 origin）

| commit | 内容 | 主要文件 |
|---|---|---|
| `4725468` | 录音改**点按式**（点开始/点发送）+ 语音条实时反馈 + 分 Part 录音上限（P2 150s / P1·P3 90s，到点自动停发） | `practice/page.tsx`、`practice/_components/VoiceBar.tsx` |
| `2297a69` | 分析模型换回 `qwen-plus`（flash 跟不住"固定 3 点"约束，修 Part 2 侧重点退回 4 点） | `lib/constants.ts` |
| `006e425` | 整理语料页加大底部留白，修「重新整理」按钮被 TabBar 遮挡 | `restructure/page.tsx` |
| `0eb82f4` | 录音态拆出**取消(×)/发送**两个键，去掉"停止即发送"的歧义 | `practice/page.tsx` |
| `dec5193` | 润色「换个说法」支持判定**无需优化**，短句不再被硬改（新增 `needsWork` 字段） | `types.ts`、`services/practice.ts`、`RephrasePopup.tsx`、`practice/page.tsx` |
| `9648270` | Lior 改为**按分析侧重点为骨架**引导描述，尊重每点轻重（轻点别过度、重点深挖） | `services/practice.ts` |
| `23f8137` | **发音纠错①**：练习页点用户气泡里的词→填正确词→存 localStorage | `types.ts`、`storage.ts`、`UserBubble.tsx`、新增 `PronounceCapturePopup.tsx`、`practice/page.tsx` |
| `eec964e` | **发音纠错②**：素材库新增「发音」Tab + 发音卡片（TTS 播放、左滑删除） | 新增 `library/PronunciationTab.tsx`、`library/page.tsx` |
| `154953f` | **发音纠错③**：发音卡接入 AI 音标 + 「怎么念」提示，首次打开生成并缓存 | `types.ts`、`constants.ts`、`storage.ts`、新增 `services/pronounce.ts`、新增 `api/pronounce/route.ts`、`library/PronunciationTab.tsx` |
| `6ef92c7` | 反馈卡（FeedbackCard）原句/AI 优化句的喇叭**接上 TTS**（原本是死图标） | `components/FeedbackCard.tsx` |
| `b5c488f` | **清理**：删除两个未接入的旧范文 mock 页 `/article`、`/article-view` 及其 mock 服务/数据 | 删 `app/article/`、`app/article-view/`、`services/article.ts`、`data/article.ts` |
| `b55eb17` | 发音纠错弹窗从居中遮罩改为**挂在被点气泡正下方**（随聊天滚动、右上角 × 关闭） | `practice/page.tsx`、`PronounceCapturePopup.tsx` |

> 本轮起点之前的两条文档提交：`d24c89a`（DESIGN.md 校准）、`2f3160f`（ENGINEERING §10 ranking 温度修正）。

---

## 五、唯一待办：首页「文字输入态」UI 重做（方案 B）

- **状态**：设计已敲定（方案 B），**实现 prompt 已交付给 Claude Code，但尚未应用**。
- **范围**：只改 `src/app/page.tsx` 的文字输入态（`showTextInput` 分支），故事/录音态不动。
- **设计要点**：顶部小 Orb + 对话气泡引导 →「渐变描边的故事卡（加长文本框 `min-h-[235px]`）」→ 紧贴其下的「← 改用录音」→ 下方复用整理语料页的「**怎样的素材更好用**」两条提示。
- **建议 commit**：`feat(home): 重做文字输入态——引导气泡 + 加长故事卡 + 素材提示`
- **落地后在真机上要瞄的点**：
  1. 小 Orb 用了 `size={52}`，若太小/太密可调大（如 60）。
  2. 原生 `textarea` 的 placeholder 只能单一字号/颜色，所以那行"比如…"示例与上一行同大同色（设计图里更浅更小的效果做不到）；嫌灰字满可删短示例。
  3. iPhone Pro Max 这类特别高的屏上，底部可能比设计图多一点留白（文本框是固定高度、不撑满）。

---

## 六、关键设计决策（便于理解动机）

- **发音纠错三步闭环**：捕捉（练习页点词）→ 沉淀（素材库发音 Tab）→ 增值（AI 音标 + 怎么念，首次缓存）。"播放用户本人的真实错音"是 v2，需要 ASR 词级时间戳 + 音频存储，暂缓。
- **录音改点按式**：原来长按录音歧义大；改成点一下开始、点发送结束，并加实时语音条 + 分 Part 时长上限（贴近真实雅思节奏）。
- **润色"无需优化"**：很多简短但已到位的句子被硬塞 yeah/改语气词毫无意义；改为 AI 判定 `needsWork=false` 时不给改写句。
- **Lior 以分析点为骨架**：让教练围绕该题的侧重点（带每点轻重）灵活引导，而非线性念稿。
- **首页文字态最终方向**：选定"C3 卡片 + 去掉点一下起头 + 下半部分放整理语料通用提示"，再把输入框调长（方案 B）以填实底部、避免大空白。

---

## 七、待办 / Backlog（已记录、未做）

- **发音 v2**：播放用户本人录音里的真实错音（依赖 ASR 词级时间戳 + 音频存储）。
- **Lior 体验打磨**：对话收尾感、轮次进度感知、Part 1 与 Part 2 引导差异化、高分档（7.5/8.0）prompt 偏薄。
- **内测前清单**：邮箱验证、匹配页 URL 隐私、各页空态/错误态、首页右上角"死"头像按钮等。
- **文档一致性**：`DESIGN.md` 仍把**已删除**的 `article-view` 列为"主要视觉基准页"（第 12 行），需改为指向 `feedback/page.tsx`。
- **首页超高屏留白**：方案 B 落地后在 Pro Max 上若留白偏多，再调（见第五节）。

---

## 八、关键参考

### 设计 token（节选自 DESIGN.md，新页面一律用 v2）

| Token | 值 | 用途 |
|---|---|---|
| `bg-page` | `#F5F2EE` | 页面/顶栏/底栏统一底色（唯一来源） |
| 卡片 `bg-white` | `#FFFFFF` | 比页面底色更白，形成层次 |
| `brand-primary` | `#D4875A` | 暖橙主色 |
| `brand-primary-dark` | `#B5663A` | 强调/hover |
| `brand-primary-light` | `#F2D5C0` | tag 浅底 |
| `brand-accent` | `#7BA699` | 绿蓝副色 |
| `v2-text-primary` | `#2C2420` | 正文主色 |
| `v2-text-secondary` | `#6B5B52` | 次要文字 |
| `v2-text-muted` | `#A89990` | 辅助/字数/时间戳 |

- **渐变描边按钮/卡**：用常量 `GRADIENT_BORDER_STYLE` / `GRADIENT_BORDER_STYLE_FULL`（`src/lib/constants.ts`）。**主按钮是白底 + 渐变描边，绝不是渐变填充**。
- **强调小标签**：全局统一绿色系（`bg-[#EDF6EB]` / `border-[#C0DDB9]` / `text-[#3D7A38]`）。
- **整理语料提示色**（复用到首页 B）：灯泡 `#C0996F`，数字徽标 `border-[#EADFCD] bg-[#FBF7F0] text-[#B89B7E]`。

### 重要文件速查

- 首页：`src/app/page.tsx`
- 练习页：`src/app/practice/page.tsx`（+ `_components/`：`UserBubble`、`PronounceCapturePopup`、`RephrasePopup`、`VoiceBar`、`AiBubble`、`OrbWarm/OrbSoft`）
- 素材库：`src/app/library/page.tsx`（+ `components/library/`：`PronunciationTab`、`SavedWordsTab`、`CollectedCardsTab`、`MyStoriesTab`、`SwipeToDelete`）
- 整理语料页：`src/app/restructure/page.tsx`
- 反馈页/卡：`src/app/feedback/page.tsx`、`src/components/FeedbackCard.tsx`
- **发音功能涉及**：`lib/types.ts`（`SavedPronunciation`、`PronunciationTip`）、`lib/storage.ts`（`get/add/remove/updateSavedPronunciation`）、`services/pronounce.ts`、`api/pronounce/route.ts`、`lib/constants.ts`（`MODEL_PRONOUNCE`）
- 常量：`src/lib/constants.ts`（`MODEL_*`、`GRADIENT_BORDER_STYLE*`）

### 模型常量现状（constants.ts）

`MODEL_RANKING` / `MODEL_PRACTICE` / `MODEL_EXTRACTION` / `MODEL_ANALYSIS` / `MODEL_PRONOUNCE` = `qwen-plus`；`MODEL_RESTRUCTURE` = `qwen-flash`。
