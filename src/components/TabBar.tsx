'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, BookOpen, BookMarked, User, Settings } from 'lucide-react'

const TABS = [
  { href: '/',               label: '首页',  Icon: Home       },
  { href: '/question-bank',  label: '题库',  Icon: BookOpen   },
  { href: '/library',        label: '素材库', Icon: BookMarked },
  { href: '/profile',        label: '我的',  Icon: User       },
]

export default function TabBar() {
  const path = usePathname()
  const settingsActive = path === '/settings' || path.startsWith('/settings')
  return (
    <div
      // 移动端：底部横向 TabBar（原样不动）。lg：左侧 256px 竖向 sidebar（对齐 web.html app-shell）。
      // 内联 height/paddingBottom 不动；lg 用 !important 覆盖，移动端像素级不变。
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-bg-page border-t border-black/[0.06] flex items-center justify-around z-30
        lg:top-0 lg:bottom-auto lg:left-0 lg:translate-x-0 lg:w-[256px] lg:max-w-none lg:!h-dvh lg:!pb-0 lg:flex-col lg:items-stretch lg:justify-start lg:gap-1 lg:px-4 lg:py-6 lg:border-t-0 lg:border-r"
      style={{
        height: 'calc(56px + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Logo —— 仅桌面端 sidebar 顶部（品牌标记 + 字标，token 实色，无内联色值/渐变填充） */}
      <Link href="/" className="hidden lg:flex lg:items-center lg:gap-2.5 lg:px-2 lg:mb-8">
        <span className="grid size-9 place-items-center rounded-[12px] bg-bg-muted">
          <span className="size-4 rounded-full bg-brand-primary" />
        </span>
        <span className="text-[17px] font-bold tracking-tight text-v2-text-primary">LingoBridge</span>
      </Link>

      {/* 导航分区标签 —— 仅桌面端 */}
      <p className="hidden lg:block lg:px-3 lg:pb-2 text-[11px] font-semibold uppercase tracking-wider text-v2-text-muted">导航</p>

      {TABS.map(({ href, label, Icon }) => {
        const active = path === href
          || (href === '/question-bank' && path.startsWith('/question-bank'))
          || (href === '/library' && path.startsWith('/library'))
          || (href === '/profile' && path.startsWith('/profile'))
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center gap-[3px] py-2 px-4
              lg:flex-row lg:items-center lg:gap-3 lg:py-2.5 lg:px-3 lg:w-full lg:rounded-[12px] lg:transition-colors
              ${active ? 'lg:bg-bg-muted' : 'lg:hover:bg-bg-muted/60'}`}
          >
            <Icon
              size={20}
              className={active ? 'text-v2-text-primary lg:text-brand-primary' : 'text-text-4 lg:text-v2-text-secondary'}
            />
            <span className={`text-[10px] font-medium lg:text-[14px] ${
              active ? 'text-v2-text-primary' : 'text-text-4 lg:text-v2-text-secondary'
            }`}>
              {label}
            </span>
            {active && (
              <div className="w-[3px] h-[3px] rounded-full bg-surface-ink lg:hidden" />
            )}
          </Link>
        )
      })}

      {/* 设置 —— 仅桌面端 sidebar 底部 */}
      <Link
        href="/settings"
        className={`hidden lg:flex lg:flex-row lg:items-center lg:gap-3 lg:py-2.5 lg:px-3 lg:w-full lg:rounded-[12px] lg:mt-auto lg:transition-colors
          ${settingsActive ? 'lg:bg-bg-muted' : 'lg:hover:bg-bg-muted/60'}`}
      >
        <Settings size={20} className={settingsActive ? 'text-v2-text-primary lg:text-brand-primary' : 'text-text-4 lg:text-v2-text-secondary'} />
        <span className={`text-[14px] font-medium ${settingsActive ? 'text-v2-text-primary' : 'text-text-4 lg:text-v2-text-secondary'}`}>
          设置
        </span>
      </Link>
    </div>
  )
}
