/**
 * @module   ProfileMobile
 * @desc     「我的」（移动端）— TopBar + 头像 + 登录态(打卡 hero/副数据/画像雷达 + 额度卡) + 功能列表 + 退出登录 + 底部 TabBar；
 *           改版前独立移动 UI，仅移动端树使用。
 * @author   LingoBridge
 * @created  2026-05-31
 */
'use client'
import { useRouter } from 'next/navigation'
import { Settings } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import Avatar from '@/components/Avatar'
import { maskEmail } from '@/lib/auth'
import { useAccount } from '@/hooks/useAccount'
import OrbAvatar from './_components/OrbAvatar'
import LoginPrompt from './_components/LoginPrompt'
import LoggedInView from './_components/LoggedInView'
import FeatureListCard from './_components/FeatureListCardMobile'
import QuotaCard from './_components/QuotaCard'
import type { ProfileViewProps } from './types'

// 占位：目标 Band 未持久化；stats.corpus 仅作初始值，LoggedInView 内部拉取真实数据覆写
const TARGET_BAND = 7.0
const STATS = { corpus: 12 }
const VERSION = 'v0.6.0'

export default function ProfileMobile({ loggedIn, email, onLogout }: ProfileViewProps): JSX.Element {
  const router = useRouter()
  // 订阅账号态：仅取 avatarUrl 做头像回退显示（上传后自动刷新）
  const { account } = useAccount()
  const displayName = loggedIn ? (email ? maskEmail(email) : '我的账号') : '未登录'

  const settingsButton = (
    <button
      onClick={() => router.push('/settings')}
      aria-label="设置"
      className="w-[30px] h-[30px] rounded-full bg-white shadow-sm flex items-center justify-center active:scale-[0.97] transition-transform duration-150"
    >
      <Settings size={15} color="#333" />
    </button>
  )

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col pb-[56px]">
      <TopBar title="我的" showBack={false} right={settingsButton} showFeedback={false} />

      <div className="flex-1 overflow-y-auto px-5 relative z-10">

        {/* ── 1. 用户头像区 */}
        <div className="flex flex-col items-center pt-6 pb-5">
          <Avatar avatarUrl={account?.avatarUrl} size={84} fallback={<OrbAvatar size={84} />} />
          <p className="text-[18px] font-semibold text-v2-text-primary mt-3">{displayName}</p>
        </div>

        {/* ── 未登录引导卡 */}
        {!loggedIn && <LoginPrompt className="mb-3" />}

        {/* ── 已登录态专属内容（条件挂载，LoggedInView 内部加载真实数据） */}
        {loggedIn && (
          <LoggedInView
            stats={STATS}
            targetBand={TARGET_BAND}
          />
        )}

        {/* ── 本月额度卡（仅登录态） */}
        {loggedIn && <QuotaCard />}

        {/* ── 功能列表卡（两态均显示） */}
        <FeatureListCard version={VERSION} />

        {/* ── 退出登录（仅登录态，置于页面最下方） */}
        {loggedIn && (
          <div className="text-center mt-5 mb-2">
            <button
              onClick={onLogout}
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
