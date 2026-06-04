/**
 * @module   dashboard/layout
 * @desc     dashboard 局部 layout — 覆盖根 layout 的 430px 手机容器，让看板页撑满浏览器全宽
 * @author   LingoBridge
 * @created  2026-06-04
 */

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', background: '#F5F2EE', zIndex: 9999 }}>
      {children}
    </div>
  )
}
