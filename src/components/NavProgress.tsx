/**
 * @module   NavProgress
 * @desc     全站路由进度反馈基础设施 —— 用 React useTransition 在「点击瞬间」就进入 pending，
 *           而非等跳转完成才亮（这是 nextjs-toploader 在 App Router 下的通病：patch history、
 *           导航完成才点亮，太晚）。三件套同处一文件：
 *             · NavProvider —— 全站单例，持有 useTransition，暴露 navigate()/isNavigating；
 *             · useNav()    —— 客户端组件取 { navigate, isNavigating }；
 *             · NavProgress —— 顶部细进度条，isNavigating 时爬到 90%、结束补满淡出，纯 CSS 动画无依赖。
 *           视觉条 aria-hidden（装饰），另配 sr-only 的 role=status live 区在跳转时播报「正在跳转…」，
 *           保证读屏用户可感知。
 * @author   LingoBridge
 * @created  2026-07-22
 */
'use client'
import { createContext, useCallback, useContext, useEffect, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { BRAND_GRADIENT, SLOW_HINT_MS } from '@/lib/constants'

interface NavContextValue {
  /** 程序化跳转：包在 startTransition 里，点击瞬间即置 isNavigating=true（顶部条立刻亮） */
  navigate: (href: string) => void
  /** 是否正在跳转（= useTransition 的 isPending），供顶部进度条与按钮反馈读取 */
  isNavigating: boolean
}

const NavContext = createContext<NavContextValue | null>(null)

/**
 * 全站导航单例 Provider：持有 useTransition，向下暴露 navigate/isNavigating。
 * @param  children  被包裹的整棵应用子树
 * @returns          Context.Provider 包裹的子树
 */
export function NavProvider({ children }: { children: ReactNode }): ReactNode {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // startTransition 内的 router.push 让本次导航成为「过渡」——点击当帧 isPending 立即为 true，
  // 无需等目标页 RSC 拉取完成。这正是相较 nextjs-toploader 的关键差异（后者跳转完成才亮）。
  const navigate = useCallback(
    (href: string): void => {
      startTransition(() => { router.push(href) })
    },
    [router],
  )

  return <NavContext.Provider value={{ navigate, isNavigating: isPending }}>{children}</NavContext.Provider>
}

/**
 * 客户端组件取用导航能力。
 * @returns  { navigate, isNavigating }
 * @sideEffect  必须在 NavProvider 内调用，否则抛错（避免静默拿到无效跳转）
 */
export function useNav(): NavContextValue {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error('useNav 必须在 NavProvider 内使用')
  return ctx
}

/**
 * 顶部路由进度条：读 isNavigating，为真时在屏幕顶部渲染一条细进度条，
 * 宽度从 10%→90% 缓爬（trickle），跳转结束补满 100% 后淡出。纯 CSS transition，无第三方依赖。
 * @returns  固定在视口顶部的进度条 DOM（idle 态不渲染视觉条，仅保留 sr-only 播报区）
 */
export function NavProgress(): ReactNode {
  const { isNavigating } = useNav()
  const [visible, setVisible] = useState(false)
  const [width, setWidth] = useState(0)
  // 跳转持续超 SLOW_HINT_MS 才亮的安抚文案（国内直连新加坡 Supabase 的高延迟场景），跳转一结束即撤
  const [slowHint, setSlowHint] = useState(false)

  useEffect(() => {
    if (isNavigating) {
      setVisible(true)
      // 先给一个非零起点触发 CSS width 过渡，再爬向 90%（长 duration ease-out 形成先快后慢的涓流感）
      setWidth(8)
      const t = window.setTimeout(() => setWidth(90), 60)
      return () => window.clearTimeout(t)
    }
    // 结束：仅当此前亮过才补满 + 淡出（避免首帧 idle 空跑一次淡出）
    if (visible) {
      setWidth(100)
      const t = window.setTimeout(() => { setVisible(false); setWidth(0) }, 260)
      return () => window.clearTimeout(t)
    }
    return undefined
    // visible 有意不入依赖：只由 isNavigating 边沿驱动状态机，纳入会在淡出后二次触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNavigating])

  // 慢跳转安抚文案：跳转持续超 SLOW_HINT_MS 才淡入，跳转一结束立即撤（与进度条状态机解耦，单独计时）
  useEffect(() => {
    if (!isNavigating) { setSlowHint(false); return undefined }
    const t = window.setTimeout(() => setSlowHint(true), SLOW_HINT_MS)
    return () => window.clearTimeout(t)
  }, [isNavigating])

  return (
    <>
      {/* 视觉条：纯装饰，移出无障碍树，播报交给下方 status 区 */}
      <div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[100] h-[3px]"
        style={{
          width: `${width}%`,
          background: BRAND_GRADIENT,
          opacity: visible ? 1 : 0,
          transition: isNavigating
            ? 'width 10s cubic-bezier(0.1, 0.9, 0.2, 1), opacity 0.3s ease-out'
            : 'width 0.2s ease-out, opacity 0.3s ease-out 0.1s',
        }}
      />
      {/* 读屏播报：跳转进行中告知「正在跳转…」，目标页加载后此文本清空 */}
      <span role="status" aria-live="polite" className="sr-only">
        {isNavigating ? '正在跳转…' : ''}
      </span>
      {/* 慢跳转安抚文案：视口中央淡入一行，只安抚不报错（真失败由各页 error 态承担）。
          与进度条同为装饰层（读屏播报已由上方 status 承担），故 aria-hidden 避免重复念读。 */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-1/2 z-[100] flex justify-center px-6 transition-opacity duration-300"
        style={{ opacity: slowHint ? 1 : 0 }}
      >
        <span className="rounded-full bg-white/95 px-4 py-2 text-[13px] text-v2-text-secondary shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-black/[0.05]">
          网络较慢，正在加载，请稍候…
        </span>
      </div>
    </>
  )
}
