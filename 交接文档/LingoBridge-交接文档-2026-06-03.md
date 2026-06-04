# LingoBridge 开发交接文档

> 交接时间：2026-06-03 22:30（北京时间）
> 用途：供下一个对话窗口的 Claude 快速接手，了解本次会话做了什么、当前状态、以及下一步该做什么。
> 配套必读：项目内的 ENGINEERING.md、DESIGN.md、LingoBridge-产品详细介绍.md，以及项目根的开发规则系统提示。

---

## 一、项目一句话背景

LingoBridge 是面向中国雅思口语备考生的 PWA 练习 App（Next.js 14 + Vercel + Supabase）。核心理念：把用户真实的人生故事，转化成可脱口而出的口语素材。**用户后续计划上架 iOS 原生应用**——这条信息影响过多个技术决策（见下文）。

主流程 6 步：语料输入(/recording) → AI整理确认(/restructure) → 题目匹配(/matching) → 侧重点分析(/analysis) → 练习对话(/practice) → 卡片反馈(/feedback)。

**项目根目录（本地 Mac）：** `/Users/yuhongzhang/Desktop/LingoBridge`
**GitHub：** `github.com/yuhong-zhang202/LingoBridge`，当前分支 `feat/home-ielts-toggle`
**本地运行：** `npm run dev`（端口 3000；若被占用会自动用 3001）。Next.js 14.2.35。

---

## 二、本次会话完成的三大块工作

### 块 1：语音转写从 OpenAI Whisper 迁移到豆包（火山引擎）录音文件识别大模型·极速版

**为什么：** Whisper 对静音/噪音有中文幻觉（稳定输出"谢谢观看"等），且国内访问不稳。改用豆包极速版——国内稳、中文准、一次请求同步返回结果（无需 submit/query 轮询）、支持直接传 base64。

**接口要点（已落地，供排查参考）：**
- 端点：`POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash`（同步）
- 鉴权用**旧版 APP ID 方案**（不是新版 API Key 方案）：
  - 请求头 `X-Api-App-Key` = APP ID（`8095168538`）
  - 请求头 `X-Api-Access-Key` = Access Token
  - 请求头 `X-Api-Resource-Id` = `volc.bigasr.auc_turbo`（**固定常量，硬编码在代码里，不是 env**）
  - 请求头 `X-Api-Request-Id` = 每次请求生成的 UUID；`X-Api-Sequence` = `-1`
  - **Secret Key 这个接口用不上**（是给别的服务签名用的）
- 请求体：`{ user:{uid}, audio:{data:<base64>, format:"wav"}, request:{model_name:"bigmodel", enable_punc:true, enable_itn:true} }`
- **成功判断在响应头 `X-Api-Status-Code === "20000000"`**（不是 HTTP 状态码，不是 body 字段）。文本取 `body.result.text`。建议日志记录响应头的 `X-Tt-Logid`。

**环境变量（在 `.env.local`，仅两个）：**
```
DOUBAO_ASR_APP_ID=8095168538
DOUBAO_ASR_ACCESS_TOKEN=（用户的 Access Token）
```
OPENAI_API_KEY 已从 env.ts / .env.example 移除（全项目仅转写用过它）。

**踩过的坑（重要，避免重复）：**
- 错误码 `45000030 requested resource not granted` = 火山引擎控制台**极速版服务刚开通、鉴权未即时生效**，等几分钟即可，**不是代码/Token 问题**。
- 用户在火山引擎控制台为应用 LingoBridge1 开通了极速版（注：开通过程中从"试用版"升级成了"正式版/付费"，用户需自行去账单页确认费用——MVP 阶段用量极小）。

### 块 2：服务端 ffmpeg 音频转码（路线选型的关键长期价值）

**为什么：** 浏览器 MediaRecorder 录出的格式豆包不收——Chrome/Android 是 `webm/opus`、iOS Safari 是 `mp4/aac`，而豆包只收 wav/mp3/ogg-opus。客户端无法跨浏览器统一录出豆包可用格式。

**选型决策（关键）：** 在三条路（客户端 WAV / 服务端转码 / WASM polyfill）中选了**服务端 ffmpeg 转码**。决定性理由：**用户要上 iOS 原生 App**——服务端转码方案下，PWA 各浏览器和将来的 iOS App 都把音频丢到同一个后端统一归一化，一份逻辑长期通用；另两条路只能用于浏览器，上 iOS 后要重做。

**落地：**
- 新建 `src/lib/audio/transcode.ts`：`transcodeToWav(input, inputExt)` 用 `fluent-ffmpeg` + `ffmpeg-static`，转 16kHz 单声道 WAV。用 `/tmp` 临时文件（serverless 只有 /tmp 可写），用完清理。
- `src/app/api/transcribe/route.ts`：`runtime='nodejs'`、`maxDuration=60`；收音频 → 转码 → 调豆包。
- 依赖：`fluent-ffmpeg`、`ffmpeg-static`、`@types/fluent-ffmpeg`。

**踩过的坑（重要）：**
- 本地 dev 报 `ffmpeg ENOENT`（spawn `.next/server/vendor-chunks/ffmpeg` 失败）：原因是 Next 把 ffmpeg-static 当普通 JS 打包，没带二进制。**修法：`next.config.mjs` 的 `experimental.serverComponentsExternalPackages: ['ffmpeg-static','fluent-ffmpeg']`**，让运行时从原始 node_modules 加载真实二进制。
- Vercel 部署还需 `experimental.outputFileTracingIncludes`（`'/api/transcribe': ['./node_modules/ffmpeg-static/**']`）把二进制打进 serverless trace。**注意：Next 14.2.35 这两个键都在 `experimental` 下**（不是顶层）。
- transcode.ts 里加了防御日志：启动打印 `ffmpegPath` 实际值；ffmpegPath 为空或文件不存在时抛明确 AppError。

### 块 3：无意义语料三层拦截（已全部验证通过）

**设计原则：最大风险是误伤真实用户，宁可漏拦不可错杀。**

- **第一层（录音页 `src/app/recording/page.tsx` handleFinish）**：录音时长 < 5 秒 → 不上传、留在录音页，提示「还想再说点什么吗？目前语料可能有点短哦」。
- **第二层（`src/lib/transcript-guard.ts` + `src/services/transcription.ts`）**：转写后判断——空文本 / 去标点后有效字 < 3 / 命中黑名单 → 抛 AppError code=`EMPTY_TRANSCRIPT`，录音页提示「好像没太听清，要不要再说一次？」。**黑名单 `HALLUCINATION_BLACKLIST` 当前是空数组**（占位，待实际观察到豆包对噪音的固定幻觉词再填，切勿凭空加正常词）。
- **第三层（`src/services/restructure.ts` + `api/restructure/route.ts` + `restructure/page.tsx`）**：千问（qwen-flash）整理时**额外**输出 `{usable, cleanedText}` JSON。usable=false（跑题/测试性/极空泛单句寒暄）时，**整理页软引导**（不拦截、按钮照常可点）：「这段内容可以再丰富一些，补充些细节后面练习效果会更好；当然也可以直接继续 ✨」。**有真实经历但内容简单（如"我妈做的红烧肉好吃"）必须判 usable=true。**
  - JSON 解析有兜底：解析失败/字段缺失 → fallback `{cleanedText:原始返回, usable:true}` + 一条 warn 日志，**绝不让整理流程崩**。

**踩过的坑（重要）：**
- 第一层最初有 **React 闭包陷阱**：handleFinish 的 useCallback 依赖数组没有 seconds，读到的永远是录音开始时的旧值 0，导致 85 秒录音被误判过短。**修法：用 `secondsRef`（useRef）在计时 setInterval 里同步更新，handleFinish 读 `secondsRef.current`。**

---

## 三、A 类清理（本次会话末尾完成）

1. **废弃 meta 标签**：`src/app/layout.tsx` 的 metadata 加 `other: { 'mobile-web-app-capable': 'yes' }`，与原 appleWebApp 并存。
2. **Orb 水合警告（`Prop style did not match`）**：`src/components/Orb.tsx` 用确定性伪随机 `drand(seed)`（Math.sin 哈希）替换 6 处 `Math.random()`，消除 SSR/CSR 不一致。视觉无变化。
3. **transcription.ts 是否删除**：**确认不删！** grep 发现 `api/transcribe/route.ts:9` 正在 import 它——它是服务端转写的核心服务层。之前"录音页直接 fetch、没用它"的观察只针对客户端；服务端 route 用的就是它。**别再误以为它是悬空死代码。**
4. **附带**：`tsconfig.json` 补 `"target": "ES2018"`（transcript-guard 的 `\p{P}` Unicode 正则需要，独立 tsc 检查才不报错）。

---

## 四、当前状态

**核心链路完全正常并验证通过：** 录音 → ffmpeg 转码 → 豆包转写 → 千问整理 → 三层拦截 → 整理页软引导。`tsc --noEmit` 与 `next build` 均零报错。

**已知遗留（B 类，未做，不影响功能）：**
- `icon-192.png 404`：PWA 图标缺失（manifest 引用了但文件不存在），console 会持续报这个 404 + 一条 manifest 图标警告。**与功能无关。** 等图标/设计定稿后处理。
- console 里 `layout.css 404` 已确认是 dev 缓存假摔，硬刷新即消失，非 bug。

**提醒用户自行处理：** 火山引擎账单确认（误升级正式版的费用）。

---

## 五、下一步优先级（按之前商定的顺序）

最初定的优先级是：无意义语料处理（**已完成**）> 登录/Supabase 迁移 > Empty 界面 > 测试。所以接下来候选：

1. **B 类收尾**：补 icon-192.png（及其他 PWA 图标），清掉最后的 console 404 —— 轻量，可与上架 PWA/iOS 准备一起做。
2. **登录 / Supabase 数据持久化迁移** —— 下一个大功能块。
3. 各页 Empty 状态界面。
4. 单元测试补全（transcript-guard 已有测试，其余 lib 工具待补）。

---

## 六、与这个项目协作的工作方式（务必延续）

这位用户偏好**先对齐方案、再动手**，且控制改动范围。每次给 Claude Code 的 prompt 应遵循项目规则：
- prompt 开头让其先读 ENGINEERING.md（UI 任务再加 DESIGN.md）。
- 明确「本次只改 X 文件，其他一律不动」，并要求**动手前先 view 现有文件确认结构**。
- 涉及不确定的现有结构时，**先发只读侦察 prompt**，回报后再写改造 prompt（本次靠这个避免了误删 transcription.ts）。
- 危险操作（删文件等）要求「先 grep 确认无引用，有则停下报告」。
- 颜色用 Tailwind token 不内联；渐变仅用于描边；页面背景 bg-bg-page、卡片 bg-white。
- 用户用 Claude Code（Sonnet）执行，dev server 建议让用户自己在终端跑（不要让 Claude Code 占着后台 shell，否则用户看不到日志——本次踩过这个坑）。
- 排查问题时坚持「看到真实日志/报错再下结论」，不靠猜改代码。
