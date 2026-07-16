/**
 * @module   FeatureListCardMobile
 * @desc     「我的」功能列表卡 — 两态均显示的底部入口列表；「帮助与反馈」接入 FeedbackPopup（source=profile），
 *           「关于 LingoBridge」导航到 /about
 * @author   LingoBridge
 * @created  2026-06-04
 */
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MessageCircleQuestionMark, Info, ChevronRight } from 'lucide-react'
import { GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'
import { cn } from '@/lib/utils'
import FeedbackPopup from '@/components/FeedbackPopup'

interface FeatureListCardProps {
  version: string
}

/** 行样式与行内容沿用原实现，Link 行与 button 行共用 */
const ROW_CLASS = 'w-full flex items-center px-[18px] py-[14px] bg-transparent active:bg-cream-soft transition-colors'

function RowBody({ Icon, label, badge }: { Icon: typeof Info; label: string; badge: string | null }): JSX.Element {
  return (
    <>
      <Icon size={18} color="#6B5B52" />
      <span className="flex-1 text-left text-[14px] text-v2-text-primary ml-3">{label}</span>
      {badge && <span className="text-[12px] text-v2-text-muted mr-1.5">{badge}</span>}
      <ChevronRight size={15} color="#C8BCB2" />
    </>
  )
}

/**
 * 功能入口列表卡，登录/未登录态均显示
 * @param version 应用版本号（占位常量）
 */
export default function FeatureListCard({ version }: FeatureListCardProps): JSX.Element {
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  return (
    <>
      <div
        className="rounded-[18px] overflow-hidden mb-3"
        style={GRADIENT_BORDER_STYLE_FULL}
      >
        <button
          onClick={() => setFeedbackOpen(true)}
          className={cn(ROW_CLASS, 'border-b border-[rgba(168,153,144,0.14)]')}
        >
          <RowBody Icon={MessageCircleQuestionMark} label="帮助与反馈" badge={null} />
        </button>
        {/* 导航语义：内容页跳转用 Link */}
        <Link href="/about" className={ROW_CLASS}>
          <RowBody Icon={Info} label="关于 LingoBridge" badge={version} />
        </Link>
      </div>
      <FeedbackPopup open={feedbackOpen} onClose={() => setFeedbackOpen(false)} source="profile" />
    </>
  )
}
