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

// ── 模型名常量（千问 qwen-plus 稳定别名；qwen-flash 用于成本敏感、质量要求次之的环节）
export const MODEL_RANKING     = 'qwen-plus'
export const MODEL_PRACTICE    = 'qwen-plus'
export const MODEL_EXTRACTION  = 'qwen-plus'
export const MODEL_ANALYSIS    = 'qwen-plus'    // 侧重点分析（flash 跟不住固定 3 点约束，回退 qwen-plus）
export const MODEL_RESTRUCTURE = 'qwen-flash'
export const MODEL_PRONOUNCE   = 'qwen-plus'    // 发音音标 + 怎么念提示

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

// 注册用户熔断上限：正常使用永远碰不到，仅防脚本滥用（触发返回 429，不走配额弹层）
export const REG_PRACTICE_DAILY_LIMIT = 200
export const REG_POLISH_DAILY_LIMIT = 100
export const REG_PRONOUNCE_DAILY_LIMIT = 100
export const REG_TRANSCRIBE_DAILY_LIMIT = 200

/** 维度 id → 中文显示标签 */
export const DIMENSION_LABEL: Record<DimensionId, DimensionLabel> = {
  emotion: '情绪内核',
  relationship: '人际羁绊',
  space: '空间感知',
  spirit: '精神栖所',
  growth: '成长演进',
  value: '价值底色',
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
