/**
 * @module   IdentityCard
 * @desc     「我的」身份卡 — 可点击头像(更换) + 邮箱 + 备考目标/加入天数 + 编辑资料；底部分隔线内统计条(打卡/语料/练习)
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { useEffect, useState } from 'react'
import { Flame, MessageCircle, Target } from 'lucide-react'
import Card from '@/components/Card'
import GradientButton from '@/components/GradientButton'
import OrbAvatar from './OrbAvatar'
import AvatarModal from './AvatarModal'
import { listMyCorpus } from '@/lib/db/corpus'
import { getStreak, getPracticeCount } from '@/lib/db/practice-sessions'

interface IdentityCardProps {
  displayName: string
  targetBand: number
  /** 加入天数；null 时不展示该项 */
  joinDays: number | null
  onEdit: () => void
}

/**
 * 身份卡
 * @param displayName 脱敏邮箱 / 账号名
 * @param targetBand  备考目标 band
 * @param joinDays    加入天数
 * @param onEdit      「编辑资料」点击回调
 * @sideEffect        挂载时并行读取连续打卡 / 语料段数 / 练习次数
 */
export default function IdentityCard({ displayName, targetBand, joinDays, onEdit }: IdentityCardProps): JSX.Element {
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [streak, setStreak] = useState(0)
  const [corpus, setCorpus] = useState(0)
  const [practice, setPractice] = useState(0)

  useEffect(() => {
    Promise.all([getStreak(), listMyCorpus(), getPracticeCount()])
      .then(([s, c, p]) => { setStreak(s); setCorpus(c.length); setPractice(p) })
      .catch((err: unknown) => console.warn('[ProfilePage] 身份卡数据加载失败', err))
  }, [])

  const meta = [`备考目标 Band ${targetBand.toFixed(1)}`]
  if (joinDays !== null) meta.push(`已加入 ${joinDays} 天`)

  return (
    <Card className="px-7 py-6 mb-6">
      <div className="flex items-center gap-5">
        <button
          onClick={() => setAvatarOpen(true)}
          aria-label="更换头像"
          className="shrink-0 rounded-full active:scale-[0.97] transition-transform"
        >
          <OrbAvatar size={64} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[16px] font-semibold text-v2-text-primary truncate">{displayName}</p>
          <p className="text-[13px] text-v2-text-muted mt-1">{meta.join(' · ')}</p>
        </div>
        <GradientButton onClick={onEdit} className="shrink-0 px-5 py-2.5 rounded-full text-[13px] font-medium">
          编辑资料
        </GradientButton>
      </div>

      <div className="mt-5 pt-4 border-t border-black/[0.05] flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-v2-text-secondary">
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
    </Card>
  )
}
