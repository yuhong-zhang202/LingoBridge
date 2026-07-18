/**
 * @module   QuotaModal
 * @desc     本月额度详情弹窗 — 对额度卡的补充说明（重置日期 + 两类额度含义），不重复渲染卡内进度数字
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { type JSX } from 'react'
import { CalendarClock } from 'lucide-react'
import ProfileModal from './ProfileModal'
import { nextMonthFirstLabel } from '@/lib/date'
import { STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import { IELTS_MONTHLY_LIMIT } from '@/lib/db/practice-sessions'

/**
 * 本月额度详情弹窗
 * @param onClose 关闭回调
 */
export default function QuotaModal({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <ProfileModal title="本月额度" onClose={onClose} className="max-w-[400px]">
      <div className="flex items-center gap-3 rounded-[12px] bg-bg-muted px-4 py-3">
        <CalendarClock size={18} className="text-brand-primary-dark shrink-0" />
        <div>
          <p className="text-[13px] font-medium text-v2-text-primary">{nextMonthFirstLabel()} 重置</p>
          <p className="text-[12px] text-v2-text-muted mt-0.5">每月额度会在这天清零，重新开始计数</p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 text-[13px] text-v2-text-secondary leading-relaxed">
        <p>
          <b className="font-semibold text-v2-text-primary">故事练习</b>
          ：每月可整理并匹配 {STORY_MONTHLY_LIMIT} 段新故事。
        </p>
        <p>
          <b className="font-semibold text-v2-text-primary">题目练习</b>
          ：每月可复练 {IELTS_MONTHLY_LIMIT} 道已匹配到的题目。
        </p>
      </div>
    </ProfileModal>
  )
}
