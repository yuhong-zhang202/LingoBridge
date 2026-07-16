'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Library, BookOpen, User, Settings, Sparkles, ArrowLeft, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StepName } from './primitives'
import { StepBar } from './primitives'

const NAV = [
  { href: '/', label: '首页', icon: Home },
  { href: '/question-bank', label: '当季题库', icon: BookOpen },
  { href: '/library', label: '素材库', icon: Library },
  { href: '/profile', label: '我的', icon: User },
]

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="relative grid size-9 place-items-center rounded-[12px] grad-border bg-surface">
        <span className="size-4 rounded-full bg-gradient-to-br from-brand to-teal" />
      </span>
      <span className="text-[17px] font-bold tracking-tight text-ink">LingoBridge</span>
    </Link>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface/70 px-4 py-6 backdrop-blur-sm lg:flex">
      <div className="px-2">
        <Logo />
      </div>

      <nav className="mt-10 flex flex-col gap-1">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink3">导航</p>
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-sm font-medium transition-colors',
                active ? 'bg-fill text-ink' : 'text-ink2 hover:bg-fill/60 hover:text-ink',
              )}
            >
              <Icon className={cn('size-[18px]', active && 'text-brand')} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2">
        <div className="grad-border rounded-[16px] bg-surface p-4 shadow-card">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <Sparkles className="size-4 text-teal" />
            本周连续 5 天
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink2">
            慢慢来，你已经讲出 12 个属于自己的故事了。
          </p>
        </div>
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-sm font-medium transition-colors',
            pathname.startsWith('/settings') ? 'bg-fill text-ink' : 'text-ink2 hover:bg-fill/60 hover:text-ink',
          )}
        >
          <Settings className="size-[18px]" />
          设置
        </Link>
      </div>
    </aside>
  )
}

interface AppShellProps {
  children: ReactNode
  /** page title shown in the top bar */
  title?: string
  /** optional right-side content in the top bar */
  action?: ReactNode
  /** ambient light glow at top (home/open pages) */
  ambient?: boolean
}

export function AppShell({ children, title, action, ambient = false }: AppShellProps) {
  return (
    <div className="min-h-svh bg-page">
      <Sidebar />
      <div className="lg:pl-64">
        {ambient && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-80 ambient-light" aria-hidden="true" />
        )}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-page/80 px-6 backdrop-blur-md lg:px-10">
          <h1 className="text-[17px] font-bold text-ink lg:text-lg">{title}</h1>
          <div className="flex items-center gap-3">{action}</div>
        </header>
        <main className="relative px-6 py-8 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  )
}

/** Top bar for linear-flow pages: back link, title, StepBar, optional close. */
export function FlowTopBar({
  title,
  backHref,
  step,
  closeHref,
}: {
  title: string
  backHref?: string
  step?: StepName
  closeHref?: string
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-page/80 px-6 py-3 backdrop-blur-md lg:px-10">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {backHref && (
            <Link
              href={backHref}
              className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-surface text-ink2 transition-colors hover:text-ink"
              aria-label="返回"
            >
              <ArrowLeft className="size-[18px]" />
            </Link>
          )}
          <span className="truncate text-[15px] font-bold text-ink">{title}</span>
        </div>
        {step && (
          <div className="hidden md:block">
            <StepBar current={step} />
          </div>
        )}
        {closeHref && (
          <Link
            href={closeHref}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-surface text-ink2 transition-colors hover:text-ink"
            aria-label="退出"
          >
            <X className="size-[18px]" />
          </Link>
        )}
      </div>
    </header>
  )
}

/** Minimal shell for immersive flow pages (recording / practice) — no main nav. */
export function FlowShell({
  children,
  ambient = true,
}: {
  children: ReactNode
  ambient?: boolean
}) {
  return (
    <div className="relative min-h-svh bg-page">
      {ambient && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] ambient-light" aria-hidden="true" />
      )}
      {children}
    </div>
  )
}
