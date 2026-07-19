import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import SwUpdatePrompt from '@/components/SwUpdatePrompt'
import UpdateBanner from '@/components/UpdateBanner'
import VpDebugOverlay from '@/components/VpDebugOverlay'

// 自托管 Plus Jakarta Sans（woff2 取自 @fontsource/plus-jakarta-sans，见 fonts/README.md），
// 改用 next/font/local 消除构建期访问 Google Fonts 的外网依赖；仍保留 subset(latin)/display:swap，
// 且 next/font/local 默认 adjustFontFallback:'Arial' 生成 size-adjust 回退，CLS 防护不变。
const jakarta = localFont({
  src: [
    { path: './fonts/plus-jakarta-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/plus-jakarta-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/plus-jakarta-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/plus-jakarta-sans-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
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
  themeColor: '#FBFAF7',
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
        <UpdateBanner />
        {/* 【临时诊断·取证完即删】iOS standalone 误缩放取证浮层 */}
        <VpDebugOverlay />
      </body>
    </html>
  )
}
