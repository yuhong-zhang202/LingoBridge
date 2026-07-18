/**
 * @module   ProfilePage
 * @desc     「我的」入口 — 统一加载账号态，按断点分发两套 UI：
 *           移动端(lg 以下)走改版前独立设计，桌面端(lg 及以上)走密面板版
 * @author   LingoBridge
 * @created  2026-05-31
 */
'use client'
import { type JSX, useState, useEffect, useCallback } from 'react'
import { getAccount, logout } from '@/lib/auth'
import { getSupabase } from '@/lib/supabase'
import ProfileMobile from './ProfileMobile'
import ProfileDesktop from './ProfileDesktop'

const MS_PER_DAY = 86_400_000

export default function ProfilePage(): JSX.Element {
  // Supabase session 异步读，初始值 false/null，挂载后同步实际状态
  const [loggedIn, setLoggedIn] = useState(false)
  const [email,    setEmail]    = useState<string | null>(null)
  const [joinDays, setJoinDays] = useState<number | null>(null)

  useEffect(() => {
    getAccount().then(acct => {
      setLoggedIn(!!acct && !acct.isAnonymous && !!acct.email)
      setEmail(acct?.email ?? null)
    }).catch(() => {
      setLoggedIn(false)
      setEmail(null)
    })
    // 加入天数取自账号创建时间（前端只读，取不到则不展示）
    getSupabase().auth.getUser().then(({ data }) => {
      const created = data.user?.created_at
      if (created) setJoinDays(Math.max(0, Math.floor((Date.now() - new Date(created).getTime()) / MS_PER_DAY)))
    }).catch(() => { /* 忽略 */ })
  }, [])

  const onLogout = useCallback(() => {
    void logout().then(() => {
      setLoggedIn(false)
      setEmail(null)
    })
  }, [])

  const viewProps = { loggedIn, email, joinDays, onLogout }

  return (
    <>
      <div className="lg:hidden"><ProfileMobile {...viewProps} /></div>
      <div className="hidden lg:block"><ProfileDesktop {...viewProps} /></div>
    </>
  )
}
