/**
 * @module   ProfileViewTypes
 * @desc     「我的」两套 UI（移动/桌面）共享的账号 props —— 由 page.tsx 统一加载后下发
 * @author   LingoBridge
 * @created  2026-07-04
 */
export interface ProfileViewProps {
  loggedIn: boolean
  /** 匿名会话（已建匿名 user、尚未注册）：与「完全无 session」区分，用于给匿名态渲染只读试用额度卡 */
  isAnon: boolean
  email: string | null
  joinDays: number | null
  onLogout: () => void
}
