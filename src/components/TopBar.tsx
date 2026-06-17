'use client'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { ReactNode } from 'react'
import FeedbackButton from '@/components/FeedbackButton'

interface TopBarProps {
  title?: string
  showBack?: boolean
  right?: ReactNode
}

export default function TopBar({
  title,
  showBack = true,
  right,
}: TopBarProps) {
  const router = useRouter()
  return (
    <div className="relative flex items-center justify-between h-[52px] px-5 bg-bg-page sticky top-0 z-30">
      <div className="flex items-center">
        {showBack && (
          <button
            onClick={() => router.back()}
            aria-label="返回"
            className="w-[30px] h-[30px] rounded-full bg-white flex items-center justify-center shadow-sm"
          >
            <ChevronLeft size={15} className="text-v2-text-primary" />
          </button>
        )}
      </div>
      {title && (
        <span className="absolute left-1/2 -translate-x-1/2 text-[16px] font-semibold text-v2-text-primary pointer-events-none">
          {title}
        </span>
      )}
      <div className="flex items-center gap-2 justify-end">
        {right}
        <FeedbackButton />
      </div>
    </div>
  )
}
