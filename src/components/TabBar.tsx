'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, BookOpen, BookMarked, User } from 'lucide-react'

const TABS = [
  { href: '/',               label: '首页',  Icon: Home       },
  { href: '/question-bank',  label: '题库',  Icon: BookOpen   },
  { href: '/library',        label: '素材库', Icon: BookMarked },
  { href: '/profile',        label: '我的',  Icon: User       },
]

export default function TabBar() {
  const path = usePathname()
  return (
    <div
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-bg-page border-t border-black/[0.06] flex items-center justify-around z-30"
      style={{
        height: 56,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = path === href
          || (href === '/question-bank' && path.startsWith('/question-bank'))
          || (href === '/library' && path.startsWith('/library'))
          || (href === '/profile' && path.startsWith('/profile'))
        return (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-[3px] py-2 px-4"
          >
            <Icon
              size={20}
              className={active ? 'text-v2-text-primary' : 'text-text-4'}
            />
            <span className={`text-[10px] font-medium ${
              active ? 'text-v2-text-primary' : 'text-text-4'
            }`}>
              {label}
            </span>
            {active && (
              <div className="w-[3px] h-[3px] rounded-full bg-[#111]" />
            )}
          </Link>
        )
      })}
    </div>
  )
}
