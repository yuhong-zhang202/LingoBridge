import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'LingoBridge',
  description: '把你的故事变成雅思口语素材',
  manifest: '/manifest.json',
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
  maximumScale: 1,
  userScalable: false,
  themeColor: '#F8F5F1',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh">
      <body className="bg-bg-page">
        <div className="h-dvh w-full flex justify-center bg-bg-page overflow-hidden">
          <div
            id="app-root-container"
            className="relative w-full max-w-[430px] h-dvh bg-bg-page overflow-y-auto"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {children}
          </div>
        </div>
      </body>
    </html>
  )
}
