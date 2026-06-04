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
import { Settings, Target } from 'lucide-react'
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
 * 根据目标 Band 分数返回胶囊颜色参数
 * @param band  目标分数
 * @returns     bg / border / text 内联色值字符串
 */
function getBandColors(band: number): { bg: string; border: string; text: string } {
  if (band >= 7.0) return { bg: 'rgba(154,125,184,0.10)', border: 'rgba(154,125,184,0.28)', text: '#9A7DB8' }
  if (band >= 6.5) return { bg: 'rgba(212,135,90,0.10)',  border: 'rgba(212,135,90,0.28)',  text: '#D4875A' }
  return              { bg: 'rgba(123,166,153,0.10)',  border: 'rgba(123,166,153,0.28)',  text: '#7BA699' }
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
  const bandColors = getBandColors(targetBand)

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
          {loggedIn && (
            <div
              className="inline-flex items-center gap-[5px] px-[11px] py-1 rounded-full mt-2"
              style={{
                backgroundColor: bandColors.bg,
                border: `1px solid ${bandColors.border}`,
              }}
            >
              <Target size={11} color={bandColors.text} />
              <span className="text-[11px] font-medium" style={{ color: bandColors.text }}>
                目标 Band {targetBand.toFixed(1)}
              </span>
            </div>
          )}
        </div>

        {/* ── 未登录引导卡 */}
        {!loggedIn && <LoginPrompt className="mb-3" />}

        {/* ── 已登录态专属内容（条件挂载，LoggedInView 内部加载真实数据） */}
        {loggedIn && (
          <LoggedInView
            stats={stats}
            targetBand={targetBand}
            onLogout={handleLogout}
          />
        )}

        {/* ── 功能列表卡（两态均显示） */}
        <FeatureListCard bookmarkCount={bookmarkCount} version={version} />

      </div>

      <div className="flex-shrink-0"><TabBar /></div>
    </div>
  )
}
