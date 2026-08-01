/**
 * @module   constants
 * @desc     设计系统全局常量 — 品牌色、渐变描边样式、维度标签映射、模型名、阈值
 * @author   LingoBridge
 * @created  2026-05-15
 */
import type { CSSProperties } from 'react'
import type { DimensionId, DimensionLabel } from '@/lib/types'

// ── 网页版（桌面）内容区统一容器：全站唯一宽度来源，所有顶栏(TopNav)+浏览页(首页/题库/素材库/我的)引用此常量。
//    max-w 收窄两侧留白、居中；桌面内边距走 lg:px-12，lg 断点(1024px)以下保持 px-8 → 移动端视觉不变。
//    改内容区宽度只改这一处。手机端沉浸布局(max-w-[430px])与核心链路任务页的聚焦宽度不走这里。
export const PAGE_CONTAINER = 'max-w-[1120px] mx-auto px-8 lg:px-12'

// ── 桌面顶栏高度：TopNav 在 lg 断点(1024px)及以上的固定高度（px）。
//    不止 TopNav 自己用：核心链路任务页的「满屏舞台」高度是 100vh 减去顶栏，
//    改这个值必须同步复核所有 calc(100vh - 顶栏) 的舞台高度（如 analysis / practice / matching 桌面视图），
//    否则舞台会溢出一屏或留白。lg 以下为 64px，移动端不走沉浸舞台，故不抽常量。
export const TOPNAV_H_DESKTOP = 72
/** TopNav 桌面高度的 Tailwind class（唯一来源，见 TOPNAV_H_DESKTOP） */
export const TOPNAV_H_DESKTOP_CLASS = 'lg:h-[72px]'

// ── 跳转加载反馈 ─────────────────────────────
/**
 * 顶部路由进度条持续超过此毫秒数（跨新加坡 Supabase 高延迟）时，才淡入一行安抚文案「网络较慢…」。
 * 只安抚、不报错（真失败由各页 error 态承担）。改阈值只改这里，NavProgress 引用此值。
 */
export const SLOW_HINT_MS = 2500

// ── 题库季度（换季软下架）─────────────────────────────
/**
 * 当前在考季度，格式 'YYYY-MM'。匹配召回与首页切换池只取 season === 此值的题；
 * 过季题（season 为旧值）保留在库、仍可经 id 直接练习/分析，但不进召回。
 * 每年 1/5/9 月换题季时：更新此常量 + 配套跑换季导入（import:season → remap:links v3）。
 * 语义与 DB questions.season 默认值 / 迁移 0027 一致。
 */
export const CURRENT_SEASON = '2026-05'

// ── 经营看板「活跃」口径变更 ─────────────────────────────
/** 看板「活跃」口径由「仅 AI 调用」放宽为「核心活跃」的生效日（趋势图据此画口径变更标注线）。 */
export const METRIC_DEFINITION_CHANGED_AT = '2026-07-31'

// ── 模型名常量（千问 qwen-plus 稳定别名；qwen-flash 用于成本敏感、质量要求次之的环节）
export const MODEL_RANKING     = 'qwen-plus'
export const MODEL_PRACTICE    = 'qwen-plus'
export const MODEL_EXTRACTION  = 'qwen-plus'
export const MODEL_ANALYSIS    = 'qwen-plus'    // 侧重点分析（flash 跟不住固定 3 点约束，回退 qwen-plus）
export const MODEL_RESTRUCTURE = 'qwen-flash'
export const MODEL_PRONOUNCE   = 'qwen-plus'    // 发音音标 + 怎么念提示
export const MODEL_ANKI         = 'qwen-plus'    // Anki 卡背生成（与探针 scripts/anki-probe/generate.mjs 同模型）

// ── Anki 卡背生成流水线（drain 后台处理器）参数 ──
// 单次 drain 从队列领取的任务上限：领取即串行执行、限制单次并发量级（方案 §2「全局限并发」的粗粒度实现）。
export const ANKI_DRAIN_BATCH = 5
// 全局并发上限：同一批领取的任务按【卡主 user_id 分桶】，桶间最多并发这么多个、桶内串行（按 user 串行）。
export const ANKI_DRAIN_CONCURRENCY = 3
// 失败重试指数退避：next_attempt_at = now + min(BASE × 2^(attempts-1), MAX)。
export const ANKI_DRAIN_BACKOFF_BASE_MS = 60_000       // 首次失败退避 1 分钟
export const ANKI_DRAIN_BACKOFF_MAX_MS = 3_600_000     // 封顶 1 小时

// ── 相关性排名两条线、三档语义（调参时改这里，不要散落硬编码）
//
// 模型输出仍是 0-100 分；三档语义由这两条线映射而成：
//   ≥ SCORE_HIGH        高匹配 —— 首屏直接展示（= 这道题能原样用语料回答，见产品不变式 1）
//   [SCORE_MID, HIGH)   中匹配 —— 折叠进"查看更多"（= 换角度/挪重心/习惯套单次才能答）
//   < SCORE_MID         不展示、不入库（= 必须换故事 / 答非所问）
//
// 为什么没有第三条线：原 SCORE_LOW=40 划出的「低匹配折叠可见（40-59）」档已于 2026-07-16
// 由产品方拍板取消（台账 042）。依据是实测——低档在模型输出里是假精度：40-59 区间的 21 条
// 候选全部堆在 40 这一个点上，题目显示与否取决于模型凑整到 40 还是 35。
/** score ≥ 此值：高匹配，首屏直接展示 */
export const SCORE_HIGH = 85
/** score ≥ 此值且 < SCORE_HIGH：中匹配，折叠进"查看更多"。低于此值：不展示、不入库 */
export const SCORE_MID  = 60

// ── 重排三维合成（第一阶段：AI 分维度 + 代码按权重合成，藏在 RANKING_DIMENSIONAL 开关后）
//
// 现状路径让 AI 直接吐 0-100 总分，病根是「话题字面相关→模型累加冲高」。维度路径改为让 AI 逐题
// 只判维度（D0 门控 + D1/D2/D3 改动量），最终分数由【代码】按权重合成——把「先判断后落分」钉死
// 在代码里，而非指望模型自觉。以下权重 / 阈值 / 代表分全部做成具名常量，第二阶段 LOSO 拟合只改这里。
//
// 改动量 = W1·D1 + W2·D2 + W3·D3；D0=present 时按改动量分档：0→高 /（0, DELTA_MID_MAX]→中 / >上限→低。
/** D1「重心/聚光灯要挪」的权重（第一阶段等权占位；TODO 第二阶段 LOSO 拟合） */
export const RANKING_W1 = 1
/** D2「场景/时间对不上」的权重（第一阶段等权占位；TODO 第二阶段 LOSO 拟合） */
export const RANKING_W2 = 1
/** D3「习惯 vs 单次」的权重（第一阶段等权占位；TODO 第二阶段 LOSO 拟合） */
export const RANKING_W3 = 1
/** 加权改动量 > 0 且 ≤ 此上限 → 中匹配；> 此上限 → 低匹配（TODO 第二阶段随权重一起拟合） */
export const RANKING_DELTA_MID_MAX = 1

// 档位 → 0-100 代表分（对下游输出契约零改动，切分线仍 SCORE_HIGH/SCORE_MID = 85/60）：
//   高 90（≥85 首屏） / 中 70（∈[60,85) 折叠） / 低 45（<60 不展示） / 隐藏 20（<60 不展示）
/** 代表分·高匹配：D0=present 且改动量为 0（重心/场景/习惯都不用改） */
export const RANKING_TIER_HIGH   = 90
/** 代表分·中匹配：D0=present 且改动量 ≤ DELTA_MID_MAX（小改动即可答） */
export const RANKING_TIER_MID    = 70
/** 代表分·低匹配：D0=present 且改动量 > DELTA_MID_MAX，或 D0=need_other_story（得换个经历） */
export const RANKING_TIER_LOW    = 45
/** 代表分·隐藏：D0=absent（题目要的核心场景/对象故事里压根没出现） */
export const RANKING_TIER_HIDDEN = 20

/**
 * 档内 tie-break：同档内按加权改动量给一个微小递减（改得越多、排得越靠后），保留排序连续性。
 * RANKING_TIE_MAX 卡在「远小于最近档距（20）的一半」，确保 tie-break 永不把某题挤过 85/60 切分线，
 * 也不会跨档反超。第一阶段等权下改动量 ≤3、微调 ≤3，本就够小，上限只是给第二阶段大权重上保险。
 */
export const RANKING_TIE_UNIT = 1
/** tie-break 递减上限（分），见 RANKING_TIE_UNIT 注释 */
export const RANKING_TIE_MAX  = 8

// ── 匹配存档口径版本 ─────────────────────────────
/**
 * 萃取/排序/阈值口径的版本号，纳入匹配存档（corpus_match_snapshots）的命中判定：
 * 存档命中 = 存在 且 story_hash 一致 且 algo_version === 此值。升级此值 = 作废全部旧档，
 * 用户下次重访按「未命中」静默重算一次落新档、之后冻结。
 *
 * 任何会改变「同一故事给出的高/中/低集合」的调整都必须 bump 此值，否则用户会一直看到旧口径的
 * 冻结存档，包括但不限于：萃取 prompt、排序算法/prompt、SCORE_HIGH/SCORE_MID 切分线、邻居兜底逻辑、
 * 以及切换 RANKING_DIMENSIONAL 开关（两条打分路径结果不同，产品方切开时须同步 bump）。
 */
export const RANKING_ALGO_VERSION = 'v1-2026-07-17'

// ── 语料最小字数门槛（Anki 双防线·源头：防薄素材语料诱发例句编造）──
/**
 * 建【新】语料的最小【有效字符】门槛：剔标点/空格/换行后的「中文汉字 + 英文单词字符」数须 ≥ 此值。
 * 阈值 40 由产品方 2026-07-24 拍板（中间档探针：门槛只「逃灾难区 21→40」、残余编造靠留空，非单调）。
 * 三处同源消费：客户端预检（文字 useStorySubmit / 语音 recording 两入口）+ /api/restructure 兜底 + /api/corpus 入库兜底。
 * ⚠️ 独立字数闸，绝不碰 restructure 的 usable 判定（usable 故意放行薄素材、是 LLM 质量判断，改它会误伤 + 跑偏成 AI 判断力改动）。
 * 只拦【新建】；编辑 / 重匹配旧语料走 updateCorpusCleaned、天然跳过 POST /corpus，旧短语料既往不咎。
 */
export const MIN_CORPUS_CHARS = 40

// ── 匿名试用额度（未注册用户免费体验一遍；控 AI 成本 + 促注册转化）
/** 匿名用户可建语料条数（体验一条完整链路即到上限，引导注册） */
export const ANON_CORPUS_LIMIT = 1
/** 匿名用户每日整理次数上限（restructure 不落库，单独计数；容忍重录试错，故给 5 次余量） */
export const ANON_RESTRUCTURE_LIMIT = 5

// ── 付费接口每日次数上限（服务端按 (user_id, 当日, kind) 计次；超额匿名 402、注册 429）
/** 匿名每日：practice 对话轮次（约两场 8 轮对话）*/
export const ANON_PRACTICE_TURN_LIMIT = 16
/** 匿名每日：polish 润色次数（16 轮内每轮可优化一次 + 换个说法重试余量）*/
export const ANON_POLISH_LIMIT = 20
/** 匿名每日：pronounce 发音提示次数 */
export const ANON_PRONOUNCE_LIMIT = 10
/** 匿名每日：transcribe 转写次数（练习每轮消耗一次转写，16 轮 + 故事录音与重录余量）*/
export const ANON_TRANSCRIBE_LIMIT = 25
/** 匿名每日：matching 真实匹配次数（匿名只能建 1 条语料，改稿重匹配给 5 次余量；读档命中不计次）*/
export const ANON_MATCHING_LIMIT = 5
/** 匿名每日：analysis 侧重点分析次数（一次匹配约出 10~20 题，逐题看完再有重看余量）*/
export const ANON_ANALYSIS_LIMIT = 20
/** 匿名每日：phrases 换词组次数（同一题可换不同水平档，按 analysis 同量给）*/
export const ANON_PHRASES_LIMIT = 20

// 注册用户熔断上限：正常使用永远碰不到，仅防脚本滥用（触发返回 429，不走配额弹层）
export const REG_PRACTICE_DAILY_LIMIT = 200
export const REG_POLISH_DAILY_LIMIT = 100
export const REG_PRONOUNCE_DAILY_LIMIT = 100
export const REG_TRANSCRIBE_DAILY_LIMIT = 200
/** 注册每日：matching 真实匹配（单次 = 萃取 + 重排两次 qwen-plus，是全站最贵的一跳，故压到 50）*/
export const REG_MATCHING_DAILY_LIMIT = 50
/** 注册每日：analysis 侧重点分析（可传任意 questionId 反复调，与 practice 同档 200）*/
export const REG_ANALYSIS_DAILY_LIMIT = 200
/** 注册每日：phrases 换词组（重出按钮可连点，介于 polish 100 与 analysis 200 之间取 150）*/
export const REG_PHRASES_DAILY_LIMIT = 150
/** 注册每日：restructure 文字整理（与 transcribe 对齐 200——两者一一配对，且走最便宜的 qwen-flash，压太低会误伤真实用户）*/
export const REG_RESTRUCTURE_DAILY_LIMIT = 200
/** 注册每日：anki 存对子（注册专属；换语料不计配额；单条 part2 长文约与 matching 单跳同量级，取 50）*/
export const REG_ANKI_DAILY_LIMIT = 50
/**
 * 注册每日：anki 换语料（PUT /anki/cards/corpus）的【防脚本滥用】上限——与「用户每日配额」是两回事。
 * 产品方拍板「换语料不计配额」（不扣用户额度、正常改稿反复换随便用），但换语料同样触发付费 AI 重生成，
 * 零闸门时单账号可脚本无限烧 AI 费。故这里加一道【独立、宽松、高阈值】的熔断：走独立 kind='anki_swap'
 * 计次（与 'anki' 存对子额度互不相干），仅拦住机器级滥用。正常用户一天换几十次都碰不到 200；超限返 429。
 * 与「换语料不计配额」不矛盾——那说的是不扣【存对子的 50 额度】，本值是防滥用护栏、非用户可感配额。
 */
export const REG_ANKI_SWAP_DAILY_LIMIT = 200

// ── Anki 档位切点（⚠️ 已废弃：v0.3 砍 band，不分档）──
/**
 * @deprecated v0.3 分点式拍板「不分档、砍 band 落地」（方案-Anki卡背-分点式-v0.3 §2.1）。
 *   短例句不再按用户目标分调地道度，统一「自然达标口语」一个目标。bandToTier / resolveTargetBand /
 *   target-band.ts 已随生成器分点式重写移除，本常量【不再被任何生成路径消费】。保留仅为进度文档
 *   （docs/Anki后端进度.md）留痕；如后续确认无外部引用可直接删。
 */
export const TIER_SPLIT = 6.25
/**
 * @deprecated 同 TIER_SPLIT：v0.3 砍 band 后不再被消费（原 target-band.ts 的默认档兜底，该文件已删）。
 */
export const DEFAULT_TARGET_BAND = 6.5

// ── 失败归因（api_usage_logs.metadata.error_kind）──
// 背景：并非所有 status='error' 都是系统故障。用户录了一段没人声的音频（EMPTY_TRANSCRIPT）属于
// 「用户输入问题」——服务是好的，只是这份输入没法处理。混进成本看板的错误率会淹没真实故障信号
// （2026-07 历史错误率 62.75% 几乎全是这类噪音）。
//
// 为什么打在 metadata 而不是新增 status='user_error'：
//   · 0012 迁移对 status 有 check(status in ('success','error'))，加值要改约束、且代码先于迁移上线会静默丢日志；
//   · 「已经花掉的钱」口径必须不变 —— 失败成本 / 按环节 errorCost 都按 status='error' 汇总，
//     换 status 会让这些行凭空从失败成本里消失，正好与产品方拍板（留在失败成本里）相反。
//   打标记则只影响显式检查该标记的那一处口径，其余全部零改动。
//
// 历史数据：已有行没有这个键 → 一律按系统故障计（口径只影响新数据，绝不追溯改写历史）。
/** metadata.error_kind 的键名 */
export const ERROR_KIND_KEY = 'error_kind'
/** 用户输入问题（空录音、将来的音频过大/文字超长等同类）：计入失败成本，但不计入系统错误率 */
export const ERROR_KIND_USER_INPUT = 'user_input'
/**
 * 容量繁忙（豆包并发超限 45000292，对用户返回 503 ASR_BUSY 的那条）：属「人多稍等」、服务本身是好的，
 * 不是系统故障。与 user_input 同层——计入失败成本（豆包这一跳仍可能计费），但不计入系统错误率，
 * 免得高峰期排队把真实故障信号污染成一片红。看板 isSystemError 据此从错误率摘出。
 */
export const ERROR_KIND_CAPACITY = 'capacity'
/**
 * 网络中断（客户端网络重置 / 请求被中断）：ECONNRESET、ECONNABORTED、AbortError、message 含 'aborted' 等。
 * 服务本身是好的，是客户端与服务端之间的连接被掐断（用户关页/切网/上游 abort），不是后端故障。
 * 与 user_input / capacity 同层——计入失败成本，但不计入系统错误率，免得客户端网络抖动污染真实故障信号。
 * 看板 isSystemError 据此从错误率摘出、失败明细单列「网络中断」，与「系统故障」的告警红区分开。
 */
export const ERROR_KIND_NETWORK = 'network'

/** 维度 id → 中文显示标签 */
export const DIMENSION_LABEL: Record<DimensionId, DimensionLabel> = {
  emotion: '情绪内核',
  relationship: '人际羁绊',
  space: '空间感知',
  spirit: '精神栖所',
  growth: '成长演进',
  value: '价值底色',
}

/**
 * 用户目标分（user_metadata.target_band，4.0–9.0 步进 0.5，null=未设）→ 分析页词组水平档 level 字符串。
 * 夹到 phrases 支持的档位集合 ['5.0','5.5','6.0','6.5','7.0','7.5','8.0']：
 *   4.0/4.5 → '5.0'；5.0–8.0 直取；8.5/9.0 → '8.0'；null → '6.0'（默认，与匿名/脚手架缺省一致）。
 * @param targetBand  目标分（null=未设目标）
 * @returns           喂给 /api/analysis(·/phrases) 的 level 字符串
 */
export function targetBandToLevel(targetBand: number | null): string {
  if (targetBand === null) return '6.0'
  return Math.min(8, Math.max(5, targetBand)).toFixed(1)
}

export const BRAND_COLORS = {
  orange: '#D4875A',
  green:  '#7BA699',
} as const

// ── 品牌渐变字符串（135deg 橙→绿）。两档透明度：实色 0.85 / 0.80 与浅色 0.35。
// 用于自定义渐变需求；标准描边卡片请直接用 GRADIENT_BORDER_STYLE / _FULL。
export const BRAND_GRADIENT      = 'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80))'
export const BRAND_GRADIENT_SOFT = 'linear-gradient(135deg, rgba(240,188,160,0.35), rgba(168,210,196,0.35))'
/** 品牌渐变（竖向 to bottom，橙→绿，实色 0.85/0.80）—— 与 BRAND_GRADIENT 同色、方向改为竖直。
 *  用于选中行 / 卡片左侧竖条等（matching 题卡、FlashCard、题库进度条等多处复用同一值）。 */
export const BRAND_GRADIENT_VERTICAL = 'linear-gradient(to bottom, rgba(240,188,160,0.85), rgba(168,210,196,0.80))'

// ── 渐变描边样式（2色停）
// 用于：library、matching、article-view 页面的卡片/按钮描边
export const GRADIENT_BORDER_STYLE: CSSProperties = {
  background: [
    'linear-gradient(white, white) padding-box',
    'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80)) border-box',
  ].join(','),
  border: '1.5px solid transparent',
}

// ── 渐变描边样式（3色停）
// 用于：feedback、article 页面的卡片/按钮描边
export const GRADIENT_BORDER_STYLE_FULL: CSSProperties = {
  background: [
    'linear-gradient(white, white) padding-box',
    'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80), rgba(188,210,168,0.75)) border-box',
  ].join(','),
  border: '1.5px solid transparent',
}

// ── 渐变描边 + 不透明白底（观感同 _FULL；底层再垫一层不透明白，挡住背后透色）
// 用于：SwipeToDelete 包裹的卡（词组收藏/发音/我的语料）——半透明描边会把背后的删除红透出来染成红边，
// 垫白底后描边只叠在白上，与收藏卡的描边一致、不再透红。
export const GRADIENT_BORDER_STYLE_FULL_OPAQUE: CSSProperties = {
  background: [
    'linear-gradient(white, white) padding-box',
    'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80), rgba(188,210,168,0.75)) border-box',
    'linear-gradient(white, white) border-box',
  ].join(','),
  border: '1.5px solid transparent',
}
