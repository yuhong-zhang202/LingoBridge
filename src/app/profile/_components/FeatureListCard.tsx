/**
 * @module   FeatureListCard
 * @desc     「我的」功能列表卡 — 两态均显示的底部入口列表；「帮助与反馈」入口接入 FeedbackPopup（source=profile）
 * @author   LingoBridge
 * @created  2026-06-04
 */
'use client'

import { useState } from 'react'
import {
  Bookmark, History, MessageCircleQuestionMark,
  Info, ChevronRight,
} from 'lucide-react'
import { GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'
import { cn } from '@/lib/utils'
import FeedbackPopup from '@/components/FeedbackPopup'

interface FeatureListCardProps {
  bookmarkCount: number
  version: string
}

interface FeatureItem {
  Icon: typeof Bookmark
  label: string
  badge: string | null
  onClick?: () => void
}

/**
 * 功能入口列表卡，登录/未登录态均显示
 * @param bookmarkCount  收藏卡片数（localStorage 读取）
 * @param version        应用版本号（占位常量）
 */
export default function FeatureListCard({ bookmarkCount, version }: FeatureListCardProps): JSX.Element {
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  const items: FeatureItem[] = [
    { Icon: Bookmark,                  label: '收藏的卡片',       badge: String(bookmarkCount) },
    { Icon: History,                   label: '练习历史',          badge: null },
    { Icon: MessageCircleQuestionMark, label: '帮助与反馈',        badge: null, onClick: () => setFeedbackOpen(true) },
    { Icon: Info,                      label: '关于 LingoBridge',  badge: version },
  ]

  return (
    <>
      <div
        className="rounded-[18px] overflow-hidden mb-3"
        style={GRADIENT_BORDER_STYLE_FULL}
      >
        {items.map(({ Icon, label, badge, onClick }, idx, arr) => (
          <button
            key={label}
            onClick={onClick}
            className={cn(
              'w-full flex items-center px-[18px] py-[14px] bg-transparent active:bg-[#F8F7F5] transition-colors',
              idx < arr.length - 1 && 'border-b border-[rgba(168,153,144,0.14)]',
            )}
          >
            <Icon size={18} color="#6B5B52" />
            <span className="flex-1 text-left text-[14px] text-v2-text-primary ml-3">{label}</span>
            {badge && (
              <span className="text-[12px] text-v2-text-muted mr-1.5">{badge}</span>
            )}
            <ChevronRight size={15} color="#C8BCB2" />
          </button>
        ))}
      </div>
      <FeedbackPopup open={feedbackOpen} onClose={() => setFeedbackOpen(false)} source="profile" />
    </>
  )
}
