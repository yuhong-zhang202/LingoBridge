/**
 * @module   ProfilePage
 * @desc     「我的」页面 — 顶部导航 + 面包屑页头 + 头像；登录态左栏(打卡 hero/副数据/画像雷达)+右栏(额度卡/功能列表)，
 *           未登录显示引导卡 + 功能列表并隐藏打卡/数据/画像。密面板风（对齐题库 v3）。
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
import { getSavedPhrases } from '@/lib/storage'
import OrbAvatar from './_components/OrbAvatar'
import LoginPrompt from './_components/LoginPrompt'
import LoggedInView from './_components/LoggedInView'
import FeatureListCard from './_components/FeatureListCard'
import QuotaCard from './_components/QuotaCard'

// ── Mock 数据（带注释的字段为占位，其余字段仅作初始值、由 useEffect 覆写为真实数据）
const profileData = {
  // 占位：暂无数据源（目标 Band 未持久化），等后续功能补全
  targetBand: 7.0,
  stats: { corpus: 12 },
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
  const [bookmarkCount, setBookmarkCount] = useState(profileData.bookmarkCount)

  useEffect(() => {
    getAccount().then(acct => {
      setLoggedIn(!!acct && !acct.isAnonymous && !!acct.email)
      setEmail(acct?.email ?? null)
    }).catch(() => {
      setLoggedIn(false)
      setEmail(null)
    })
  }, [])

  // deps=[loggedIn]：登录态变化时重读收藏数，保证练习后数字及时更新
  useEffect(() => {
    setBookmarkCount(getSavedPhrases().length)
  }, [loggedIn])

  const { targetBand, stats, version } = profileData

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

        {/* 头像区 */}
        <div className="flex flex-col items-center pt-1 pb-6">
          <OrbAvatar size={84} />
          <p className="text-[18px] font-semibold text-v2-text-primary mt-3">{displayName}</p>
        </div>

        {loggedIn ? (
          <>
            {/* 登录态：左栏 打卡/副数据/画像 · 右栏 额度卡/功能列表 */}
            <div className="grid lg:grid-cols-2 gap-4 lg:gap-6 items-start">
              <div>
                <LoggedInView stats={stats} targetBand={targetBand} />
              </div>
              <div className="flex flex-col gap-3">
                <QuotaCard />
                <FeatureListCard bookmarkCount={bookmarkCount} version={version} />
              </div>
            </div>

            {/* 退出登录（仅登录态，置于页面最下方） */}
            <div className="text-center mt-6">
              <button
                onClick={() => void handleLogout()}
                className="bg-transparent border-none text-[13px] text-v2-text-muted px-4 py-2 active:opacity-60"
              >
                退出登录
              </button>
            </div>
          </>
        ) : (
          /* 未登录：引导卡 + 功能列表（隐藏打卡/数据/画像） */
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
