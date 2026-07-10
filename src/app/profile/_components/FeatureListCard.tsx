/**
 * @module   FeatureListCard
 * @desc     「我的」功能列表卡 — 「关于 LingoBridge」导航到 /about；登录态在栏底锚定「退出登录」(mt-auto)，
 *           未登录态额外提供「帮助与反馈」入口(FeedbackPopup, source=profile)
 * @author   LingoBridge
 * @created  2026-06-04
 */
'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  MessageCircleQuestionMark, Info, ChevronRight, LogOut,
} from 'lucide-react'
import Card from '@/components/Card'
import { cn } from '@/lib/utils'
import FeedbackPopup from '@/components/FeedbackPopup'

interface FeatureListCardProps {
  version: string
  /** 传入即为登录态：栏底锚定退出登录，并隐藏「帮助与反馈」(由常用操作承担) */
  onLogout?: () => void
}

/** 行内容（图标 + 标题 + 右侧 badge/箭头），Link 行与 button 行共用 */
const ROW_CLASS = 'w-full flex items-center px-[18px] py-[14px] bg-transparent active:bg-bg-muted/40 transition-colors'

function RowBody({ Icon, label, badge }: { Icon: typeof Info; label: string; badge: string | null }): JSX.Element {
  return (
    <>
      <Icon size={18} className="text-v2-text-secondary" />
      <span className="flex-1 text-left text-[14px] text-v2-text-primary ml-3">{label}</span>
      {badge && <span className="text-[12px] text-v2-text-muted mr-1.5">{badge}</span>}
      <ChevronRight size={15} className="text-v2-text-muted" />
    </>
  )
}

/**
 * 功能入口列表卡
 * @param version  应用版本号（占位常量）
 * @param onLogout 退出登录回调；传入即启用登录态布局（等高列 + 栏底退出登录）
 */
export default function FeatureListCard({ version, onLogout }: FeatureListCardProps): JSX.Element {
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const loggedIn = !!onLogout

  return (
    <>
      <Card variant="gradient" className={cn('overflow-hidden', loggedIn ? 'h-full flex flex-col' : 'mb-3')}>
        <div>
          {!loggedIn && (
            <button
              onClick={() => setFeedbackOpen(true)}
              className={cn(ROW_CLASS, 'border-b border-black/[0.05]')}
            >
              <RowBody Icon={MessageCircleQuestionMark} label="帮助与反馈" badge={null} />
            </button>
          )}
          {/* 导航语义：内容页跳转用 Link，支持 Cmd+click / 中键新开 */}
          <Link href="/about" className={ROW_CLASS}>
            <RowBody Icon={Info} label="关于 LingoBridge" badge={version} />
          </Link>
        </div>

        {loggedIn && (
          <button
            onClick={onLogout}
            className="mt-auto w-full flex items-center px-[18px] py-[14px] border-t border-black/[0.05] text-error active:bg-bg-muted/40 transition-colors"
          >
            <LogOut size={16} className="text-error" />
            <span className="flex-1 text-left text-[14px] ml-3">退出登录</span>
          </button>
        )}
      </Card>
      <FeedbackPopup open={feedbackOpen} onClose={() => setFeedbackOpen(false)} source="profile" />
    </>
  )
}
