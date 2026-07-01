/**
 * @module   ProfilePage
 * @desc     「我的」页面 — 顶部导航 + 页头；登录态自上而下：身份卡(头像/邮箱/统计) → 常用操作(改密码/额度/反馈)
 *           → 我的画像 + 功能列表(两栏等高，退出登录锚定栏底)；未登录展示引导卡 + 功能列表。
 * @author   LingoBridge
 * @created  2026-05-31
 */
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Settings } from 'lucide-react'
import TopNav from '@/components/TopNav'
import TabBar from '@/components/TabBar'
import ManageHeader, { MANAGE_CONTAINER } from '@/components/ManageHeader'
import { getAccount, logout, maskEmail } from '@/lib/auth'
import { getSupabase } from '@/lib/supabase'
import { getSavedPhrases } from '@/lib/storage'
import LoginPrompt from './_components/LoginPrompt'
import FeatureListCard from './_components/FeatureListCard'
import IdentityCard from './_components/IdentityCard'
import CommonActions from './_components/CommonActions'
import PortraitCard from './_components/PortraitCard'

const MS_PER_DAY = 86_400_000

// 占位数据：目标 Band 未持久化；bookmarkCount 为初始值，挂载后由 localStorage 覆写
const profileData = {
  targetBand: 7.0,
  bookmarkCount: 24,
  version: 'v0.6.0',
}

/**
 * Profile 主页
 */
export default function ProfilePage(): JSX.Element {
  const router = useRouter()

  // Supabase session 异步读，初始值 false/null，挂载后同步实际状态
  const [loggedIn, setLoggedIn] = useState(false)
  const [email,    setEmail]    = useState<string | null>(null)
  const [joinDays, setJoinDays] = useState<number | null>(null)
  const [bookmarkCount, setBookmarkCount] = useState(profileData.bookmarkCount)

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

  // deps=[loggedIn]：登录态变化时重读收藏数，保证练习后数字及时更新
  useEffect(() => {
    setBookmarkCount(getSavedPhrases().length)
  }, [loggedIn])

  const { targetBand, version } = profileData

  const displayName = loggedIn
    ? (email ? maskEmail(email) : '我的账号')
    : '未登录'

  const handleLogout = async () => {
    await logout()
    setLoggedIn(false)
    setEmail(null)
  }

  const settingsButton = (
    <button
      onClick={() => router.push('/settings')}
      aria-label="设置"
      className="w-10 h-10 rounded-full grid place-items-center text-v2-text-secondary hover:bg-bg-muted transition-colors"
    >
      <Settings size={18} />
    </button>
  )

  return (
    <div className="min-h-screen bg-bg-page">
      <TopNav containerClassName={MANAGE_CONTAINER} />

      <main className={`${MANAGE_CONTAINER} pb-24 md:pb-12`}>
        <ManageHeader title="我的" right={settingsButton} />

        {loggedIn ? (
          <>
            {/* 1. 身份卡 */}
            <IdentityCard
              displayName={displayName}
              targetBand={targetBand}
              joinDays={joinDays}
              onEdit={() => router.push('/settings')}
            />

            {/* 2. 常用操作 */}
            <div className="mb-8">
              <CommonActions email={email} />
            </div>

            {/* 3. 我的画像 + 功能列表（两栏等高，退出登录锚定右栏底部） */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-6 items-stretch">
              <PortraitCard />
              <FeatureListCard
                bookmarkCount={bookmarkCount}
                version={version}
                onLogout={() => void handleLogout()}
              />
            </div>
          </>
        ) : (
          /* 未登录：引导卡 + 功能列表 */
          <div className="max-w-[640px] mx-auto flex flex-col gap-3">
            <LoginPrompt />
            <FeatureListCard bookmarkCount={bookmarkCount} version={version} />
          </div>
        )}
      </main>

      {/* 移动端底部导航（桌面用顶栏，无侧栏） */}
      <div className="md:hidden"><TabBar /></div>
    </div>
  )
}
