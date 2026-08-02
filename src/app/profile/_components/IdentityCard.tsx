/**
 * @module   IdentityCard
 * @desc     「我的」身份卡 — 可点击头像(更换) + 邮箱 + 加入天数 + 编辑资料；底部分隔线内统计条(打卡/语料/练习)。
 *           备考目标已独立为 ExamGoalCard（含倒计时），此处不再重复展示。
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { type JSX, useState } from 'react'
import { Flame, MessageCircle, Target } from 'lucide-react'
import Card from '@/components/Card'
import Avatar from '@/components/Avatar'
import GradientButton from '@/components/GradientButton'
import OrbAvatar from './OrbAvatar'
import AvatarModal from './AvatarModal'
import NameModal from './NameModal'
import { useAccount } from '@/hooks/useAccount'
import { defaultNickname } from '@/lib/auth'
import { useStreak, useCorpusCount, usePracticeCount } from '@/hooks/profile-data'

interface IdentityCardProps {
  displayName: string
  /** 加入天数；null 时不展示该项 */
  joinDays: number | null
}

/**
 * 身份卡
 * @param displayName 脱敏邮箱 / 账号名（account.displayName 为空时的回退）
 * @param joinDays    加入天数
 * @sideEffect        挂载时并行读取连续打卡 / 语料段数 / 练习次数
 */
export default function IdentityCard({ displayName, joinDays }: IdentityCardProps): JSX.Element {
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [nameOpen, setNameOpen] = useState(false)
  // 订阅账号态：上传头像 / 改昵称后（USER_UPDATED）此处自动刷新
  const { account } = useAccount()
  // 昵称在邮箱上方：优先自定义昵称，无则回退默认随机数字昵称（以打码邮箱为稳定种子）
  const nickname = account?.displayName || defaultNickname(displayName)
  // SWR 共享缓存：corpus 与 PortraitCard 共用 'profile:corpus' key，全页只发一次
  const { streak } = useStreak()
  const { count: corpus } = useCorpusCount()
  const { practiceCount: practice } = usePracticeCount()


  return (
    <Card className="px-7 py-6 mb-6">
      <div className="flex items-center gap-5">
        <button
          onClick={() => setAvatarOpen(true)}
          aria-label="更换头像"
          className="shrink-0 rounded-full overflow-hidden active:scale-[0.97] transition-transform"
        >
          <Avatar avatarUrl={account?.avatarUrl} size={64} fallback={<OrbAvatar size={64} />} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[1rem] font-semibold text-v2-text-primary truncate">{nickname}</p>
          <p className="text-[0.75rem] text-v2-text-muted truncate mt-0.5">{displayName}</p>
          {joinDays !== null && (
            <p className="text-[0.8125rem] text-v2-text-muted mt-1">已加入 {joinDays} 天</p>
          )}
        </div>
        <GradientButton onClick={() => setNameOpen(true)} className="shrink-0 px-5 py-2.5 rounded-full text-[0.8125rem] font-medium">
          编辑资料
        </GradientButton>
      </div>

      <div className="mt-5 pt-4 border-t border-black/[0.05] flex flex-wrap items-center gap-x-6 gap-y-2 text-[0.8125rem] text-v2-text-secondary">
        <div className="flex items-center gap-1.5 pl-2.5 pr-3 py-1 rounded-full bg-brand-primary-light/50">
          <Flame size={14} className="text-brand-primary-dark" />
          <span className="text-brand-primary-dark font-medium">连续打卡 {streak} 天</span>
        </div>
        <div className="flex items-center gap-1.5">
          <MessageCircle size={14} className="text-v2-text-muted" />
          <span>已积累语料 <b className="text-v2-text-primary font-semibold">{corpus}</b> 段</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Target size={14} className="text-v2-text-muted" />
          <span>已练习 <b className="text-v2-text-primary font-semibold">{practice}</b> 次</span>
        </div>
      </div>

      {avatarOpen && <AvatarModal onClose={() => setAvatarOpen(false)} />}
      {nameOpen && <NameModal currentName={account?.displayName ?? null} onClose={() => setNameOpen(false)} />}
    </Card>
  )
}
