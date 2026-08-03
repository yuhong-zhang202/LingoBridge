import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import SwUpdatePrompt from '@/components/SwUpdatePrompt'
import UpdateBanner from '@/components/UpdateBanner'
import StandaloneZoomFix from '@/components/StandaloneZoomFix'
import { QaBadge } from '@/components/QaBadge'
import PageViewTracker from '@/components/PageViewTracker'
import { NavProvider, NavProgress } from '@/components/NavProgress'
import { SELF_HEAL_CHUNK_SCRIPT } from './self-heal-chunk'
import { FONT_SCALE_INIT_SCRIPT } from './font-scale-init'

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
      <head>
        {/* 预连 Supabase：浏览器提前建好 DNS+TCP+TLS，省掉客户端直连 Supabase（注册/登录/会话读取）
            首次调用的握手时延。仅助「浏览器→Supabase」，不影响服务端插库。 */}
        {process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <>
            <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_SUPABASE_URL} />
          </>
        )}
        {/* chunk 加载失败自愈：同步内联、在 React/框架 chunk 之前执行，兜住 error.tsx 挂载前的资源 404。
            内含 sessionStorage 一次性闸防死循环，详见 self-heal-chunk.ts。 */}
        <script dangerouslySetInnerHTML={{ __html: SELF_HEAL_CHUNK_SCRIPT }} />
        {/* 全局字体档：React 前同步读 localStorage 写 --fs-scale，首屏字号一步到位、零 FOUC。
            见 font-scale-init.ts；档值常量与设置页在 lib/fontScale.ts。 */}
        <script dangerouslySetInnerHTML={{ __html: FONT_SCALE_INIT_SCRIPT }} />
      </head>
      <body className="bg-bg-page">
        {/* NavProvider 全站单例：暴露 navigate()/isNavigating；NavProgress 顶部进度条与 children 同级、
            由 useTransition 在点击瞬间点亮（参照 SwUpdatePrompt 的 body 内挂法）。 */}
        <NavProvider>
          <NavProgress />
          <div className="h-dvh w-full flex justify-center bg-bg-page overflow-hidden">
            <div
              id="app-root-container"
              className="relative w-full max-w-[430px] lg:max-w-none h-dvh bg-bg-page overflow-y-auto"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {children}
            </div>
          </div>
        </NavProvider>
        <SwUpdatePrompt />
        <UpdateBanner />
        {/* 修 iOS standalone 输入框自动放大残留（真机取证:登录框15px→scale=1.066） */}
        <StandaloneZoomFix />
        {/* QA 流量标记：挂载时按 ?qa= 同步标记，带标记时右下角显示「QA」角标（真实用户看不到）。
            放根布局 = 任意页面带 ?qa=<token> 进入都生效、?qa=0 任意页面都能关。 */}
        <QaBadge />
        {/* page.view 埋点：路由变化时报一条「进入了哪个页面」，渲染 null、无 DOM。
            只上报 route 枚举 code，绝不带 pathname 原文与 query（见组件顶注隐私段）。 */}
        <PageViewTracker />
      </body>
    </html>
  )
}
