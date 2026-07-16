/**
 * @module   dashboard/layout
 * @desc     dashboard 局部 layout — 覆盖根 layout 的 430px 手机容器，让看板页撑满浏览器全宽
 * @author   LingoBridge
 * @created  2026-06-04
 */

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-bg-page" style={{ position: 'fixed', inset: 0, overflowY: 'auto', zIndex: 9999 }}>
      {children}
    </div>
  )
}
