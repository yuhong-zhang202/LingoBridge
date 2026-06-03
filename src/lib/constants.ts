/**
 * @module   constants
 * @desc     设计系统全局常量 — 品牌色、渐变描边样式、维度标签映射
 * @author   LingoBridge
 * @created  2026-05-15
 */
import type { CSSProperties } from 'react'
import type { DimensionId, DimensionLabel } from '@/lib/types'

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
