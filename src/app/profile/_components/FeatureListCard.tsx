/**
 * @module   FeatureListCard
 * @desc     「我的」功能列表卡 — 收藏/历史/关于 纵向列表；登录态在栏底锚定「退出登录」(mt-auto)，
 *           未登录态额外提供「帮助与反馈」入口(FeedbackPopup, source=profile)
 * @author   LingoBridge
 * @created  2026-06-04
 */
'use client'

import { useState } from 'react'
import {
  Bookmark, History, MessageCircleQuestionMark,
  Info, ChevronRight, LogOut,
} from 'lucide-react'
import Card from '@/components/Card'
import { cn } from '@/lib/utils'
import FeedbackPopup from '@/components/FeedbackPopup'

interface FeatureListCardProps {
  bookmarkCount: number
  version: string
  /** 传入即为登录态：栏底锚定退出登录，并隐藏「帮助与反馈」(由常用操作承担) */
  onLogout?: () => void
}

interface FeatureItem {
  Icon: typeof Bookmark
  label: string
  badge: string | null
  onClick?: () => void
}

/**
 * 功能入口列表卡
 * @param bookmarkCount 收藏卡片数（localStorage 读取）
 * @param version       应用版本号（占位常量）
 * @param onLogout      退出登录回调；传入即启用登录态布局（等高列 + 栏底退出登录）
 */
export default function FeatureListCard({ bookmarkCount, version, onLogout }: FeatureListCardProps): JSX.Element {
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const loggedIn = !!onLogout

  const items: FeatureItem[] = [
    { Icon: Bookmark, label: '收藏的卡片', badge: String(bookmarkCount) },
    { Icon: History,  label: '练习历史',   badge: null },
    ...(loggedIn
      ? []
      : [{ Icon: MessageCircleQuestionMark, label: '帮助与反馈', badge: null, onClick: () => setFeedbackOpen(true) } as FeatureItem]),
    { Icon: Info, label: '关于 LingoBridge', badge: version },
  ]

  return (
    <>
      <Card variant="gradient" className={cn('overflow-hidden', loggedIn ? 'h-full flex flex-col' : 'mb-3')}>
        <div>
          {items.map(({ Icon, label, badge, onClick }, idx) => (
            <button
              key={label}
              onClick={onClick}
              className={cn(
                'w-full flex items-center px-[18px] py-[14px] bg-transparent active:bg-bg-muted/40 transition-colors',
                idx < items.length - 1 && 'border-b border-black/[0.05]',
              )}
            >
              <Icon size={18} className="text-v2-text-secondary" />
              <span className="flex-1 text-left text-[14px] text-v2-text-primary ml-3">{label}</span>
              {badge && <span className="text-[12px] text-v2-text-muted mr-1.5">{badge}</span>}
              <ChevronRight size={15} className="text-v2-text-muted" />
            </button>
          ))}
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
