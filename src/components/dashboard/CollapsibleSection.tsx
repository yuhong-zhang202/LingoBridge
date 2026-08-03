'use client'
/**
 * @module   dashboard/CollapsibleSection
 * @desc     看板 Tier2 折叠分组外壳 —— 用原生 <details>/<summary>，读屏与键盘天然可达。
 *           summary 命中区 ≥44px，右侧 chevron 展开时旋转 180°。
 *           open 走「非受控 + 惰性 useState 只算一次的初始值」（模式与理由同 FeedbackTodoList 顶注）：
 *           defaultOpen 可为数据驱动值（如「今日有失败才展开」）；初始值终身不变 → React diff 恒等、
 *           不会回写 DOM，用户手动开合与锚点跳转的展开都天然保留，无需受控 open。
 * @author   LingoBridge
 * @created  2026-07-25
 */
import { useState } from 'react'
import type { ReactNode } from 'react'

/**
 * 一个可折叠分组：标题行常驻，展开后渲染 children。
 * @param title       分组标题（问句式，如「出事了吗」——识别优于回忆）
 * @param subtitle    标题右侧的可选补充小字（如条目数/口径提示）
 * @param rangeBadge  summary 右侧的口径 chip（如「近 7 天」）：口径跟着区块走，
 *                    收起状态下也看得见这块数据是什么时间范围的
 * @param defaultOpen 是否默认展开（故障组默认展开，其余默认收起）
 * @param children    展开后的内容
 */
export default function CollapsibleSection({
  title, subtitle, rangeBadge, defaultOpen = false, children,
}: {
  title: string; subtitle?: string; rangeBadge?: string; defaultOpen?: boolean; children: ReactNode
}) {
  // 初始 open 只算一次（本组件在看板数据到达后才挂载，defaultOpen 首帧即为真值）
  const [open] = useState(defaultOpen)
  return (
    <details open={open} className="group bg-white rounded-[16px] border border-black/[0.05] mb-3 overflow-hidden">
      <summary className="flex items-center gap-2 min-h-[44px] px-4 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
        <span className="text-[0.8125rem] font-semibold text-v2-text-primary">{title}</span>
        {subtitle && <span className="text-[0.6875rem] text-v2-text-muted">{subtitle}</span>}
        {rangeBadge && (
          <span className="ml-auto flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[0.6875rem] font-medium bg-black/[0.04] text-v2-text-muted">
            {rangeBadge}
          </span>
        )}
        {/* chevron：展开时旋转 180°；纯装饰，对读屏隐藏（展开态由 details 原生语义承载） */}
        <svg className={`${rangeBadge ? 'ml-1' : 'ml-auto'} flex-shrink-0 transition-transform duration-200 group-open:rotate-180`}
          width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="#7C6B5E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="px-4 pb-4 pt-1">{children}</div>
    </details>
  )
}
