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
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#F9F9F9',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh">
      <body className="bg-bg-page">
        <div className="min-h-screen w-full flex justify-center bg-bg-page">
          <div id="app-root-container" className="relative w-full max-w-[430px] min-h-screen bg-bg-page overflow-hidden">
            {children}
          </div>
        </div>
      </body>
    </html>
  )
}
