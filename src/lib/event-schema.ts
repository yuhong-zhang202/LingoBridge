/**
 * @module   event-schema
 * @desc     埋点事件契约的【唯一真源】—— 事件名、每个事件的 props key 与取值域全部在此定义。
 *           客户端 track()、服务端 /api/events 的 sanitize、lib/events 的 FlowEventName 一律从这里派生，
 *           任何一处都不许再手抄一份枚举或联合类型。
 *           纯常量 + 纯类型，无运行时依赖：【禁止 import 'server-only'、禁止引用任何 server 模块】
 *           —— 本文件被 'use client' 链路直接引用。
 *
 *   【为什么要有这个文件】此前事件契约手抄在四处（lib/events、lib/client-events、api/events/route，
 *   外加 recording/page、useStorySubmit、practice/page 三份局部 CaptureOutcome/AiResult）。
 *   漏改的后果分三档，最后一档最要命：
 *     · 漏改事件名联合类型          → tsc 报错，挡得住；
 *     · 漏登记 EVENT_SPECS 分发表   → 服务端 400、被 track 的 fire-and-forget 吞掉 → 该事件静默零数据；
 *     · props key 或枚举值拼错     → 事件照常落库、【只有那一个字段静默消失】，本地测不出来，
 *       几周后拉数据发现某个维度全空才暴露。2026-08-02 那批三个真实 bug 全属这一档
 *       （mic surface 写死 'recording'、/write 的 mode 写死 'story'、rankingDegraded 没进白名单）。
 *   收敛到本文件后，第三档也变成 tsc 编译错误。
 *
 *   【新增一个事件要改哪几处】按顺序，缺一不可：
 *     1. 本文件：在 ClientEventPropsMap 加一条（服务端自发事件则加进 SERVER_ONLY_EVENTS）；
 *        需要新枚举时在本文件加 as const 数组 —— 不许在别处另抄一份。
 *     2. src/app/api/events/route.ts：写该事件的 sanitize（字段逐个显式列出、未匹配一律丢）并登记进
 *        EVENT_SPECS 分发表。
 *     3. 事件名前缀必须落在 DB 的 CHECK 正则 `^(flow|match|quota|auth|page)\.` 内（migration 0053）。
 *     4. src/app/api/__tests__/events-sanitize.test.ts 的 ALL_FLOW_EVENTS / ALL_CLIENT_EVENTS 各补一行。
 *
 *   【哪些漏改会报错、哪些会静默丢数据】——上线前必须人工过一遍第 2、3 步：
 *     · 第 1 步漏改 → tsc 报错（事件名不在联合类型里 / props 不合契约）；
 *     · 第 4 步漏改 → tsc 报错（Record<EventName, true> 缺 key）；
 *     · 第 2 步漏改 → 【不报错】。客户端照发，服务端查表未命中一律 400，而 track 是 fire-and-forget、
 *       错误被 .catch(()=>{}) 吞掉 —— 表现为「埋点代码在跑、库里零数据」。
 *     · 第 3 步漏改 → 【不报错】。insert 撞 CHECK 约束，异常又被 logEvent 的 catch 静默吞掉 —— 同上。
 *
 *   【每个事件都可能多带一个字段】`queueDelaySec`（补发延迟秒数）由 track 在【补发路径】上自动挂上，
 *     对所有事件一视同仁、不写进任何一个事件的 props 契约，服务端在分发之后统一收敛。
 *     写分析 SQL 时记得：**落库时间 ≠ 发生时间**，带了这个字段的行要减掉它。口径全文见
 *     本文件下方 QUEUE_DELAY_SEC_KEY 条目。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */

// ── 取值域枚举（as const 数组即真源：服务端 sanitize 直接拿它做白名单，客户端类型由它派生）───────
// ⚠️ 这些值同时是【数据分析口径】：改动 = 历史数据与新数据的分组对不上，改前先想清楚怎么迁移。

/** 用户从哪个入口开始一次故事采集 */
export const STORY_ENTRY = ['record', 'text', 'write', 'record_from_write'] as const
export type StoryEntry = (typeof STORY_ENTRY)[number]

/** 本次故事属于自由故事还是雅思题模式 */
export const STORY_MODE = ['story', 'ielts'] as const
export type StoryMode = (typeof STORY_MODE)[number]

/** 麦克风授权结果 */
export const MIC_RESULT = ['granted', 'denied', 'unavailable'] as const
export type MicResult = (typeof MIC_RESULT)[number]

/**
 * 麦克风授权发生在哪个界面。
 * 'practice'：练习页与录音页共用 useAudioRecorder，两处的授权失败必须分得开（见 useAudioRecorder.MicSurface）
 * —— 写死一个常量会把另一个界面的失败全灌进同一格（2026-08-02 的真实 bug）。
 */
export const MIC_SURFACE = ['home', 'recording', 'practice'] as const
export type MicSurface = (typeof MIC_SURFACE)[number]

/** 采集方式：语音 / 文字 */
export const CAPTURE_MODE = ['voice', 'text'] as const
export type CaptureMode = (typeof CAPTURE_MODE)[number]

/** 一次采集提交的结局（放行 / 被各类闸挡下） */
export const CAPTURE_OUTCOME = [
  'proceed', 'too_short', 'quota_blocked', 'no_audio', 'too_large', 'garbage',
  'text_too_short', 'consent_blocked', 'ai_failed', 'aborted',
] as const
export type CaptureOutcome = (typeof CAPTURE_OUTCOME)[number]

/** 采集中途放弃的出口：站内导航离开 / 页面卸载 */
export const CAPTURE_EXIT = ['nav', 'pagehide'] as const
export type CaptureExit = (typeof CAPTURE_EXIT)[number]

/**
 * 额度弹层的变体（= QuotaReached 组件的 variant，与服务端 402 的 reason 1:1 对应）。
 * trial=匿名试用总量用尽（面向注册转化）；story=注册用户故事月额度；ielts=注册用户复练月额度。
 */
export const QUOTA_VARIANT = ['trial', 'story', 'ielts'] as const
export type QuotaVariant = (typeof QUOTA_VARIANT)[number]

/**
 * 额度弹层从哪个界面弹出来 —— 一个调用点一格。
 * 值即 QuotaReached 的各调用点：首页 / 写作页 / 录音页 / 整理页 / 分析页 / 练习页 /
 * 题目详情页 / 题库列表 / 匹配页。写死一个常量会把所有界面灌进同一格
 * （flow.mic_permission 的 surface 就吃过这个亏），故各调用点必须各传各的常量。
 */
export const QUOTA_SURFACE = [
  'home', 'write', 'recording', 'restructure', 'analysis',
  'practice', 'practice_question', 'question_bank', 'matching',
] as const
export type QuotaSurface = (typeof QUOTA_SURFACE)[number]

/**
 * 额度弹层里用户点了什么。
 * register=去注册/登录（trial 变体的转化出口）；practice_ielts=去练雅思题；new_story=去讲个故事；
 * profile=去看额度明细；close=关掉弹层（点遮罩 / Esc）——「被吓走」的那一格。
 */
export const QUOTA_CTA = ['register', 'practice_ielts', 'new_story', 'profile', 'close'] as const
export type QuotaCta = (typeof QUOTA_CTA)[number]

/**
 * AI 调用属于哪一段管线。
 *
 * 【口径 = 所有会失败的 AI 调用，不是「开口链路叙事」】首版只列了 transcribe/restructure/polish 三段，
 * 是按「用户开口讲故事」这条叙事线划的范围 —— 于是 8 个 AI 路由里漏了 5 个。而这 5 个路由【全部有
 * 服务端不记账的早退分支】（matching 6 条、analysis 8 条、phrases 3 条、practice 4 条、pronounce 3 条：
 * 400 入参 / 402 额度 / 403 未同意 / 429 日限 / 503 并发满，外加结构性无痕的网络失败），
 * 早退 = logApiUsage 不记 = 现有成本看板完全看不见。2026-08-03 补齐后八段全覆盖。
 *
 * 值与 api_usage_logs.metadata.phase 的既有口径对齐（别自造名，否则两份数据没法对照）：
 *   transcribe=ASR / restructure=语料整理 / polish=单句润色 / analysis=题目分析 /
 *   phrases=换档词组 / coach=教练对话 / pronounce=发音纠错。
 *   matching 例外：服务端把成功拆成 extraction+ranking 两条 phase 记账，而客户端视角一次匹配就是
 *   一次调用（且失败时服务端记的正是 phase='matching'），故客户端统一记 'matching'。
 */
export const AI_STAGE = [
  'transcribe', 'restructure', 'polish', 'matching', 'analysis', 'phrases', 'coach', 'pronounce',
] as const
export type AiStage = (typeof AI_STAGE)[number]

/**
 * 一次 AI 调用的结局（HTTP 语义 + 客户端侧失败）。
 *
 * ⚠️ `aborted`【计数系统性偏低，不可当「有多少人等不及走了」的真值】
 * 它报在 React effect 的 cleanup 里，而**浏览器关标签页 / 地址栏跳走时 React 根本不跑 cleanup**
 * ——那种场景下整条 ai_call 一行都不存在，不是记错结局，是这次尝试压根没被记录。
 * 与 flow.capture_abandoned 同源（见该条目上方长注释）：方向已知（只低估）、大小未知、改不掉
 * （keepalive 实测在导航中大量丢包，bfcache 场景又刻意不报）。
 *
 * ✅ 但**成功率不受这条影响**，别被上一句吓到：成功率的分母刻意只含
 * 「跑到了某个结局的尝试」= ok + 用户侧 + 我方侧 + 网络 + other，**本就不含 aborted**
 * （见 lib/db/dashboard-flow-events.ts 的 attempts 定义）。漏掉的那次若记上也是 aborted、
 * 同样不进分母 ⇒ 分子分母都没动，成功率是干净的。
 * ⇒ 一句话：**成功率可以信；「aborted 有多少」不可以信。**
 */
export const AI_RESULT = [
  'ok', 'consent_403', 'quota_402', 'rate_429', 'bad_input_400', 'empty_422', 'auth_401',
  'busy_503', 'server_5xx', 'parse_fail', 'network', 'timeout', 'aborted', 'other',
] as const
export type AiResult = (typeof AI_RESULT)[number]

/**
 * 页面浏览的路由枚举 —— page.view 的【唯一】props。
 *
 * 🔴【隐私红线】只上报本枚举里的 code，**绝不上报 pathname 原文、绝不上报任何 query**。
 *   本项目的 query 里有 `?qid=` / `?corpusId=`，还有 `?h=`（handoff key）——最后那个**可反查到用户原文**。
 *   所以 page.view 的 props 里【不设任何自由文本字段】，白名单外的路径一律映射成 'other'，
 *   永远不许写「兜底把 pathname 塞进去」——那等于把上面这些串直接写进埋点库。
 *   pathname → 本枚举的映射见 `lib/page-route.ts`（全仓库唯一允许接触 pathname 的地方）。
 *
 * 【为什么是「单事件 + route 枚举」而不是一页一个事件名】事件名要同时满足 DB 的 CHECK 正则、
 *   /api/events 分发表、看板事件清单三处，一页一个名字 = 加个页面要改三处；
 *   单事件 + 枚举则加页面只改一个数组（本数组 + page-route 映射表，且两者有单测互相钉住）。
 *
 * ⚠️【首页这一格系统性偏低，别当访问量用】全新访客落地首页时【还没有 supabase session】
 *   （匿名账号是点「同意并开始」那一刻才建的），而 track 对无 session 是静默短路。
 *   于是首页那条 page.view 发不出去，且模块级 lastRoute 已被置成 'home'，
 *   【后来建了 session 也不会补发】。⇒ 偏低的量 ≈ 全新访客数，方向已知、大小可用
 *   consent_records 的新增人数近似（两者都是「第一次来的人」）。
 *   2026-08-03 实测：手动注入 session 后首页那条才发得出来，印证了这条缺口。
 *   同类口径陷阱还有 flow.capture_abandoned 与 flow.ai_call 的 aborted，见各自条目。
 *
 * 【加载影响·2026-08-03 实测，非推算】无头 Chrome + CDP 实测（dev server）：
 *   埋点请求在 load 事件【之后】才发出（比 DOMContentLoaded 晚约 300ms），不进首屏关键路径；
 *   每次导航【恰好 1 条】（dev 的 StrictMode 双跑被 lastRoute 挡住），body 62 字节，
 *   占一个页面 24~32 个请求中的 1 个。生产更快，但「在 load 之后」这个相对关系由 effect
 *   执行时机决定、与环境无关。
 *
 * 值 = src/app 下各 page.tsx 的路由，'-' 与路径分隔 '/' 一律转 '_'（与 QUOTA_SURFACE 同款 snake_case，
 * 免得分组统计时要记两套写法）。顺序 = 大致按用户主链路先后，其次是设置/账号类、最后是静态页。
 * ⚠️ 新增页面时必须同步加值 + 加映射，否则该页全部落进 'other'（看板上会看见 other 突增，可发现）。
 */
export const PAGE_ROUTE = [
  'home', 'write', 'recording', 'restructure', 'matching', 'practice_question', 'analysis',
  'practice', 'question_bank', 'library', 'review', 'anki_review',
  'profile', 'settings', 'login', 'reset_password',
  'about', 'privacy', 'privacy_beta', 'feedback', 'dashboard',
  /** 白名单外的路径（含未来新加、忘了登记的页面）—— 兜底桶，绝不含任何原文 */
  'other',
] as const
export type PageRoute = (typeof PAGE_ROUTE)[number]

/**
 * 页面【内部 tab】的枚举 —— page.tab_view 的【唯一】props。
 *
 * 🔴【隐私红线·与 PAGE_ROUTE 同级】只上报本枚举里的 code，**绝不上报 UI 里的 tab 标识原文**。
 *   题库两端的 tab 内部值是【中文串】（'维度设计' / '题目列表'），素材库两端是各自的英文短串，
 *   三套互不相同 —— 原样上报等于把界面文案当数据往库里灌（自由文本面），且两端的同一个 tab
 *   会落成不同的值、事后分不出来。所以本事件的 props 里【不设任何自由文本字段】，
 *   内部值 → 本枚举的映射【全仓库只有 lib/tab-view.ts 一处】（同 page.view 与 lib/page-route.ts 的关系）。
 *   ⚠️ 白名单外的值【一律不上报】，**刻意不设 'other' 兜底桶**（这一点与 PAGE_ROUTE 相反）：
 *   路由是开集（随时会加页面，兜底桶能告诉你「有页面忘了登记」），而 tab 是闭集、只有这 6 个，
 *   出现白名单外的值只可能是代码写错了 —— 造一个假桶会让这个 bug 看起来像一类真实用户行为，
 *   静默丢掉反而让它以「某个 tab 恒为 0」的形态暴露出来。
 *
 * 值 = 「模块_功能」snake_case（与 PAGE_ROUTE / QUOTA_SURFACE 同款，分组统计不用记两套写法）：
 *   library_* = 素材库四个分类；qbank_* = 题库两个 tab。
 *
 * ⚠️⚠️【这三条偏差是本事件的口径，做功能矩阵时它就是分母，必须先读完再用】
 *   ① **默认 tab 在页面挂载时也上报**（与 page.view 同款「看到了就是一次浏览」，2026-08-14 产品方拍板）。
 *      ⇒ 桌面端素材库默认 `cards`、题库两端默认 `'维度设计'`，故 **library_cards 与 qbank_dimension
 *      天然偏高**，含大量「只打开页面、没主动切换过」的人。**这两个值不可与其它 tab 直接比大小。**
 *   ② **移动端素材库默认落在 hub（分类首页，不上报）** ⇒ 移动端没有 ① 那个偏高，
 *      **双端口径不对称**：跨端对比同一个 tab（尤其 library_cards）时必须记得这件事。
 *   ③ **去重是模块级的、跨页面存活**（同 PageViewTracker 的 lastRoute，见 lib/tab-view.ts）：
 *      「离开素材库 → 逛别的页 → 回到素材库、仍落在同一个 tab」中间若没报过别的 tab，
 *      **第二次不会再记一条**。⇒ 本事件计的是「tab 切换/进入的次数」，**不是页面访问次数**，
 *      跟 page.view 的量对不上是预期的，别拿两者相除。
 *   ④ 题库在【加载中 / 出错 / 无语料空态】时同样会记一条 qbank_dimension（上报发生在挂载那一刻，
 *      早于 useQuestionBank 返回）。⇒ qbank_dimension 里含一批「其实只看到了空态」的人，
 *      问「有多少人真的用了维度设计」时要拿它跟 corpusCount>0 的人群交叉，别直接读。
 */
export const TAB_ID = [
  'library_stories', 'library_cards', 'library_words', 'library_pron',
  'qbank_list', 'qbank_dimension',
] as const
export type TabId = (typeof TAB_ID)[number]

/**
 * 备考目标分（IELTS band，4.0–9.0 步进 0.5）的取值域 —— 【刻意用字符串枚举，不用数字】。
 *
 * 不是洁癖，是躲一个静默改值的坑：client-events 的 normalize() 对所有 number 字段一律 `Math.round`
 * （因为服务端 sanitize 只收 Number.isInteger），直接报 6.5 会在【发出去之前】就被四舍五入成 7 ——
 * 6.5 与 7.0 在库里长得一模一样，4.5/5.5/…同理，一半档位悄悄并档。这比丢字段更坏：
 * 事件照常落库、字段也有值，只是值是错的，本地永远测不出来。
 * 走字符串则原样穿过 normalize，且顺手成了白名单：将来 UI 改步进冒出 '7.3' 这种野值会被服务端丢弃、
 * 表现为该字段缺失（看板上看得见），而不是被 round 成一个看着很合理的假值（看不见）。
 * 值固定一位小数、等宽 ⇒ 字符串排序即分数排序，分组统计不用记两套写法。
 */
export const GOAL_BAND = [
  '4.0', '4.5', '5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0', '8.5', '9.0',
] as const
export type GoalBand = (typeof GOAL_BAND)[number]

/**
 * 备考目标保存失败的原因 code。
 *
 * 🔴【隐私红线】只上报本枚举里的 code，**绝不上报 supabase 返回的 error.message 原文** ——
 *   那是自由文本、可能带邮箱等身份信息，还会把 props 的取值空间搞成无限维（事后没法分组统计）。
 *   收敛不出来的一律记 'unknown'，宁可粗，不可漏原文。
 *
 *   · date_before_min = 考试日期早于允许下限，被 handleSave 的 JS 守卫拦下 —— 压根没走到 updateUser；
 *   · update_failed   = saveExamGoal 里 updateUser 返回了 error（AppError code = 'SAVE_FAILED'）；
 *   · unknown         = 其余未预期异常（网络中断、SDK 内部抛错等）。
 *
 * ⚠️ 刻意【不设】form_invalid 之类「原生校验没过」的 code：ExamGoalModal 的 form 带 noValidate，
 *   浏览器根本不跑原生约束校验（那条路会在 fire submit 之前静默取消提交，正是 2026-08-07 那个
 *   「点了没反应」的成因）。留个恒为 0 的分桶只会让人日后怀疑埋点坏了。
 *   将来若有表单重新启用原生校验，再连同上报点一起加。
 */
export const GOAL_SAVE_FAIL_REASON = ['date_before_min', 'update_failed', 'unknown'] as const
export type GoalSaveFailReason = (typeof GOAL_SAVE_FAIL_REASON)[number]

/**
 * 反馈页的哪一套视图（收藏事件与「本页展示了几张卡」的分母事件共用同一份取值域）。
 *
 * ⚠️【为什么分子分母必须共用这一个枚举】要答的问题是「移动端是不是更容易收藏失败」，
 *   那就得拿 flow.phrase_collected / flow.phrase_collect_failed 去除 flow.feedback_rendered，
 *   三者的 view 只要有一处另立一套值（哪怕只是 'mb' vs 'mobile'），分组一 join 就对不上、
 *   比率算出来是空的。故 flow.feedback_rendered 刻意复用本枚举，不新增 FEEDBACK_VIEW。
 *
 * ⚠️【为什么不叫 *_SURFACE】本项目的 surface 一律指「哪个页面」（MIC_SURFACE / QUOTA_SURFACE），
 *   而这里两个值是【同一个页面】的两套视图：反馈页把移动/桌面两套 DOM 同时挂载、由 lg 断点决定谁可见。
 *   沿用 surface 这个词会让人以为它是页面枚举，分析时对不上口径。
 *
 * ⚠️ 值必须由各视图的收藏按钮【各传各的】（移动端右滑收藏在外壳里发生，由外壳代传 'mobile'）——
 *   在外壳里写死一个常量会把两套视图灌进同一格，正是 flow.mic_permission 的 surface 吃过的亏。
 *   这次要答的问题恰恰是「移动端是不是真的更容易收藏失败」，写死就等于答不了。
 */
export const COLLECT_VIEW = ['mobile', 'desktop'] as const
export type CollectView = (typeof COLLECT_VIEW)[number]

/**
 * 收藏一句优化表达失败的原因 code。
 *
 * 🔴【隐私红线】只上报本枚举里的 code：**绝不上报 supabase 的 error.message 原文**（自由文本、
 *   可能含邮箱等身份信息，且会把取值空间搞成无限维），**更绝不上报被收藏的句子本身**
 *   （原句/润色句/笔记全是用户原文）。收敛不出来的一律记 'unknown'，宁可粗，不可漏原文。
 *
 *   · session_failed = 拿不到可用会话（匿名登录失败 / 浏览器禁用存储 / 鉴权掉了）——压根没走到 insert；
 *   · insert_failed  = 走到了 insert 但 supabase 返回 error（RLS 拒绝、约束、网络断在这一段）；
 *   · unknown        = 其余未预期异常（收藏流程自身抛出的意外错误）。
 *
 * 【为什么这三档必须分开】线上反馈是「手机里收藏不了，只有电脑上才可以」，两类怀疑对象完全不同：
 *   session_failed 指向移动端浏览器的存储/隐私模式（匿名会话建不起来），insert_failed 指向网络或库侧。
 *   混成一格就没法判断该往哪查，等于埋了个只会告诉你「有人失败了」的埋点。
 */
export const COLLECT_FAIL_REASON = ['session_failed', 'insert_failed', 'unknown'] as const
export type CollectFailReason = (typeof COLLECT_FAIL_REASON)[number]

/**
 * 备考目标弹窗是被谁打开的。
 *
 * 【为什么非分开不可】它是 auth.goal_saved 的分母，而两条打开路径的性质完全不同：
 *   · card     = 用户自己点了卡片上的编辑/引导按钮 —— 这才是「有多少人想设目标」；
 *   · deeplink = /profile?goal=1 自动弹出（首页目标分提醒的落点），用户【没做任何选择】。
 * 混成一格，分母里就掺进一批「弹给他看、他压根没想设」的次数，保存率会被系统性拉低，
 * 而且首页那条提醒的曝光量一变、这个比率就跟着漂 —— 看着像产品变坏了，其实只是分母换了成分。
 */
export const GOAL_EDITOR_SOURCE = ['card', 'deeplink'] as const
export type GoalEditorSource = (typeof GOAL_EDITOR_SOURCE)[number]

// ── 字段名白名单（match.* 两个事件的 props 全是计数/布尔/内部 id，取值域不是枚举而是数值区间）──────

/** match.view_rendered 的数字字段白名单（全为计数，无原文） */
export const VIEW_RENDERED_NUMERIC = ['candidateCount', 'highCount', 'midCount', 'visibleCount', 'unscoredCount'] as const
/**
 * match.view_rendered 的布尔字段白名单。
 * rankingDegraded：matching/page.tsx 一直在发，但白名单里长期没有 → 一路被 sanitize 丢弃
 * （生产核查：match.view_rendered 138 行、带该字段的 0 行）。它用来区分两类空态
 * （重排整体降级 vs B 类低相关展示），缺了它这两件事在数据里长得一模一样。
 */
export const VIEW_RENDERED_BOOL = ['noMatch', 'globalNoneVisible', 'rankingDegraded'] as const

/** match.question_opened 的正整数字段白名单：rank = 1-based 排位、candidateCount = 列表总数 */
export const QUESTION_OPENED_NUMERIC = ['rank', 'candidateCount'] as const

/** match.view_rendered 的 props 契约（字段全可选：客户端按当次渲染实际有的信息带） */
export type ViewRenderedProps =
  Partial<Record<(typeof VIEW_RENDERED_NUMERIC)[number], number>> &
  Partial<Record<(typeof VIEW_RENDERED_BOOL)[number], boolean>>

/** match.question_opened 的 props 契约（dwellMs 上界与 rank 不同故单列；questionId/algoVersion 为受限形态串） */
export type QuestionOpenedProps =
  Partial<Record<(typeof QUESTION_OPENED_NUMERIC)[number], number>> & {
    /** 用户在匹配页的活跃浏览时长(ms)，0 允许 = 一眼即点 */
    dwellMs?: number
    /** 题目主键 UUID（仅内部 id 引用，无原文） */
    questionId?: string
    /** 排序算法版本短枚举串（形如 'v1-2026-07-17'） */
    algoVersion?: string
  }

// ── match.result（服务端专属事件）的候选池明细契约 ────────────────────────────────────────────
// ⚠️ match.result 在 SERVER_ONLY_EVENTS 里：由 lib/events.ts 以 service_role 直接落库，
//    【不过 /api/events 的 sanitize】。故本节只定义契约与上限，api/events/route.ts 一行都不用改
//    （那条路仍会把客户端上报的 match.result 一律 400，见 events-sanitize.test.ts 的 ALL_FLOW_EVENTS）。

/**
 * `match.result` 的 `candidates` 数组单条 —— 一次匹配【实际召回并送去重排】的一道候选题。
 *
 * 【为什么非有不可·这是「空手」归因的唯一分辨依据】此前 match.result 只记 `candidateCount`（计数）。
 *   生产 26 条空手里 23 条（88.5%）是「有候选、打了分、全部 < SCORE_MID」，而计数答不了那唯一要紧的问题：
 *   **最高分是 59 还是 25？** 擦线（重排判错）与完全不沾边（召回给的题题材不对）在数据里长得一模一样，
 *   却指向完全相反的修法。逐条的 (题目 id, 分数, 来源观察点) 才分得开。
 *
 * ⚠️【成功的匹配也记】不是只在空手时才写。只记失败样本就没有对照组，「空手的候选长这样」读不出意义。
 *
 * 🔴【隐私】只放内部 id 与 taxonomy code：**绝不放题面文本**（题面事后 join `questions` 表即可，
 *   落进 props 等于把题库内容重复落一份库，还会把 props 撑大一个数量级）、
 *   **更绝不放用户故事的任何内容**（观察点 code 已是全事件既有口径，见 events.ts 顶注的隐私约定）。
 *
 * 【口径·空数组 ≠ 缺字段，这两件事必须分得开】
 *   · `candidates: []`  = 这次匹配【一道候选都没召回】（零召回，与 `noMatch=true`、`candidateCount=0` 同时成立）；
 *   · 字段【整个不存在】= 这条事件早于本字段上线（2026-08-26 之前的历史行），或某条发事件的路径漏写了。
 *   为此本字段在【每一条】发 match.result 的路径上都【无条件写出】（fresh / cache / joined 三条路共用
 *   api/matching/route.ts 的 matchResultEventProps 一处产出），绝不做「没有候选就不带这个 key」的省略。
 */
export interface MatchResultCandidate {
  /** 题目主键 UUID（仅内部 id 引用，无原文；题面事后 join questions 表拿） */
  id: string
  /**
   * 重排给出的相关性分数（0–100）。
   * `null` = 这道题【没拿到分】（重排整体降级 / 模型漏了这一条），**绝不回填占位分** ——
   * 覆辙见 match-level.ts 的 `?? 100`：把「我们不知道」写成一个看着很合理的假值，事后无法分辨。
   */
  score: number | null
  /** 是否来自主观察点那一层召回（= FunnelMatchedQuestion.isPrimaryMatch，与前端「换个角度」标签同源） */
  isPrimary: boolean
  /**
   * 这道题是挂在哪个观察点上被召回的（如 'REL_06'，= FunnelMatchedQuestion.matched_point）。
   *
   * 【为什么不能只有 isPrimary】`isPrimary=false` 把「副观察点补充」和「邻居兜底」压成同一格，
   * 而本次要答的问题恰恰是「**邻居层实际贡献了什么**」——只有 isPrimary 就答不了。
   * 有了本字段，与同一条 props 里的 `primaryCode` / `secondaryCode` 一比即可分层：
   * `== primaryCode` → 主层；`== secondaryCode` → 副层；两者都不是 → 邻居层（且直接看得出借的是哪个邻居）。
   */
  obs: string
}

/**
 * `candidates` 数组的条数上限 —— **安全阀，不是采样**。
 *
 * 生产实测候选数中位 10、最大 91（GRO_01），故 100 在当前题库下【永不触发】= 事实上全量记录。
 * 为什么不按分数取 top-10：**选样的依据（重排分）正是被怀疑的那个东西** ——
 * 若重排真的判错了，那道「用户其实能答的题」恰恰会被它压到低位、被 top-N 切掉，
 * 于是数据只能证明「重排自己认为最高的几道不行」，永远证不了「池子里有没有能答的」。
 * 全量记的代价可忽略（fresh 匹配约 2.5 次/天 × 最坏 7KB），换的是这个问题可回答。
 *
 * 触发上限时按分数降序保留最高的若干条；`candidateCount`（真实总数）不受本上限影响，
 * ⇒ `candidates.length < candidateCount` 即「这条被截断了」，可判别、不静默。
 */
export const MATCH_RESULT_CANDIDATES_MAX = 100

// ── 全事件通用的元字段（不属于任何一个事件的业务 props，由 track 在补发时自动挂上）───────────────

/**
 * 【通用元字段】`queueDelaySec` —— 这条事件是补发的，且在本地补发队列里躺了多少【秒】。
 *
 * 【为什么必须有它·落库时间不等于发生时间】埋点拿不到 token / 请求失败时会进本地队列（见
 *   lib/client-events.ts 的 outbox），下次有会话时补发。补发那条事件落库的 `created_at`
 *   是【补发那一刻】，不是事情发生那一刻 —— 跨过零点补发，就会把昨天的事算进今天，
 *   按天/按小时的曲线会被悄悄搬家，而且看不出来（一条正常的事件而已）。
 *   带上本字段后，真实发生时间 = created_at - queueDelaySec，口径可还原。
 *
 * 【口径】
 *   · 字段【不存在】= 这条事件是当场发出去的（绝大多数），不是「延迟 0 秒」；
 *   · 存在且 = 0     = 补发的，但入队到补发不足 0.5 秒（取整到 0）；
 *   · 单位秒、整数（走 normalize 的 Math.round 不会失真，这也是刻意不用毫秒/小数的原因）；
 *   · 上限 {@link QUEUE_DELAY_SEC_MAX}：超过这个岁数的队列条目在补发前就被丢掉，不会出现更大的值。
 *
 * 【为什么不写进每个事件的 props 契约】它对【所有】事件一视同仁，写进 ClientEventPropsMap 就得在
 *   十几个事件里各抄一遍、且逼着每个调用方显式传一个与业务无关的字段。故它由 track 在补发路径上
 *   自行挂载，服务端也在【分发之后统一】收敛（见 api/events/route.ts 的 pickQueueDelaySec）——
 *   那是全表唯一一个跨事件的字段，除它之外绝不许再开第二个「通用放行」的口子。
 */
export const QUEUE_DELAY_SEC_KEY = 'queueDelaySec'

/**
 * 补发延迟的上限（秒）= 24 小时，同时也是本地队列条目的存活上限。
 * 取 24h 的理由：再老的事件对「按天看趋势」已无意义，而队列越老越可能跨越一次账号切换
 * （换人 = 归属记错人，见 client-events 的 clearAuthCache）—— 宁可丢，不可记错人。
 */
export const QUEUE_DELAY_SEC_MAX = 24 * 60 * 60

// ── 客户端可上报事件 → props 契约映射（本 map 的 key 即 ClientEventName 全集）──────────────────

/**
 * 客户端事件的 props 契约。
 * 【必填 key 的写法】值域写成 `X | undefined` 而非 `key?: X` 的字段，表示「这个 key 必须显式给出」：
 * 漏写 key 即 tsc 报错，但允许显式传 undefined（该字段本次确实没有，normalize 会丢掉它）。
 */
export type ClientEventPropsMap = {
  'flow.story_entry': { entry: StoryEntry; mode: StoryMode }
  'flow.mic_permission': { result: MicResult; surface: MicSurface }
  'flow.capture_started': { mode: CaptureMode }
  'flow.capture_submitted': {
    mode: CaptureMode
    /** 本次提交的结局。【必填】漏传等于这次提交在结局分布里凭空消失，是本次收敛要挡的头号哑故障。 */
    outcome: CaptureOutcome
    /** 语音路径的录音时长(秒) */
    durationSec?: number
    /** 文字路径的字数（只记长度，绝不带正文——隐私铁律） */
    charCount?: number
  }
  // ⚠️⚠️ flow.capture_abandoned【永久禁止做任何比率的分子】——只能当归因样本用。
  // 它的丢失概率与「用户怎么离开」强相关，是方向已知、大小未知的系统性偏差，改代码消不掉：
  //   · 站内跳走（React 卸载）实测 3/3 到；关标签页/地址栏跳走实测 0/8（前者进 bfcache 刻意不报，
  //     后者是 keepalive 请求已创建但未发出，浏览器侧丢包，与我方代码/鉴权/落库都无关）。
  //   · 也就是说：越是「彻底不玩了」越报不出来，越是「站内溜达一圈」越报得出来。
  // ⇒ 拿 count(*) 算放弃率会系统性低估，且低估幅度不可校正（大小未知 = 无法加权修正）。
  // 【放弃率的唯一正确来源是离线推断口径】：有 capture_started、但窗口内该 user 没有新增 corpus 行。
  // 它的输入（capture_started 在挂载时报、早于用户做任何决定；corpus 是服务端事实）丢失与结局无关，
  // 只缩小样本、不偏移比率。口径全文见 docs/交接-用户反馈批次-2026-08-02.md §3.5。
  'flow.capture_abandoned': {
    mode: CaptureMode
    exit: CaptureExit
    durationSec?: number
    charCount?: number
  }
  'flow.ai_call': {
    stage: AiStage
    /**
     * 本次调用结局。【必填】少了它，这次调用就在 AI 结局分布里凭空消失 —— 而那份分布正是
     * 「服务端记不到的失败」（403/402/429/503/网络）的唯一可见渠道，漏一条就少看见一次真实故障。
     */
    result: AiResult
    /** 语音/文字路径（transcribe 阶段隐含 voice，故不强制） */
    mode?: CaptureMode
    /** HTTP 状态码；网络失败/超时等无状态码的场景传 0 */
    httpStatus?: number
    /** 端到端耗时(ms)；请求尚未发出时不带此字段 */
    latencyMs?: number
  }
  'match.view_rendered': ViewRenderedProps
  'match.question_opened': QuestionOpenedProps
  /** 额度弹层【显示】了（组件挂载即报，一次显示只报一次）—— 转化漏斗「被拦住的人数」那一格 */
  'quota.reached': {
    variant: QuotaVariant
    /**
     * 弹层出现在哪个界面。【必填 key】写成 `| undefined` 而非可选：调用方必须显式表态。
     * ⚠️ QuotaReached 的 surface prop 目前是可选的（matching/page.tsx 那个调用点尚未传，
     * 见该组件 Props 注释）—— 未传时本字段为 undefined，会在看板「额度弹层界面」一栏计入「(未上报)」。
     */
    surface: QuotaSurface | undefined
  }
  /** 额度弹层内点了某个按钮（含关闭）—— 与 quota.reached 相除即各出口的转化占比 */
  'quota.cta': { variant: QuotaVariant; cta: QuotaCta }
  /**
   * 注册成功。fromAnonymous 必须在 updateUser【之前】读 —— 升级之后 session 里 is_anonymous
   * 已变 false，事后读到的恒为 false，这一格就永远是空的。
   */
  'auth.registered': { fromAnonymous: boolean }
  /**
   * 备考目标（目标分 + 考试日期）保存【成功】。
   *
   * ⚠️【为什么非有不可】这条路是客户端直连 supabase `updateUser` 写 user_metadata，
   *   **不经过我方任何 API、服务端零痕迹**。没有本事件，「目标分到底存没存上」除了用户口头反馈
   *   （2026-08-07 就是这么发现问题的）没有第二个观测渠道。
   *
   * ⚠️【为什么叫 auth. 而不是 profile.】DB 的 event CHECK 是前缀正则 `^(flow|match|quota|auth|page)\.`
   *   （migration 0053），`profile.` 会被 CHECK 拒绝，而 logEvent 的 catch 把异常静默吞掉 ——
   *   表现为「埋点代码全在跑、库里零数据」（正是本文件顶注第 3 步那个坑）。故复用 auth. 前缀，
   *   语义上也贴 auth.registered 的「账号级设置」。
   *
   * 🔴【隐私】只报一个 band 枚举 + 两个布尔。**绝不上报考试日期本身** —— 那是用户的个人备考计划；
   *   「有多少人愿意填日期」用 hasDate 就答完了，多存一个日期只多一份个人信息、换不到任何信息量。
   */
  'auth.goal_saved': {
    /**
     * 本次保存的目标分（枚举串，见 GOAL_BAND 的「为什么不是数字」）。
     * 【必填 key】写成 `| undefined`：调用方必须显式表态；映射不出枚举值时传 undefined，
     * 该字段缺失（可发现），绝不许兜底塞个近似值。
     */
    band: GoalBand | undefined
    /** 是否同时设了考试日期（只记有没有，不记日期） */
    hasDate: boolean
    /** 此前没设过目标分 = 首次设置；false = 修改已有目标。漏斗上是两个不同动作，不能混算成功率。 */
    isFirstTime: boolean
  }
  /**
   * 备考目标保存【失败】—— 与 auth.goal_saved 相除即这条路的成败率（此前完全不可观测）。
   * 「点了保存但没存成」的各条路径都算，包括前端守卫直接拦下、根本没走到 updateUser 的那种。
   * 🔴 reason 只收 GOAL_SAVE_FAIL_REASON 的 code，绝不带后端 error message 原文（理由见该枚举）。
   */
  'auth.goal_save_failed': {
    reason: GoalSaveFailReason
    /** 同 auth.goal_saved：首次设置失败与修改失败是两件事（新用户设不上才是最要命的那类） */
    isFirstTime: boolean
  }
  /**
   * 收藏了一句优化表达（反馈页右滑/点「收藏」）——【落库成功之后】才报。
   *
   * ⚠️【绝不能报在点击那一刻】点击即报会把失败也算成一次收藏，与 flow.phrase_collect_failed
   *   相除得到的成功率就永远是 100% —— 那等于把本次要修的那个「计数照加、其实一条没进库」的
   *   骗用户 bug 原样复制进数据里，而且这回连人都看不见。
   *
   * 🔴【隐私】只带序号与视图。被收藏的句子（original / optimized / note）一个字都不许进 props。
   */
  'flow.phrase_collected': {
    /**
     * 本场第几条成功收藏，1-based（口径 = 本次反馈页停留期间累计成功数，失败不占号）。
     * 用来看「一场到底收几句」的分布 —— 只需一个整数，不受 normalize 的 Math.round 影响。
     */
    nth: number
    view: CollectView
  }
  /**
   * 收藏失败 —— 与 flow.phrase_collected 相除即这条路的成败率。
   *
   * 【为什么非有不可】这条路此前【零埋点】：失败只写 console.error，用户看到的却是「收藏成功」，
   *   失败率在库里完全不可观测（2026-08-07 之前唯一的发现渠道是用户口头反馈「手机收藏不了」）。
   * 🔴 reason 只收 COLLECT_FAIL_REASON 的 code，绝不带 error message 原文（理由见该枚举）。
   */
  'flow.phrase_collect_failed': {
    reason: CollectFailReason
    view: CollectView
  }
  /**
   * 反馈页展示了几张卡 ——【收藏两个事件的分母】。反馈页读完暂存、loaded 置位那一刻发一条。
   *
   * 【为什么非有不可·分母缺失是本项目最贵的一类盲区】埋点此前只记「收藏成功」和「收藏失败」，
   *   从不记「有多少人有机会收藏」。于是 flow.phrase_collected 全为 0 有两种解释 ——
   *   「没人想收藏」和「所有人都点了但按钮是死的」——【在数据里长得一模一样】。
   *   后者 2026-08-07 上午真的发生过：commit 9609d78 把 GradientButton 默认 type 改成 'button'，
   *   三个表单的提交按钮同时变成装饰品，而 tsc / eslint / build / 全部单测【全绿】，
   *   最后靠用户口头反馈才发现。有了本事件，「展示 N 次、收藏尝试 0 次」一眼可见。
   *
   * ⚠️【cardCount === 0 也必须发】那不是「没数据不用发」，恰恰是最重要的一条信号：
   *   说明用户练完了却一句都没攒下（润色全失败 / 暂存被清 / 存储不可用）。漏发 = 这类事故永远看不见。
   *
   * ⚠️【口径：本事件计的是「反馈页挂载次数」，不是「场次数」】用户从反馈页退出再进来会【再记一条】，
   *   且那一条多半 cardCount=0（暂存已在处理完时清掉）。⇒ 本事件的量【会大于】flow.practice_ended，
   *   多出来的部分是回访，不是新场次。算「练完却没看到反馈」的缺口时，
   *   分母一律用 flow.practice_ended，别反过来拿本事件当场次数。
   *
   * 🔴【隐私】只带一个计数与一个视图枚举。卡片里的句子（原句/润色句/笔记）一个字都不许进 props。
   */
  'flow.feedback_rendered': {
    /** 本次展示的卡片数；0 = 空态，见上方「必须发」那条。整数，不受 normalize 的 Math.round 影响。 */
    cardCount: number
    /** 当前生效的是移动还是桌面视图（两套 DOM 同时挂载，由 lg 断点决定谁可见，故按断点实测取值） */
    view: CollectView
  }
  /**
   * 一场练习结束了 ——【反馈页的分母】。练习页 handleEnd（点「结束」）里发一条。
   *
   * 【为什么非有不可】有了它，「练习结束 N 次、反馈页展示 M 次」的缺口才看得见：
   *   N ≫ M 说明用户点了结束却没走到反馈页（跳转失败 / 中途关页），此前这段路完全不可观测。
   *
   * ⚠️【偏低方向已知】只在点「结束」按钮这一条路上报。直接关标签页/地址栏跳走的场次不会有本事件
   *   （与 flow.capture_abandoned 同源的卸载丢失，见该条目）。⇒ 本事件计的是【主动结束】的场次，
   *   不是「练习总场次」，别拿它当练习量的真值。
   *
   * 🔴【隐私】只带两个计数。对话内容、题目题面、被润色的句子一个字都不许进 props。
   */
  'flow.practice_ended': {
    /** 本场用户说了几轮（= messages 里 role==='user' 的条数）；0 = 抽到题就退，也要发 */
    turns: number
    /** 本场攒下几句优化表达（= 写进暂存、反馈页会拿到的条数）—— 与 feedback_rendered 的 cardCount 对照 */
    polishedCount: number
  }
  /**
   * 备考目标弹窗打开了 ——【auth.goal_saved / auth.goal_save_failed 的分母】。
   *
   * 【为什么非有不可】保存成败两条事件此前【没有分母】：goal_saved 为 0 既可能是「没人想设目标」，
   *   也可能是「弹窗里的保存按钮是死的」（2026-08-07 就是这种：form 带 noValidate + 按钮 type
   *   被改成 'button'，点了完全没反应，全套自动检查照样全绿）。有了本事件，
   *   「弹窗开了 N 次、保存事件 0 条」立刻能看见。
   *
   * ⚠️ 上报点必须在【弹窗真的打开】那一刻，不是在按钮的 onClick 里 —— 后者会把「点了但没打开」
   *   也算成一次打开，正好把要观测的那类 bug 抹平（与 flow.phrase_collected 不许报在点击那一刻同理）。
   *
   * 🔴【隐私】只带一个来源枚举 + 两个布尔。绝不带目标分数值、更绝不带考试日期（见 GOAL_BAND / auth.goal_saved）。
   */
  'auth.goal_editor_opened': {
    /** 谁把它打开的（用户点卡片 vs ?goal=1 深链自动弹），口径见 GOAL_EDITOR_SOURCE */
    source: GoalEditorSource
    /** 打开时还没设过目标分 = 首次设置。与 auth.goal_saved 的同名字段【同一算法】（targetBand === null），否则两头对不上 */
    isFirstTime: boolean
    /** 打开时是否已有考试日期（只记有没有，不记日期） */
    hasDate: boolean
  }
  /**
   * 页面浏览 —— 漏斗的分母那一格（「有多少人到过这一页」）。
   *
   * ⚠️【全站唯一一个「每次导航都必然发一条」的事件】改它之前先想清楚代价：多加一个字段 =
   *   全站每次页面切换都多算一次、多传一次。故 props 刻意只有 route 一个枚举字段，
   *   不带时长、不带来源页、不带任何自由文本（来源页要的是 referrer 语义，那既是隐私面又要多存一份状态）。
   *
   * 🔴 route 的取值域见 PAGE_ROUTE 上方的隐私红线：绝不上报 pathname 原文与 query。
   *
   * 【口径】同一路由连续触发只报一条（客户端 PageViewTracker 按 route 去重，挡 StrictMode 双挂载、
   *   父组件重渲染、query 变而 pathname 未变三种重复）；⇒ 本事件计的是「进入该页的次数」，
   *   不是「渲染次数」。另外无 session 时 track 静默不发（全新访客首页尚无 session），
   *   所以【首页的 page.view 系统性偏低】，别拿它当首页 UV。
   */
  'page.view': { route: PageRoute }
  /**
   * 页面【内部 tab】浏览 —— page.view 只到路由级（整个素材库就一个 'library'），
   * 答不了「用户实际在用哪个功能」：素材库 4 个分类 + 题库 2 个 tab 在数据里长得一模一样，
   * 于是「素材库 94 次 / 29 人」这类数字产生不了任何行动。本事件把那一层拆开。
   *
   * ⚠️ props 刻意【只有 tab 一个枚举字段】，理由同 page.view：它挂在每一次 tab 切换上，
   *   多一个字段就是「全站 tab 切换次数 × 1」。不带时长、不带来源 tab、不带任何自由文本。
   *
   * 🔴 tab 的取值域见 TAB_ID 上方的隐私红线：绝不上报 UI 里的内部 tab 标识/中文标签原文。
   * 【口径】默认 tab 挂载即报、移动端 hub 不报、去重跨页面存活、题库空态也计一条 ——
   *   四条偏差全写在 TAB_ID 的注释里，**用这个事件做任何比率之前必须先读那一段**。
   */
  'page.tab_view': { tab: TabId }
}

/** 客户端可上报的事件名（= 上面 map 的 key；服务端 /api/events 的 EVENT_SPECS 必须逐一对应，未注册即 400） */
export type ClientEventName = keyof ClientEventPropsMap

/**
 * 只由服务端自己发的事件名 —— 不接受客户端上报（不在 EVENT_SPECS 分发表里）。
 * match.result = 一次匹配的结果分布；flow.corpus_bound = 语料建成；flow.consent_granted = 同意捕获。
 */
export const SERVER_ONLY_EVENTS = ['match.result', 'flow.corpus_bound', 'flow.consent_granted'] as const
export type ServerOnlyEventName = (typeof SERVER_ONLY_EVENTS)[number]
