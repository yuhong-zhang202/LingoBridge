/**
 * @module   ProfileMobile
 * @desc     「我的」（移动端）— TopBar + 头像 + 登录态(打卡 hero/副数据/画像雷达 + 额度卡) + 功能列表 + 退出登录 + 底部 TabBar；
 *           改版前独立移动 UI，仅移动端树使用。
 * @author   LingoBridge
 * @created  2026-05-31
 */
'use client'
import { type JSX, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Settings, Pencil, Camera } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import Avatar from '@/components/Avatar'
import { maskEmail, defaultNickname } from '@/lib/auth'
import { LATEST_VERSION } from '@/lib/changelog'
import { useAccount } from '@/hooks/useAccount'
import NameModal from './_components/NameModal'
import AvatarModal from './_components/AvatarModal'
import OrbAvatar from './_components/OrbAvatar'
import LoginPrompt from './_components/LoginPrompt'
import LoggedInView from './_components/LoggedInView'
import FeatureListCard from './_components/FeatureListCardMobile'
import QuotaCard from './_components/QuotaCard'
import TrialQuotaCard from './_components/TrialQuotaCard'
import type { ProfileViewProps } from './types'

// 占位：stats.corpus 仅作初始值，LoggedInView 内部拉取真实数据覆写
const STATS = { corpus: 12 }

export default function ProfileMobile({ loggedIn, isAnon, email, onLogout }: ProfileViewProps): JSX.Element {
  const router = useRouter()
  const [nameOpen, setNameOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  // 订阅账号态：取 avatarUrl 做头像回退、displayName 做昵称显示（上传/改名后自动刷新）
  const { account } = useAccount()
  const maskedEmail = loggedIn && email ? maskEmail(email) : null
  // 昵称在邮箱上方：优先自定义昵称，无则回退默认随机数字昵称；未登录固定「未登录」
  const nickname = loggedIn ? (account?.displayName || defaultNickname(maskedEmail)) : '未登录'

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
    <div
      className="relative h-dvh overflow-hidden bg-bg-page flex flex-col"
      style={{ paddingBottom: 'calc(56px + env(safe-area-inset-bottom))' }}
    >
      <TopBar title="我的" showBack={false} right={settingsButton} showFeedback={false} />

      <div className="flex-1 min-h-0 overflow-y-auto px-5 relative z-10">

        {/* ── 1. 用户头像区 */}
        <div className="flex flex-col items-center pt-6 pb-5">
          {/* 点击头像换头像（对齐桌面 IdentityCard 范式，无条件可点；权限由 AvatarModal 内部处理）。
              移动端无 hover，叠一个相机角标暗示「可换」。button 不加 overflow-hidden 以免裁掉角标。 */}
          <button
            onClick={() => setAvatarOpen(true)}
            aria-label="更换头像"
            className="relative shrink-0 rounded-full active:scale-[0.97] transition-transform"
          >
            <span className="block rounded-full overflow-hidden">
              <Avatar avatarUrl={account?.avatarUrl} size={84} fallback={<OrbAvatar size={84} />} />
            </span>
            <span
              aria-hidden
              className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-brand-primary ring-2 ring-white shadow-sm flex items-center justify-center"
            >
              <Camera size={14} className="text-white" />
            </span>
          </button>
          {loggedIn ? (
            <>
              {/* 昵称行（在邮箱上方）+ 编辑按钮 */}
              <button
                onClick={() => setNameOpen(true)}
                aria-label="编辑昵称"
                className="mt-3 flex items-center gap-1.5 active:scale-[0.97] transition-transform"
              >
                <span className="text-[18px] font-semibold text-v2-text-primary">{nickname}</span>
                <Pencil size={14} className="text-v2-text-muted" />
              </button>
              {maskedEmail && <p className="text-[12px] text-v2-text-muted mt-1">{maskedEmail}</p>}
            </>
          ) : (
            <p className="text-[18px] font-semibold text-v2-text-primary mt-3">{nickname}</p>
          )}
        </div>

        {/* ── 未登录引导卡（+ 匿名试用额度卡：让匿名用户二次确认「总数 1 条、注册后每月 10 次」口径） */}
        {!loggedIn && <LoginPrompt className="mb-3" />}
        {!loggedIn && isAnon && <TrialQuotaCard />}

        {/* ── 已登录态专属内容（条件挂载，LoggedInView 内部加载真实数据） */}
        {loggedIn && <LoggedInView stats={STATS} />}

        {/* ── 本月额度卡（仅登录态） */}
        {loggedIn && <QuotaCard />}

        {/* ── 功能列表卡（两态均显示） */}
        <FeatureListCard version={LATEST_VERSION} />

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

      {nameOpen && <NameModal currentName={account?.displayName ?? null} onClose={() => setNameOpen(false)} />}
      {avatarOpen && <AvatarModal onClose={() => setAvatarOpen(false)} />}
    </div>
  )
}
