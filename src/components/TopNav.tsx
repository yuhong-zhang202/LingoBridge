/**
 * @module   TopNav
 * @desc     桌面顶部横向导航 —— logo + 首页/题库/素材库/我的 + 通知/头像。
 *           首页与三个管理页（题库/素材库/我的）共用；中间链接在 md 以下隐藏，移动端靠底部 TabBar 导航。
 *           containerClassName 控制内栏宽度/边距，使顶栏与各页内容容器左右对齐。
 * @author   LingoBridge
 * @created  2026-06-30
 */
'use client'
import ProgressLink from '@/components/ProgressLink'
import { usePathname } from 'next/navigation'
import { Mic } from 'lucide-react'
import Avatar from '@/components/Avatar'
import NotificationBell from '@/components/NotificationBell'
import { useAccount } from '@/hooks/useAccount'
import { PAGE_CONTAINER, TOPNAV_H_DESKTOP_CLASS } from '@/lib/constants'

const NAV = [
  { href: '/',              label: '首页' },
  { href: '/question-bank', label: '题库' },
  { href: '/library',       label: '素材库' },
  { href: '/profile',       label: '我的' },
]

interface TopNavProps {
  /** 内栏容器 class，默认走全站统一容器 PAGE_CONTAINER，使顶栏内栏与各页内容左右对齐 */
  containerClassName?: string
}

export default function TopNav({ containerClassName = PAGE_CONTAINER }: TopNavProps) {
  const path = usePathname()
  // 账号态经 useAccount 订阅：上传头像/登录/登出后自动刷新，无需手动通知
  const { account } = useAccount()
  // 头像回退首字母：登录用户取邮箱首字母，未登录/匿名回退「我」（与「我的」语义一致）
  const initial = account && !account.isAnonymous && account.email
    ? account.email[0]!.toUpperCase()
    : '我'
  return (
    <header className="sticky top-0 z-30 bg-bg-page border-b border-black/[0.045]">
      <div className={`${containerClassName} h-[64px] ${TOPNAV_H_DESKTOP_CLASS} flex items-center gap-10`}>
        {/* 品牌 */}
        <ProgressLink href="/" className="flex items-center gap-3 flex-shrink-0">
          <span className="w-10 h-10 rounded-[11px] bg-brand-primary grid place-items-center text-white">
            <Mic size={20} />
          </span>
          <span className="text-[1.1875rem] font-bold tracking-tight text-v2-text-primary">LingoBridge</span>
        </ProgressLink>

        {/* 中间导航（md 以下隐藏，移动端用底部 TabBar） */}
        <nav className="hidden md:flex items-center gap-1.5">
          {NAV.map(({ href, label }) => {
            const active = href === '/' ? path === '/' : path.startsWith(href)
            return (
              <ProgressLink
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`text-[0.9375rem] px-4 py-[7px] rounded-full transition-colors ${
                  active
                    ? 'bg-bg-muted text-v2-text-primary font-semibold'
                    : 'text-v2-text-secondary font-medium hover:text-v2-text-primary'
                }`}
              >
                {label}
              </ProgressLink>
            )
          })}
        </nav>

        {/* 右侧：通知 + 头像（反馈入口不走导航栏——各页在情境处自带：管理页 ManageHeader、流程页 FlowShell、我的页内卡） */}
        <div className="ml-auto flex items-center gap-[18px]">
          <NotificationBell />
          <ProgressLink href="/profile" aria-label="我的" className="w-10 h-10 rounded-full bg-brand-accent-dark grid place-items-center text-white text-[0.9375rem] font-semibold overflow-hidden">
            <Avatar avatarUrl={account?.avatarUrl} size={40} fallback={initial} />
          </ProgressLink>
        </div>
      </div>
    </header>
  )
}
