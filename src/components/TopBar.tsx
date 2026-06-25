'use client'
import { useRouter } from 'next/navigation'
import { ChevronLeft, WifiOff } from 'lucide-react'
import { ReactNode } from 'react'
import FeedbackButton from '@/components/FeedbackButton'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'

interface TopBarProps {
  title?: string
  showBack?: boolean
  right?: ReactNode
  showFeedback?: boolean
}

export default function TopBar({
  title,
  showBack = true,
  right,
  showFeedback = true,
}: TopBarProps) {
  const router = useRouter()
  const isOnline = useOnlineStatus()
  return (
    <div
      className="bg-bg-page sticky top-0 z-30 lg:bg-bg-page/80 lg:backdrop-blur-md lg:border-b lg:border-black/[0.06]"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* 离线状态条：仅离线时出现，把下方内容自然下推；在线态高度与原先完全一致 */}
      {!isOnline && (
        <div className="flex items-center justify-center gap-1.5 py-2 bg-warning/15 text-warning">
          <WifiOff size={14} />
          <span className="text-[12.5px] font-medium">你已离线，部分功能暂不可用</span>
        </div>
      )}

      {/* 标题行：移动端 52px 居中标题（原样）；lg 变 64px 左对齐标题，返回按钮在桌面隐藏（侧栏即导航）。 */}
      <div className="relative flex items-center justify-between px-5 lg:!h-16 lg:px-10" style={{ height: '52px' }}>
        <div className="flex items-center">
          {showBack && (
            <button
              onClick={() => router.back()}
              aria-label="返回"
              className="w-[30px] h-[30px] rounded-full bg-white flex items-center justify-center shadow-sm lg:hidden"
            >
              <ChevronLeft size={15} className="text-v2-text-primary" />
            </button>
          )}
        </div>
        {title && (
          <span className="absolute left-1/2 -translate-x-1/2 text-[16px] font-semibold text-v2-text-primary pointer-events-none lg:left-10 lg:translate-x-0 lg:text-[18px] lg:font-bold">
            {title}
          </span>
        )}
        <div className="flex items-center gap-2 justify-end">
          {right}
          {showFeedback && <FeedbackButton />}
        </div>
      </div>
    </div>
  )
}
