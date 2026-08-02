/**
 * @module   DesktopBackLink
 * @desc     桌面端专用「← 返回」出口 —— 补 TopBar 返回键 lg:hidden 之后、既不挂 TopNav 也不挂 TabBar
 *           的页面在桌面上没有任何出口（只能按浏览器后退）的死胡同。做法沿用 /settings 的既有先例
 *           （commit bfc87bb）：内容区左上角 ChevronLeft + 13px 次要文本。
 *
 *           【移动端零改动的结构性保证】根元素常驻 `hidden lg:inline-flex`：lg 以下 display:none，
 *           不生成盒子、不吃任何间距，移动端与加它之前逐像素一致；返回能力在移动端本就由 TopBar 的
 *           返回键提供，两端不会出现双份返回。
 *
 *           【两种去向，调用方二选一（TS 联合类型强制）】
 *           - `fallback`：走 router.back()，仅在没有可回退历史时才 push 兜底路由。用于入口不唯一的页面
 *             （沿用 settings 的判断：有多个上级就别写死一个）。back() 在直接粘贴 URL / 新标签页打开时
 *             是空操作，故必须带兜底，否则「返回键点了没反应」是另一种死胡同。
 *           - `to`：无条件 push 指定路由。用于「上一页」本身无意义的页面（如从邮件链接进入的重置密码）。
 * @author   LingoBridge
 * @created  2026-07-20
 */
'use client'
import { type JSX } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

type DesktopBackLinkProps = {
  /** 按钮文案，默认「返回」 */
  label?: string
} & (
  | {
      /** 回退兜底路由：history 里没有上一页时 push 它 */
      fallback: string
      to?: never
    }
  | {
      /** 固定去向：无条件 push，不看历史栈 */
      to: string
      fallback?: never
    }
)

// 不解构 props：解构会切断联合类型的收窄关联（to / fallback 变成两个独立变量，
// TS 无法再由「to 为 undefined」推出「fallback 必为 string」），只能靠断言补，故整体传递 props。
export default function DesktopBackLink(props: DesktopBackLinkProps): JSX.Element {
  const router = useRouter()
  const label = props.label ?? '返回'

  /** 有 to 则固定去向；否则优先回退历史，历史为空（直接打开链接）时 push 兜底路由 */
  const handleClick = (): void => {
    if (props.to !== undefined) {
      router.push(props.to)
      return
    }
    // history.length 在同标签页内是累计长度；为 1 表示本页就是该标签页的第一条记录，back() 会无效。
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push(props.fallback)
  }

  // self-start：本组件可能落在 flex-col 容器里（如 practice-question 的滚动区），列向 flex 默认
  // align-items:stretch 会把按钮拉成整行宽、点击区过大；self-start 让它收回内容宽。
  // 在普通 block 容器（privacy / reset-password）里该类名不生效，属无副作用的兜底。
  return (
    <button
      type="button"
      onClick={handleClick}
      className="hidden lg:inline-flex self-start items-center gap-1 -ml-1 mb-4 text-[0.8125rem] text-v2-text-secondary hover:text-v2-text-primary transition-colors"
    >
      <ChevronLeft size={16} />
      {label}
    </button>
  )
}
