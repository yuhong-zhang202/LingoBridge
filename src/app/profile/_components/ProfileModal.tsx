/**
 * @module   ProfileModal
 * @desc     「我的」页弹窗统一外壳 — 半透明遮罩 + 居中 Card + 标题行 + 关闭按钮；点击遮罩关闭
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import Card from '@/components/Card'
import { cn } from '@/lib/utils'

interface ProfileModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** 宽度约束 class，默认 max-w-[380px] */
  className?: string
}

/**
 * 弹窗外壳
 * @param title     弹窗标题
 * @param onClose   关闭回调（遮罩点击 / 关闭按钮）
 * @param children  弹窗主体内容
 * @param className 宽度约束 class
 */
export default function ProfileModal({ title, onClose, children, className }: ProfileModalProps): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div className={cn('w-full', className ?? 'max-w-[380px]')} onClick={(e) => e.stopPropagation()}>
        <Card className="px-6 pt-5 pb-6 animate-fade-up">
          <div className="flex items-center justify-between mb-5">
            <span className="text-[15px] font-semibold text-v2-text-primary">{title}</span>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="text-v2-text-muted hover:text-v2-text-primary transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          {children}
        </Card>
      </div>
    </div>
  )
}
