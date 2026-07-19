/**
 * @module   ViewportReflowFix
 * @desc     修 iOS「加到主屏」standalone 首帧 viewport/safe-area 未应用的 quirk：
 *           iPhone 加主屏打开时首帧 env(safe-area-inset-*) 返回 0（TopBar 被状态栏盖住）、
 *           且 viewport 未完全生效（整页像被放大、px 边距视觉缩小 → 内容贴边），用户手动
 *           pinch 一下触发重排后才恢复。本组件在首帧挂载后主动替用户触发那一次「重新解析
 *           viewport + 重排」，让首屏一进来就正确。桌面/普通浏览器上为无害 no-op。
 *           不渲染任何 DOM。
 * @author   LingoBridge
 * @created  2026-07-19
 */
'use client'
import { useEffect } from 'react'

/**
 * 强制浏览器重新解析 <meta name="viewport"> 并重排一次。
 * 手法：把 viewport content 短暂改成一个视觉等价但字符串不同的值（initial-scale 1→1.0001），
 * 中间读一次 offsetHeight 逼出一次真实 layout pass，再把 content 改回原值。两次不同的 content
 * 之间夹一次强制 reflow，iOS 才会真正重新计算 viewport 缩放与 safe-area-inset，等价于用户
 * 手动 pinch 的那一下。1.0001 与 1 视觉上不可分辨，故无可见闪动；桌面浏览器基本忽略
 * viewport meta，改了又改回等于什么都没发生。
 * @sideEffect  临时修改并复原 document 中 viewport meta 的 content 属性；强制一次同步 reflow。
 */
function reapplyViewport(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta) return
  const original = meta.getAttribute('content')
  if (original === null) return

  // 已含 initial-scale 就替换其数值，否则追加一个，保证 content 字符串确实发生变化
  const nudged = /initial-scale\s*=\s*[\d.]+/.test(original)
    ? original.replace(/initial-scale\s*=\s*[\d.]+/, 'initial-scale=1.0001')
    : `${original}, initial-scale=1.0001`

  meta.setAttribute('content', nudged)
  // 读取布局属性逼出一次同步 reflow，确保「改前」「改回」落在两个独立的 layout pass 上
  void document.documentElement.offsetHeight
  meta.setAttribute('content', original)
}

/**
 * 挂载后（首帧绘制完成）触发一次 viewport 重排修正；并监听 pageshow 兜住 standalone 从
 * 后台/bfcache 恢复时再次出现的首帧未应用情况。不渲染任何内容。
 * @returns  始终返回 null
 */
export default function ViewportReflowFix(): null {
  useEffect(() => {
    // 双 rAF 确保在首帧真正绘制之后再修正，避开「viewport 尚未落地就去改」的竞态
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(reapplyViewport)
    })

    // standalone 从 bfcache 恢复（persisted）时，iOS 同样可能丢失 safe-area/viewport，补修一次
    const onPageShow = (e: PageTransitionEvent): void => {
      if (e.persisted) reapplyViewport()
    }
    window.addEventListener('pageshow', onPageShow)

    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  return null
}
