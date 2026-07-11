/**
 * @module   useAccount
 * @desc     账号状态 hook — 模块级共享：首个消费者触发一次 getAccount() 与唯一一个 onAuthStateChange
 *           订阅，后续消费者同步命中共享缓存（新挂载不再各发请求、不再闪回退）。
 *           auth 状态变化（含上传头像的 updateUser）刷新缓存并通知全部订阅者。
 * @author   LingoBridge
 * @created  2026-07-10
 */
'use client'
import { useCallback, useSyncExternalStore } from 'react'
import { getAccount } from '@/lib/auth'
import { getSupabase } from '@/lib/supabase'

export type Account = NonNullable<Awaited<ReturnType<typeof getAccount>>>

/** 共享快照。getSnapshot 必须返回稳定引用，故内容相同时保留旧对象、不触发重渲染。 */
let snapshot: Account | null = null
const listeners = new Set<() => void>()
let unsubscribeAuth: (() => void) | null = null

function sameAccount(a: Account | null, b: Account | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  // 六个字段全比：漏任一字段，改该字段后 commit 会被判为「无变化」而不通知订阅者，界面不刷新
  return (
    a.email === b.email &&
    a.isAnonymous === b.isAnonymous &&
    a.avatarUrl === b.avatarUrl &&
    a.displayName === b.displayName &&
    a.targetBand === b.targetBand &&
    a.examDate === b.examDate
  )
}

function commit(next: Account | null): void {
  if (sameAccount(snapshot, next)) return
  snapshot = next
  listeners.forEach((l) => l())
}

/** 拉取账号并更新共享快照（getAccount 读本地 session，代价极小） */
function load(): void {
  getAccount().then(commit).catch(() => commit(null))
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  if (listeners.size === 1) {
    // 首个消费者：拉一次 + 建唯一订阅
    load()
    // setTimeout 脱离回调同步栈：supabase-js 不允许在 onAuthStateChange 回调内直接 await 自身 API（会死锁）
    const { data } = getSupabase().auth.onAuthStateChange(() => { setTimeout(load, 0) })
    unsubscribeAuth = () => data.subscription.unsubscribe()
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) {
      unsubscribeAuth?.()
      unsubscribeAuth = null
      // 保留 snapshot：下次挂载先同步命中缓存，避免重新闪一次回退头像
    }
  }
}

const getClientSnapshot = (): Account | null => snapshot
const getServerSnapshot = (): Account | null => null

/**
 * 读取并订阅当前账号状态（跨组件共享一次请求）
 * @returns account  当前账号（未加载完 / 无会话时为 null）
 * @returns refresh  显式重新拉取（onAuthStateChange 已覆盖常规场景，此为兜底）
 * @sideEffect       首个消费者挂载时订阅 auth 状态变化，最后一个卸载时退订
 */
export function useAccount(): { account: Account | null; refresh: () => void } {
  const account = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
  const refresh = useCallback(() => { load() }, [])
  return { account, refresh }
}
