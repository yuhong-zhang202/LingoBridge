/**
 * @module   useAsyncAction
 * @desc     统一「防重复点击/防重复提交」工具。用 ref 做重入守卫（同步生效，
 *           不依赖 re-render，挡得住同一 tick 内的连续双击）；暴露 pending 供按钮显示 loading；
 *           finally 一定复位守卫，确保出错后按钮不被永久锁死；卸载后不再 setState（避免 React 警告）。
 *           只负责「守卫重入 + 暴露 pending + finally 复位」，不改 handler 自身的错误/提示行为。
 * @author   LingoBridge
 * @created  2026-06-26
 */
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 包装一个 async/sync handler，返回 [防重入的执行函数, pending]。
 * @param action 任意 handler；执行期间(含 await)再次调用直接 return，不会重复执行。
 */
export function useAsyncAction<A extends unknown[]>(
  action: (...args: A) => unknown | Promise<unknown>,
): [(...args: A) => Promise<void>, boolean] {
  const runningRef = useRef(false)   // ref 守卫：同步生效，re-render 无关
  const mountedRef = useRef(true)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const run = useCallback(
    async (...args: A): Promise<void> => {
      // 任何 await 之前同步检查并置位 —— 这是重入守卫的关键
      if (runningRef.current) return
      runningRef.current = true
      if (mountedRef.current) setPending(true)
      try {
        await action(...args)   // sync 也会被 await 强制成微任务，守卫覆盖整个执行期
      } finally {
        runningRef.current = false                       // 一定复位：出错也不锁死
        if (mountedRef.current) setPending(false)         // 卸载(如 router.push 跳走)后不再 setState
      }
    },
    [action],
  )

  return [run, pending]
}
