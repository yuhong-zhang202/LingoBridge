/**
 * @module   TopNav
 * @desc     首页桌面顶部横向导航 —— logo + 首页/题库/素材库/我的 + 通知/头像。
 *           仅首页使用（其它页仍用 TabBar 侧栏/底栏）；中间链接在 md 以下隐藏，移动端靠底部 TabBar 导航。
 * @author   LingoBridge
 * @created  2026-06-30
 */
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Mic, Bell, User } from 'lucide-react'

const NAV = [
  { href: '/',              label: '首页' },
  { href: '/question-bank', label: '题库' },
  { href: '/library',       label: '素材库' },
  { href: '/profile',       label: '我的' },
]

export default function TopNav() {
  const path = usePathname()
  return (
    <header className="sticky top-0 z-30 bg-bg-page border-b border-black/[0.045]">
      <div className="max-w-[1080px] mx-auto px-5 lg:px-14 h-[64px] lg:h-[72px] flex items-center gap-10">
        {/* 品牌 */}
        <Link href="/" className="flex items-center gap-3 flex-shrink-0">
          <span className="w-10 h-10 rounded-[11px] bg-brand-primary grid place-items-center text-white">
            <Mic size={20} />
          </span>
          <span className="text-[19px] font-bold tracking-tight text-v2-text-primary">LingoBridge</span>
        </Link>

        {/* 中间导航（md 以下隐藏，移动端用底部 TabBar） */}
        <nav className="hidden md:flex items-center gap-1.5">
          {NAV.map(({ href, label }) => {
            const active = href === '/' ? path === '/' : path.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={`text-[15px] px-4 py-[7px] rounded-full transition-colors ${
                  active
                    ? 'bg-bg-muted text-v2-text-primary font-semibold'
                    : 'text-v2-text-secondary font-medium hover:text-v2-text-primary'
                }`}
              >
                {label}
              </Link>
            )
          })}
        </nav>

        {/* 右侧：通知 + 头像 */}
        <div className="ml-auto flex items-center gap-[18px]">
          <button aria-label="通知" className="w-10 h-10 rounded-full grid place-items-center text-v2-text-secondary hover:bg-bg-muted transition-colors">
            <Bell size={20} />
          </button>
          <Link href="/profile" aria-label="我的" className="w-10 h-10 rounded-full bg-brand-accent grid place-items-center text-white">
            <User size={18} />
          </Link>
        </div>
      </div>
    </header>
  )
}
