'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, BookOpen, Target } from 'lucide-react'

const TABS = [
  { href: '/v2',         label: '首页',  Icon: Home     },
  { href: '/v2/library', label: '素材库', Icon: BookOpen },
  { href: '/v2/match',   label: '练习',  Icon: Target   },
]

export default function BottomNav() {
  const path = usePathname()
  return (
    <div
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-bg-surface border-t border-black/[0.06] flex items-center justify-around"
      style={{ height: 60, paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = path === href || (href !== '/v2' && path.startsWith(href))
        return (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-[3px] py-2 px-6"
          >
            <Icon size={22} className={active ? 'text-brand-primary' : 'text-[#BBBBBB]'} />
            <span className={`text-[10px] font-medium ${active ? 'text-brand-primary' : 'text-[#BBBBBB]'}`}>
              {label}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
