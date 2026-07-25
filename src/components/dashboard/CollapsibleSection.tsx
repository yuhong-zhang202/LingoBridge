'use client'
/**
 * @module   dashboard/CollapsibleSection
 * @desc     看板 Tier2 折叠分组外壳 —— 用原生 <details>/<summary>，无需 JS 状态即可展开收起，
 *           读屏与键盘天然可达。summary 命中区 ≥44px，右侧 chevron 展开时旋转 180°。
 * @author   LingoBridge
 * @created  2026-07-25
 */
import type { ReactNode } from 'react'

/**
 * 一个可折叠分组：标题行常驻，展开后渲染 children。
 * @param title       分组标题（如「A · 增长」）
 * @param subtitle    标题右侧的可选补充小字（如条目数/口径提示）
 * @param defaultOpen 是否默认展开（增长组默认展开，其余默认收起）
 * @param children    展开后的内容
 */
export default function CollapsibleSection({
  title, subtitle, defaultOpen = false, children,
}: {
  title: string; subtitle?: string; defaultOpen?: boolean; children: ReactNode
}) {
  return (
    <details open={defaultOpen} className="group bg-white rounded-[16px] border border-black/[0.05] mb-3 overflow-hidden">
      <summary className="flex items-center gap-2 min-h-[44px] px-4 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
        <span className="text-[13px] font-semibold text-v2-text-primary">{title}</span>
        {subtitle && <span className="text-[11px] text-v2-text-muted">{subtitle}</span>}
        {/* chevron：展开时旋转 180°；纯装饰，对读屏隐藏（展开态由 details 原生语义承载） */}
        <svg className="ml-auto flex-shrink-0 transition-transform duration-200 group-open:rotate-180"
          width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="#7C6B5E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="px-4 pb-4 pt-1">{children}</div>
    </details>
  )
}
