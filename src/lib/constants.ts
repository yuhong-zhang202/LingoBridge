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
export const PAGE_CONTAINER = 'max-w-[1280px] mx-auto px-8 lg:px-12'

// ── 模型名常量（千问 qwen-plus 稳定别名；qwen-flash 用于成本敏感、质量要求次之的环节）
export const MODEL_RANKING     = 'qwen-plus'
export const MODEL_PRACTICE    = 'qwen-plus'
export const MODEL_EXTRACTION  = 'qwen-plus'
export const MODEL_ANALYSIS    = 'qwen-plus'    // 侧重点分析（flash 跟不住固定 3 点约束，回退 qwen-plus）
export const MODEL_RESTRUCTURE = 'qwen-flash'
export const MODEL_PRONOUNCE   = 'qwen-plus'    // 发音音标 + 怎么念提示

// ── 相关性排名三档阈值（调参时改这里，不要散落硬编码）
/** score ≥ 此值：高匹配，默认直接展示 */
export const SCORE_HIGH = 85
/** score ≥ 此值且 < SCORE_HIGH：中匹配，折叠进"查看更多" */
export const SCORE_MID  = 60
/** score ≥ 此值且 < SCORE_MID：低匹配，折叠进"查看更多" */
export const SCORE_LOW  = 40
// score < SCORE_LOW：不展示

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

// ── 浅色渐变描边（复用 BRAND_GRADIENT_SOFT 的 0.35 透明度，橙味更淡、不偏棕）
// 用于：素材库里词组收藏/发音/我的语料卡等需要更轻的描边
export const GRADIENT_BORDER_STYLE_SOFT: CSSProperties = {
  background: [
    'linear-gradient(white, white) padding-box',
    `${BRAND_GRADIENT_SOFT} border-box`,
  ].join(','),
  border: '1.5px solid transparent',
}
