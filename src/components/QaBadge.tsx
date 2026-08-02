/**
 * @module   QaBadge
 * @desc     QA 标记的挂载点（挂在根布局，全站一个实例），做两件事：
 *           ① 挂载时按当前 URL 的 `?qa=` 同步标记（写/清 localStorage）；
 *           ② 本机带标记时，右下角显示一个极小的灰字「QA」。
 *           存在理由：QA 标记本身是不可见状态，没有反馈就会出现「以为标了其实没标 / 以为关了其实还开着」，
 *           而这两种误判都会静默污染漏斗统计。角标是这个状态的唯一可见凭证。
 *
 *   真实用户永远看不到它（无标记 → 直接不渲染）。
 *   `pointer-events-none` + 低 z（低于所有弹层）保证它不拦任何点击、不遮任何浮层。
 *
 *   同步【只在挂载时做一次】：`?qa=` 一律靠手输/点链接进入，那是整页加载 → 根布局重新挂载，
 *   任意页面带参进入都生效、`?qa=0` 任意页面都能关。刻意不监听站内路由变化 ——
 *   站内导航不会凭空冒出 qa 参数，加监听只会多一份没人用的状态机。
 *
 * @author   LingoBridge
 * @created  2026-08-02
 */
'use client'
import { useEffect, useState } from 'react'
import { qaToken, syncQaFlagFromUrl } from '@/lib/qa-flag'

/**
 * QA 标记同步 + 流量角标。仅当本地存有 QA token 时渲染角标。
 * 标记存在 localStorage、服务端渲染读不到，故用 useEffect 在挂载后再判定（避免 hydration 不一致）。
 * @returns    有标记时返回角标节点，否则 null
 * @sideEffect 挂载时按 URL `?qa=` 写/清 localStorage（见 qa-flag.syncQaFlagFromUrl）
 */
export function QaBadge(): React.ReactElement | null {
  const [on, setOn] = useState(false)
  // 先同步再读：同一次挂载内「带参进入 → 角标立刻亮」，不必再刷一次页面才看得见
  useEffect(() => { syncQaFlagFromUrl(); setOn(qaToken() !== null) }, [])
  if (!on) return null
  return (
    <div
      aria-hidden
      className="fixed bottom-1 right-1.5 z-30 pointer-events-none select-none text-[10px] leading-none text-v2-text-muted"
    >
      QA
    </div>
  )
}
