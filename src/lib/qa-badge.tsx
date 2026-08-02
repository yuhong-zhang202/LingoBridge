/**
 * @module   QaBadge
 * @desc     QA 流量角标 —— 本机带 QA 标记时，右下角显示一个极小的灰字「QA」。
 *           存在理由：QA 标记本身是不可见状态，没有反馈就会出现「以为标了其实没标 / 以为关了其实还开着」，
 *           而这两种误判都会静默污染漏斗统计。角标是这个状态的唯一可见凭证。
 *
 *   真实用户永远看不到它（无标记 → 直接不渲染）。
 *   `pointer-events-none` + 低 z（低于所有弹层）保证它不拦任何点击、不遮任何浮层。
 *   与 qa-flag.ts 同置于 lib/：它只服务于 QA 标记这一件事，不是产品 UI 组件。
 *
 * @author   LingoBridge
 * @created  2026-08-02
 */
'use client'
import { useEffect, useState } from 'react'
import { qaToken } from '@/lib/qa-flag'

/**
 * QA 流量角标。仅当本地存有 QA token 时渲染。
 * 标记存在 localStorage、服务端渲染读不到，故用 useEffect 在挂载后再判定（避免 hydration 不一致）。
 * @returns    有标记时返回角标节点，否则 null
 */
export function QaBadge(): React.ReactElement | null {
  const [on, setOn] = useState(false)
  useEffect(() => { setOn(qaToken() !== null) }, [])
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
