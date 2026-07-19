/**
 * @module   StandaloneZoomFix
 * @desc     修 iOS「加到主屏」standalone 启动即带非 1.0 缩放的 quirk（真机取证坐实：
 *           启动瞬间 visualViewport.scale=1.066、布局宽 393 无溢出无超宽元素——即布局正确、
 *           纯粹是系统带着"捏合放大"状态启动，疑与系统文字大小映射有关）。
 *           手法：仅在 standalone 模式启动后的短窗口内，检测到 scale>1.01 就给 viewport meta
 *           临时加 maximum-scale=1 把视觉缩放钳回 1.0，随即恢复原 content（不锁死用户后续
 *           手动缩放；iOS 出于无障碍本也忽略 maximum-scale 对用户手势的限制）。
 *           只钳启动窗口这一次，绝不在用户主动缩放时打扰；普通浏览器/桌面为 no-op。
 *           另一处真机坐实的残留源：iOS 聚焦 font-size<16px 的输入框会自动放大 16/字号 倍，
 *           普通浏览器输入完会缩回，standalone 不缩回（登录页 15px → scale=1.066 永久残留）。
 *           治本是全站表单控件字号 ≥16px；本组件同时挂 document 级 focusout 兜底：失焦后
 *           仅在 300/800ms 两个时点各检测一次（绝不常驻轮询），若焦点不在表单控件上且
 *           scale>1.01 就复用 clampZoomOnce 钳回——兜住未来遗漏的小字号输入框。
 * @author   LingoBridge
 * @created  2026-07-19
 */
'use client'
import { useEffect } from 'react'

/** 是否处于「加到主屏」standalone 模式（display-mode 或 iOS 私有 navigator.standalone） */
function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

/** 若当前视觉缩放 >1.01，用 maximum-scale=1 钳回 1.0 后立刻恢复原 meta。返回是否执行了钳制。 */
function clampZoomOnce(): boolean {
  const vv = window.visualViewport
  if (!vv || vv.scale <= 1.01) return false
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta) return false
  const original = meta.content
  // 加 maximum-scale=1 迫使 WebKit 立即把视觉缩放归 1（保留 viewport-fit=cover 等原有键）
  meta.content = `${original}, maximum-scale=1`
  // 归位后恢复原 content：缩放状态已被重置为 1，恢复不会弹回；用户此后仍可自由捏合缩放
  window.setTimeout(() => {
    meta.content = original
  }, 250)
  return true
}

/** 当前焦点是否落在表单控件上（此时不钳：用户可能正连续切换输入框，放大态尚属正常） */
function isFormControlFocused(): boolean {
  const tag = document.activeElement?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * 仅在 standalone 启动后的短窗口（≈1.2s）内做几次检测：发现启动残留缩放即钳回一次并停止。
 * 窗口外不再干预——避免误伤用户之后的主动缩放。bfcache 恢复（pageshow persisted）重开窗口。
 * 另挂 focusout 兜底：输入框失焦后 300/800ms 各检测一次残留缩放（见文件顶注）。
 */
export default function StandaloneZoomFix() {
  useEffect(() => {
    if (!isStandalone()) return

    let done = false
    const timers: number[] = []
    const tryClamp = () => {
      if (done) return
      if (clampZoomOnce()) done = true
    }
    // 启动窗口内多点检测：首帧后、150ms、500ms、1200ms（WebKit 上报 scale 的时机不定）
    const raf = requestAnimationFrame(() => {
      tryClamp()
      timers.push(window.setTimeout(tryClamp, 150))
      timers.push(window.setTimeout(tryClamp, 500))
      timers.push(window.setTimeout(tryClamp, 1200))
    })

    // 从后台/bfcache 恢复时可能再次带残留缩放，重开一次检测窗口
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        done = false
        tryClamp()
        timers.push(window.setTimeout(tryClamp, 300))
      }
    }
    window.addEventListener('pageshow', onPageShow)

    // 兜底：输入框失焦后短窗口内检测 iOS 聚焦小字号输入框留下的放大态。
    // 只在 focusout 触发的 300/800ms 两个时点各查一次，检测时焦点又落回表单控件则跳过本次
    //（说明用户在连续输入，等最终失焦的那次 focusout 再兜）。绝不常驻轮询。
    let blurTimerA: number | undefined
    let blurTimerB: number | undefined
    const clampAfterBlur = () => {
      if (isFormControlFocused()) return
      clampZoomOnce()
    }
    const onFocusOut = () => {
      window.clearTimeout(blurTimerA)
      window.clearTimeout(blurTimerB)
      blurTimerA = window.setTimeout(clampAfterBlur, 300)
      blurTimerB = window.setTimeout(clampAfterBlur, 800)
    }
    document.addEventListener('focusout', onFocusOut)

    return () => {
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
      window.clearTimeout(blurTimerA)
      window.clearTimeout(blurTimerB)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  return null
}
