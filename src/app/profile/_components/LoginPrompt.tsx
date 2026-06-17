/**
 * @module   LoginPrompt
 * @desc     未登录引导卡 — 软引导用户登录；文案可被 props 覆盖（用于试用墙等场景）
 * @author   LingoBridge
 * @created  2026-06-03
 */
'use client'
import { useRouter } from 'next/navigation'
import { GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface LoginPromptProps {
  className?: string
  title?: string
  subtitle?: string
}

/**
 * 未登录时展示的引导卡
 * @param className  附加 class（如外部间距）
 * @param title      自定义主文案；默认「登录后保存你的故事与练习进度」
 * @param subtitle   自定义副文案；默认「匿名记录会在登录后自动同步，一条都不会丢」
 * @sideEffect       点击按钮跳转 /login
 */
export default function LoginPrompt({
  className,
  title = '登录后保存你的故事与练习进度',
  subtitle = '匿名记录会在登录后自动同步，一条都不会丢',
}: LoginPromptProps): JSX.Element {
  const router = useRouter()

  return (
    <div
      className={cn('rounded-[18px] px-[18px] py-5', className)}
      style={GRADIENT_BORDER_STYLE_FULL}
    >
      <div className="flex flex-col items-center">
        <p className="text-[14px] font-medium text-v2-text-primary text-center">
          {title}
        </p>
        <p className="text-[12px] text-v2-text-secondary text-center mt-1.5">
          {subtitle}
        </p>
        <button
          onClick={() => router.push('/login')}
          className="btn-gradient px-6 py-2.5 rounded-full mt-4"
        >
          登录 / 创建账号
        </button>
      </div>
    </div>
  )
}
