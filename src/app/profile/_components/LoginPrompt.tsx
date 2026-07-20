/**
 * @module   LoginPrompt
 * @desc     未登录引导卡 — 软引导用户登录；文案可被 props 覆盖（用于试用墙等场景）
 * @author   LingoBridge
 * @created  2026-06-03
 */
'use client'
import { type JSX } from 'react'
import { useRouter } from 'next/navigation'
import { GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface LoginPromptProps {
  className?: string
  title?: string
  subtitle?: string
  titleAs?: 'p' | 'h1'
}

/**
 * 未登录时展示的引导卡
 * @param className  附加 class（如外部间距）
 * @param title      自定义主文案；默认「登录后保存你的故事与练习进度」
 * @param subtitle   自定义副文案；默认「匿名记录会在登录后自动同步，一条都不会丢」
 * @param titleAs    主文案渲染标签，默认 'p'。仅当本卡是整页唯一内容（试用墙整页阻断）时传 'h1'——
 *                   此时页面自身的 h1（ManageHeader）不会被渲染，不传就整页零 heading，读屏用户
 *                   的标题跳转会落空。在 /profile 里本卡只是页面的一个区块、页面另有 h1，必须保持
 *                   'p'，否则出现两个 h1。字号样式与标签无关，两种取值视觉逐像素一致。
 * @sideEffect       点击按钮跳转 /login
 */
export default function LoginPrompt({
  className,
  title = '登录后保存你的故事与练习进度',
  subtitle = '匿名记录会在登录后自动同步，一条都不会丢',
  titleAs = 'p',
}: LoginPromptProps): JSX.Element {
  const router = useRouter()
  const TitleTag = titleAs

  return (
    <div
      className={cn('rounded-[16px] px-[18px] py-5', className)}
      style={GRADIENT_BORDER_STYLE_FULL}
    >
      <div className="flex flex-col items-center">
        <TitleTag className="text-[14px] font-medium text-v2-text-primary text-center">
          {title}
        </TitleTag>
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
