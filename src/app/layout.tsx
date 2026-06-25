import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import SwUpdatePrompt from '@/components/SwUpdatePrompt'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jakarta',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'LingoBridge',
  description: '把你的故事变成雅思口语素材',
  manifest: '/manifest.json',
  icons: {
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'LingoBridge',
  },
  // W3C 标准标签，与 apple- 标签并存消除浏览器 deprecation 警告
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F8F5F1',
  viewportFit: 'cover',   // 让 env(safe-area-inset-*) 在 iOS standalone 下生效
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh" className={jakarta.variable}>
      <body className="bg-bg-page">
        <div className="h-dvh w-full flex justify-center bg-bg-page overflow-hidden">
          <div
            id="app-root-container"
            className="relative w-full max-w-[430px] lg:max-w-none h-dvh bg-bg-page overflow-y-auto"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {children}
          </div>
        </div>
        <SwUpdatePrompt />
      </body>
    </html>
  )
}
