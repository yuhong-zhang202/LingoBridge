/**
 * @module   ProfilePage
 * @desc     「我的」页面 — Hero 连续打卡 + 双列副数据 + 画像雷达 + 功能列表；
 *           区分登录态，未登录时显示引导卡，隐藏打卡/数据/画像三张卡。
 * @author   LingoBridge
 * @created  2026-05-31
 */
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Settings } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import { isLoggedIn, getPhone, logout, maskPhone } from '@/lib/auth'
import { getSavedPhrases } from '@/lib/storage'
import OrbAvatar from './_components/OrbAvatar'
import LoginPrompt from './_components/LoginPrompt'
import LoggedInView from './_components/LoggedInView'
import FeatureListCard from './_components/FeatureListCard'

// ── Mock 数据（带注释的字段为占位，其余字段仅作初始值、由 useEffect 覆写为真实数据）
const profileData = {
  // 占位：暂无数据源（目标 Band 未持久化），等后续功能补全
  targetBand: 7.0,
  stats: { corpus: 12 },
  portrait: {
    corpusCount: 12,
    dimensions: { emotion: 0.7, relationship: 0.5, space: 0.3, spirit: 0.6, growth: 0.4 },
  },
  bookmarkCount: 24,
  version: 'v0.6.0',
}


/**
 * Profile 主页
 */
export default function ProfilePage(): JSX.Element {
  const router = useRouter()

  // localStorage 只能在客户端读，初始值 false/null，挂载后同步实际状态
  const [loggedIn, setLoggedIn] = useState(false)
  const [phone,    setPhone]    = useState<string | null>(null)
  const [bookmarkCount, setBookmarkCount] = useState(profileData.bookmarkCount)

  useEffect(() => {
    setLoggedIn(isLoggedIn())
    setPhone(getPhone())
  }, [])

  // deps=[loggedIn]：登录态变化时重读收藏数，保证练习后数字及时更新
  useEffect(() => {
    setBookmarkCount(getSavedPhrases().length)
  }, [loggedIn])

  const { targetBand, stats, version } = profileData

  const displayName = loggedIn
    ? (phone ? maskPhone(phone) : '我的账号')
    : '未登录'

  const handleLogout = () => {
    logout()
    setLoggedIn(false)
    setPhone(null)
  }

  const settingsButton = (
    <button
      onClick={() => {
        console.log('[ProfilePage] navigate to /settings')
        router.push('/settings')
      }}
      className="w-[30px] h-[30px] rounded-full bg-white shadow-sm flex items-center justify-center active:scale-[0.97] transition-transform duration-150"
    >
      <Settings size={15} color="#333" />
    </button>
  )

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col pb-[56px]">
      <TopBar title="我的" showBack={false} right={settingsButton} />

      <div className="flex-1 overflow-y-auto px-5 relative z-10">

        {/* ── 1. 用户头像区 */}
        <div className="flex flex-col items-center pt-6 pb-5">
          <OrbAvatar size={84} />
          <p className="text-[18px] font-semibold text-v2-text-primary mt-3">{displayName}</p>
        </div>

        {/* ── 未登录引导卡 */}
        {!loggedIn && <LoginPrompt className="mb-3" />}

        {/* ── 已登录态专属内容（条件挂载，LoggedInView 内部加载真实数据） */}
        {loggedIn && (
          <LoggedInView
            stats={stats}
            targetBand={targetBand}
          />
        )}

        {/* ── 功能列表卡（两态均显示） */}
        <FeatureListCard bookmarkCount={bookmarkCount} version={version} />

        {/* ── 退出登录（仅登录态，置于页面最下方） */}
        {loggedIn && (
          <div className="text-center mt-5 mb-2">
            <button
              onClick={handleLogout}
              className="bg-transparent border-none text-[13px] text-v2-text-muted px-4 py-2 active:opacity-60"
            >
              退出登录
            </button>
          </div>
        )}

      </div>

      <div className="flex-shrink-0"><TabBar /></div>
    </div>
  )
}
