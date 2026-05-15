import type { CSSProperties } from 'react'

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

// ── 品牌色
export const BRAND_COLORS = {
  orange:      '#D4875A',  // 主色：CTA、强调
  sage:        '#7BA699',  // 辅助色：AI 相关、成功状态
  orangeLight: '#F0EDE9',  // 主色浅版：次要按钮底色
  sageLight:   '#EEF7F3',  // 辅助色浅版：AI 标签底色
  warm:        '#FDFAF6',  // 用户气泡底色
  bgBase:      '#F2F0ED',  // 页面底色
} as const
