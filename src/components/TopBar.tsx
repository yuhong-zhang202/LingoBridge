'use client'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { ReactNode } from 'react'

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
    <div className="flex items-center justify-between h-[52px] px-5 bg-bg-page sticky top-0 z-30">
      <div className="w-[60px] flex items-center">
        {showBack && (
          <button
            onClick={() => router.back()}
            className="w-[30px] h-[30px] rounded-full bg-white flex items-center justify-center shadow-sm"
          >
            <ChevronLeft size={15} className="text-[#333]" />
          </button>
        )}
      </div>
      {title && (
        <span className="text-[16px] font-semibold text-[#111]">
          {title}
        </span>
      )}
      <div className="w-[60px] flex justify-end">
        {right}
      </div>
    </div>
  )
}
