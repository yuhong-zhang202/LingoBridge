/**
 * @module   ProfileDesktop
 * @desc     「我的」（桌面端）— 顶部导航 + 仪表盘。登录态：身份卡（页头）→ 画像 | 目标·常用操作 两栏 → 关于/退出页脚。
 *           页面标题不再重复渲染（TopNav 已高亮「我的」），仅保留设置齿轮入口。未登录展示引导卡 + 功能列表。
 * @author   LingoBridge
 * @created  2026-05-31
 */
'use client'
import { type JSX } from 'react'
import Link from 'next/link'
import { Settings } from 'lucide-react'
import TopNav from '@/components/TopNav'
import { MANAGE_CONTAINER } from '@/components/ManageHeader'
import { maskEmail } from '@/lib/auth'
import { LATEST_VERSION } from '@/lib/changelog'
import LoginPrompt from './_components/LoginPrompt'
import FeatureListCard from './_components/FeatureListCard'
import IdentityCard from './_components/IdentityCard'
import ExamGoalCard from './_components/ExamGoalCard'
import CommonActions from './_components/CommonActions'
import PortraitCard from './_components/PortraitCard'
import type { ProfileViewProps } from './types'

export default function ProfileDesktop({ loggedIn, email, joinDays, onLogout }: ProfileViewProps): JSX.Element {
  const displayName = loggedIn ? (email ? maskEmail(email) : '我的账号') : '未登录'

  const settingsButton = (
    <Link
      href="/settings"
      aria-label="设置"
      className="w-10 h-10 rounded-full grid place-items-center text-v2-text-secondary hover:bg-bg-muted transition-colors"
    >
      <Settings size={18} />
    </Link>
  )

  return (
    <div className="min-h-screen bg-bg-page">
      <TopNav containerClassName={MANAGE_CONTAINER} />

      <main className={`${MANAGE_CONTAINER} pb-12`}>
        {/* 精简顶栏：不再重复「我的」大标题（与 TopNav 高亮项重复），仅留设置入口 */}
        <div className="flex justify-end pt-6 pb-4">
          {settingsButton}
        </div>

        {loggedIn ? (
          /* 登录态仪表盘：全宽身份卡（页头）→ 目标·工具 | 画像 非对称两栏 → 全宽关于/退出（页脚）。
             两栏比单调的全宽堆叠更有层次，且让雷达落进半宽栏、不再两侧大片留白。 */
          <div className="flex flex-col gap-6">
            {/* 页头：身份卡（全宽） */}
            <IdentityCard
              displayName={displayName}
              joinDays={joinDays}
            />

            {/* 主区：左「我的画像」/ 右「备考目标 + 常用操作」。items-stretch + PortraitCard 自带
                h-full → 画像卡随右栏高度拉伸、雷达垂直居中填满，无底部留白。 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
              <PortraitCard />
              <div className="flex flex-col gap-6">
                <ExamGoalCard />
                <CommonActions />
              </div>
            </div>

            {/* 页脚：关于 + 退出（全宽，自然高度） */}
            <FeatureListCard version={LATEST_VERSION} onLogout={onLogout} />
          </div>
        ) : (
          /* 未登录：引导卡 + 功能列表 */
          <div className="max-w-[640px] mx-auto flex flex-col gap-3">
            <LoginPrompt />
            <FeatureListCard version={LATEST_VERSION} />
          </div>
        )}
      </main>
    </div>
  )
}
