/**
 * @module   ProfileViewTypes
 * @desc     「我的」两套 UI（移动/桌面）共享的账号 props —— 由 page.tsx 统一加载后下发
 * @author   LingoBridge
 * @created  2026-07-04
 */
export interface ProfileViewProps {
  loggedIn: boolean
  email: string | null
  joinDays: number | null
  bookmarkCount: number
  onLogout: () => void
}
