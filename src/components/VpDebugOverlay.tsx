/**
 * @module   VpDebugOverlay
 * @desc     【临时诊断工具·诊断完即删】iOS standalone 首屏误缩放取证浮层。
 *           在页面左侧常驻一小块半透明数据面板，实时显示：视觉视口缩放值(scale)、
 *           视觉/布局视口宽度、文档 scrollWidth（横向溢出与否）、standalone 模式判定、
 *           safe-area 实际解析值、以及“横向最宽的前 5 个元素”（定位撑宽元凶）。
 *           产品方在 iPhone 加主屏打开题库页，pinch 前后各截图一张，即可拿到
 *           「缩放值是否 >1、是谁把布局撑宽」的实证数据。不拦截任何交互（pointer-events-none）。
 * @author   LingoBridge
 * @created  2026-07-19
 */
'use client'
import { useEffect, useState } from 'react'

interface Snap {
  scale: string
  vvW: string
  innerW: number
  docW: number
  scrollW: number
  bodyScrollW: number
  standalone: string
  meta: string
  safe: string
  offenders: string[]
}

/** 读取 env(safe-area-inset-*) 的实际解析值（通过探针元素的计算样式） */
function readSafeArea(): string {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left)'
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const s = `T${cs.paddingTop} B${cs.paddingBottom} L${cs.paddingLeft}`
  probe.remove()
  return s
}

/** 找“右缘/宽度超出布局视口”的前 5 个元素（撑宽元凶候选） */
function findOffenders(docW: number): string[] {
  const out: { label: string; right: number; w: number }[] = []
  const all = document.querySelectorAll<HTMLElement>('body *')
  const limit = Math.min(all.length, 2000)
  for (let i = 0; i < limit; i++) {
    const el = all[i]
    const r = el.getBoundingClientRect()
    if (r.width < 10) continue
    if (r.right > docW + 1 || r.width > docW + 1) {
      const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 28)
      out.push({ label: `${el.tagName.toLowerCase()}.${cls}`, right: Math.round(r.right), w: Math.round(r.width) })
    }
  }
  out.sort((a, b) => b.right - a.right)
  return out.slice(0, 5).map(o => `${o.label} w${o.w} r${o.right}`)
}

function takeSnap(): Snap {
  const vv = window.visualViewport
  const docW = document.documentElement.clientWidth
  return {
    scale: vv ? vv.scale.toFixed(3) : 'n/a',
    vvW: vv ? vv.width.toFixed(0) : 'n/a',
    innerW: window.innerWidth,
    docW,
    scrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    standalone: `${matchMedia('(display-mode: standalone)').matches ? 'dm:sa' : 'dm:br'}/${(navigator as { standalone?: boolean }).standalone ? 'nav:sa' : 'nav:br'}`,
    meta: document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content?.slice(0, 60) ?? '无',
    safe: readSafeArea(),
    offenders: findOffenders(docW),
  }
}

/** 临时诊断浮层：每秒刷新一次布局取证数据；不接收任何点击。 */
export default function VpDebugOverlay() {
  const [snap, setSnap] = useState<Snap | null>(null)

  useEffect(() => {
    const update = () => setSnap(takeSnap())
    update()
    const t = setInterval(update, 1000)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      clearInterval(t)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])

  if (!snap) return null
  return (
    <div
      aria-hidden
      className="fixed left-1 top-24 z-[9999] pointer-events-none rounded-md bg-black/75 text-white font-mono text-[9px] leading-[1.5] px-2 py-1.5 max-w-[92vw] whitespace-pre-wrap"
    >
      {`scale:${snap.scale} vvW:${snap.vvW}
innerW:${snap.innerW} docW:${snap.docW}
scrollW:${snap.scrollW} bodyW:${snap.bodyScrollW}
mode:${snap.standalone}
safe:${snap.safe}
meta:${snap.meta}
超宽:${snap.offenders.length ? '\n' + snap.offenders.join('\n') : '无'}`}
    </div>
  )
}
