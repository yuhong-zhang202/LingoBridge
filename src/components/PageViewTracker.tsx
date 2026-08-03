/**
 * @module   PageViewTracker
 * @desc     page.view 埋点的挂载点（挂在根布局，全站一个实例）：路由变化时上报一条「进入了哪个页面」。
 *           渲染 null，不产生任何 DOM、不影响布局。
 *
 *   ⚠️【全站唯一一个「每次导航都必然发一条」的埋点，所以这里刻意极简】本组件只做：读 pathname →
 *     查一张常量表 → 与上一次比一下 → track()。**不许**在这里加任何异步、计时器、监听器、
 *     storage 读写或状态：它跑在每一次页面切换上，这里加什么都会被乘以「全站导航次数」。
 *
 *   🔴【隐私】只上报 toPageRoute() 产出的枚举 code。刻意**不用 useSearchParams()**：
 *     一是 query 里有 `?h=`（handoff key，可反查用户原文），碰都不该碰；
 *     二是 useSearchParams 会让整棵树退出静态渲染（需 Suspense 包裹），而 usePathname 不会。
 *
 *   【去重：本组件的核心】三种重复都要挡住，靠的是「模块级 lastRoute + 只依赖 pathname 的 effect」：
 *     ① React StrictMode 的双挂载（dev 下 effect 跑两遍）→ 第二遍 route 与 lastRoute 相同，跳过；
 *     ② 父组件 state 变化导致的重渲染 → effect 依赖数组只有 pathname，pathname 没变就不重跑；
 *     ③ 同一 pathname 上 query 变了（如 /matching?qid=… 换题）→ pathname 未变、effect 不重跑，
 *        即便重跑也会被 lastRoute 挡下。
 *     **用模块级变量而不是 useRef**：useRef 的值只活在组件实例里，一旦组件被卸载重挂
 *     （StrictMode 的 remount、错误边界重置、未来有人给布局加 key），ref 就回到初始值、去重失效；
 *     模块级变量只随整页加载重置，而整页加载本来就该重新记一条。
 *
 *   【口径提醒 ①：去重只在「一个页面实例内」成立】lastRoute 是模块级变量，作用域 = 一个标签页的
 *     一次整页加载。所以下面两种「同一 route 连续两条」是**预期结果、不是去重失效**：
 *       · 整页刷新后停在同一页 → 新的一次加载，本就该重新记一条；
 *       · 同一用户开着两个标签页 → 各有一份 lastRoute，各记各的。
 *     ⇒ **page.view 是「页面加载次数」，不是「有多少人看过这页」**；多标签用户会被重复计入。
 *     需要人数口径时按 user_id 去重，别直接数行数。
 *     2026-08-03 实测：生产模式与 dev 模式各跑一遍「dashboard → home → dashboard → home」，
 *     两边都恰好 4 条且交替出现，去重本身工作正常；当天数据里的重复经 flow_id
 *     （存 sessionStorage、按标签页隔离）确认来自两个标签页。
 *
 *   【口径提醒 ②】track() 在拿不到 session 时静默不发（见 client-events.track），
 *     而全新访客落在首页时往往还没有 session ⇒ **首页的 page.view 系统性偏低，别当首页 UV 用**。
 *     刻意不为此加重试/等待 session：那会把「每次导航都跑」的路径变成有状态的异步逻辑，
 *     代价远大于补回那几条；需要首页 UV 时另用服务端口径。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { track } from '@/lib/client-events'
import { toPageRoute } from '@/lib/page-route'

/**
 * 上一条已上报的 route（模块级，理由见文件顶注的「去重」段）。
 * null = 本次整页加载还没报过。
 */
let lastRoute: string | null = null

/**
 * 路由变化时上报一条 page.view。
 * @returns    null（不渲染任何 DOM）
 * @sideEffect 路由变化且与上次不同时 POST /api/events（fire-and-forget，失败静默）
 */
export default function PageViewTracker(): null {
  const pathname = usePathname()
  useEffect(() => {
    const route = toPageRoute(pathname)
    // 与上次相同即跳过：连续两次落在同一枚举（含两个不同的未登记页都算 'other'）只记一条。
    // 宁可少记这种极少数情况，也不要放开去重、让 StrictMode 与重渲染的重复计数进库。
    if (route === lastRoute) return
    lastRoute = route
    track('page.view', { route })
  }, [pathname])
  return null
}
