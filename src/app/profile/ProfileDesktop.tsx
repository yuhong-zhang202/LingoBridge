/**
 * @module   ProfileDesktop
 * @desc     「我的」（桌面端）— 顶部导航 + 页头；登录态：身份卡 → 常用操作 → 画像 + 功能列表（两栏等高）；
 *           未登录展示引导卡 + 功能列表。密面板风。
 * @author   LingoBridge
 * @created  2026-05-31
 */
'use client'
import { useRouter } from 'next/navigation'
import { Settings } from 'lucide-react'
import TopNav from '@/components/TopNav'
import ManageHeader, { MANAGE_CONTAINER } from '@/components/ManageHeader'
import { maskEmail } from '@/lib/auth'
import LoginPrompt from './_components/LoginPrompt'
import FeatureListCard from './_components/FeatureListCard'
import IdentityCard from './_components/IdentityCard'
import CommonActions from './_components/CommonActions'
import PortraitCard from './_components/PortraitCard'
import type { ProfileViewProps } from './types'

const TARGET_BAND = 7.0
const VERSION = 'v0.6.0'

export default function ProfileDesktop({ loggedIn, email, joinDays, bookmarkCount, onLogout }: ProfileViewProps): JSX.Element {
  const router = useRouter()
  const displayName = loggedIn ? (email ? maskEmail(email) : '我的账号') : '未登录'

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

      <main className={`${MANAGE_CONTAINER} pb-12`}>
        <ManageHeader title="我的" right={settingsButton} />

        {loggedIn ? (
          <>
            {/* 1. 身份卡 */}
            <IdentityCard
              displayName={displayName}
              targetBand={TARGET_BAND}
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
                version={VERSION}
                onLogout={onLogout}
              />
            </div>
          </>
        ) : (
          /* 未登录：引导卡 + 功能列表 */
          <div className="max-w-[640px] mx-auto flex flex-col gap-3">
            <LoginPrompt />
            <FeatureListCard bookmarkCount={bookmarkCount} version={VERSION} />
          </div>
        )}
      </main>
    </div>
  )
}
