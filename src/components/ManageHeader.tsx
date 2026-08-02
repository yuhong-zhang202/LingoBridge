/**
 * @module   ManageHeader
 * @desc     管理页（题库/素材库）统一页头 —— 面包屑行（首页 › 当前页 + 右侧工具位）+ 标题行（H1 + 右侧插槽）。
 *           「我的」(profile) 页不用本组件、只共用下方 MANAGE_CONTAINER 容器常量，自行拼页头；
 *           三页靠同一容器保持密度/对齐一致。对齐 lingobridge-questionbank-c (v3)。
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
  /** 面包屑行右侧（与 TopNav 头像共右边界的工具位） */
  topRight?: ReactNode
}

/**
 * 管理页统一页头
 * @param title     标题（兼作面包屑当前节点）
 * @param subtitle  副标题（可选）
 * @param right     标题行右侧内容（可选）
 * @param topRight  面包屑行右侧内容（可选）
 */
export default function ManageHeader({ title, subtitle, right, topRight }: ManageHeaderProps): ReactNode {
  return (
    <div className="pt-6 pb-4">
      {/* 面包屑与 topRight 分列两侧：面包屑保持自包含一整块（将来若升级成 <nav aria-label="面包屑">，
          右侧工具位不能被裹进导航语义里），所以外包一层 flex 行而不是给面包屑本身加 justify-between */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-[7px] text-[0.8125rem] text-v2-text-muted">
          <ProgressLink href="/" className="hover:text-v2-text-secondary transition-colors">首页</ProgressLink>
          <ChevronRight size={14} />
          <span className="text-v2-text-secondary font-medium">{title}</span>
        </div>
        {topRight}
      </div>
      <div className="flex items-center justify-between gap-4 mt-2.5">
        <h1 className="text-[1.625rem] font-bold tracking-[-0.01em] text-v2-text-primary">{title}</h1>
        {right}
      </div>
      {subtitle && <p className="text-[0.8125rem] text-v2-text-muted mt-1.5">{subtitle}</p>}
    </div>
  )
}
