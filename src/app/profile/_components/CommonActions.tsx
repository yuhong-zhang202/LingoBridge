/**
 * @module   CommonActions
 * @desc     「常用操作」区 — 修改密码 / 本月额度 / 意见反馈 三张等宽任务卡 + 各自弹窗
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { useState, type ReactNode } from 'react'
import { KeyRound, MessageSquare } from 'lucide-react'
import Card from '@/components/Card'
import FeedbackPopup from '@/components/FeedbackPopup'
import QuotaActionCard from './QuotaActionCard'
import QuotaModal from './QuotaModal'
import PasswordModal from './PasswordModal'

interface ActionCardProps {
  icon: ReactNode
  iconBg: string
  title: string
  subtitle: string
  onClick: () => void
}

function ActionCard({ icon, iconBg, title, subtitle, onClick }: ActionCardProps): JSX.Element {
  return (
    <button onClick={onClick} className="text-left w-full h-full">
      <Card className="p-5 h-full flex flex-col transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]">
        <div className={`w-9 h-9 rounded-[10px] ${iconBg} flex items-center justify-center mb-3`}>{icon}</div>
        <div className="text-[14px] font-semibold text-v2-text-primary mb-1">{title}</div>
        <div className="text-[12px] text-v2-text-muted">{subtitle}</div>
      </Card>
    </button>
  )
}

type ModalKey = null | 'password' | 'quota' | 'feedback'

/**
 * 常用操作区
 * @param email 当前账号邮箱（传给修改密码弹窗校验）
 */
export default function CommonActions({ email }: { email: string | null }): JSX.Element {
  const [modal, setModal] = useState<ModalKey>(null)

  return (
    <div>
      <div className="text-[12px] font-medium text-v2-text-muted mb-2.5 px-1">常用操作</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-stretch">
        <QuotaActionCard onOpen={() => setModal('quota')} />
        <ActionCard
          icon={<KeyRound size={16} className="text-brand-primary-dark" />}
          iconBg="bg-brand-primary-light"
          title="修改密码"
          subtitle="更新你的登录密码"
          onClick={() => setModal('password')}
        />
        <ActionCard
          icon={<MessageSquare size={16} className="text-v2-text-secondary" />}
          iconBg="bg-bg-muted"
          title="意见反馈"
          subtitle="告诉我们哪里不好用"
          onClick={() => setModal('feedback')}
        />
      </div>

      {modal === 'password' && <PasswordModal email={email} onClose={() => setModal(null)} />}
      {modal === 'quota' && <QuotaModal onClose={() => setModal(null)} />}
      <FeedbackPopup open={modal === 'feedback'} onClose={() => setModal(null)} source="profile" />
    </div>
  )
}
