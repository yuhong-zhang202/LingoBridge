/**
 * @module   useAccount
 * @desc     账号状态 hook — 内部 getAccount()，并订阅 Supabase onAuthStateChange：
 *           updateUser（如上传头像）/ 登录 / 登出后，所有挂载中的实例自动重新拉取，
 *           跨组件树（TopNav / IdentityCard 等）无需手动通知即可同步。
 * @author   LingoBridge
 * @created  2026-07-10
 */
'use client'
import { useCallback, useEffect, useState } from 'react'
import { getAccount } from '@/lib/auth'
import { getSupabase } from '@/lib/supabase'

export type Account = NonNullable<Awaited<ReturnType<typeof getAccount>>>

/**
 * 读取并订阅当前账号状态
 * @returns account  当前账号（未加载完/无会话时为 null）
 * @returns refresh  显式重新拉取（onAuthStateChange 已覆盖常规场景，此为兜底）
 * @sideEffect       挂载期间订阅 auth 状态变化，卸载时退订
 */
export function useAccount(): { account: Account | null; refresh: () => void } {
  const [account, setAccount] = useState<Account | null>(null)

  const refresh = useCallback(() => {
    getAccount().then(setAccount).catch(() => setAccount(null))
  }, [])

  useEffect(() => {
    refresh()
    // setTimeout 脱离回调同步栈：supabase-js 不允许在 onAuthStateChange 回调内直接 await 自身 API（会死锁）
    const { data } = getSupabase().auth.onAuthStateChange(() => { setTimeout(refresh, 0) })
    return () => data.subscription.unsubscribe()
  }, [refresh])

  return { account, refresh }
}
