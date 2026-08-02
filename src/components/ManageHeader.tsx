/**
 * @module   ManageHeader
 * @desc     管理页（题库/素材库/我的）统一页头 —— 面包屑（首页 › 当前页）+ 标题行（H1 + 右侧插槽）。
 *           配合 MANAGE_CONTAINER 容器，使三页页头密度/对齐一致。对齐 lingobridge-questionbank-c (v3)。
 * @author   LingoBridge
 * @created  2026-06-30
 */
'use client'
import type { ReactNode } from 'react'
import ProgressLink from '@/components/ProgressLink'
import { ChevronRight } from 'lucide-react'
import { PAGE_CONTAINER } from '@/lib/constants'

/** 管理页统一内容容器 —— 直接引用全站唯一容器常量 PAGE_CONTAINER（宽度只在 constants.ts 改一处） */
export const MANAGE_CONTAINER = PAGE_CONTAINER

interface ManageHeaderProps {
  /** H1 标题，同时作为面包屑当前节点文字 */
  title: string
  /** 标题下方副标题（可选） */
  subtitle?: string
  /** 标题行右侧插槽（如 Tab 切换器 / 搜索） */
  right?: ReactNode
}

/**
 * 管理页统一页头
 * @param title     标题（兼作面包屑当前节点）
 * @param subtitle  副标题（可选）
 * @param right     标题行右侧内容（可选）
 */
export default function ManageHeader({ title, subtitle, right }: ManageHeaderProps): ReactNode {
  return (
    <div className="pt-6 pb-4">
      <div className="flex items-center gap-[7px] text-[0.8125rem] text-v2-text-muted">
        <ProgressLink href="/" className="hover:text-v2-text-secondary transition-colors">首页</ProgressLink>
        <ChevronRight size={14} />
        <span className="text-v2-text-secondary font-medium">{title}</span>
      </div>
      <div className="flex items-center justify-between gap-4 mt-2.5">
        <h1 className="text-[1.625rem] font-bold tracking-[-0.01em] text-v2-text-primary">{title}</h1>
        {right}
      </div>
      {subtitle && <p className="text-[0.8125rem] text-v2-text-muted mt-1.5">{subtitle}</p>}
    </div>
  )
}
