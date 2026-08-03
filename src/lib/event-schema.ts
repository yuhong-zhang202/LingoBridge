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

/** AI 调用属于哪一段管线 */
export const AI_STAGE = ['transcribe', 'restructure', 'polish'] as const
export type AiStage = (typeof AI_STAGE)[number]

/** 一次 AI 调用的结局（HTTP 语义 + 客户端侧失败） */
export const AI_RESULT = [
  'ok', 'consent_403', 'quota_402', 'rate_429', 'bad_input_400', 'empty_422', 'auth_401',
  'busy_503', 'server_5xx', 'parse_fail', 'network', 'timeout', 'aborted', 'other',
] as const
export type AiResult = (typeof AI_RESULT)[number]

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
}

/** 客户端可上报的事件名（= 上面 map 的 key；服务端 /api/events 的 EVENT_SPECS 必须逐一对应，未注册即 400） */
export type ClientEventName = keyof ClientEventPropsMap

/**
 * 只由服务端自己发的事件名 —— 不接受客户端上报（不在 EVENT_SPECS 分发表里）。
 * match.result = 一次匹配的结果分布；flow.corpus_bound = 语料建成；flow.consent_granted = 同意捕获。
 */
export const SERVER_ONLY_EVENTS = ['match.result', 'flow.corpus_bound', 'flow.consent_granted'] as const
export type ServerOnlyEventName = (typeof SERVER_ONLY_EVENTS)[number]
