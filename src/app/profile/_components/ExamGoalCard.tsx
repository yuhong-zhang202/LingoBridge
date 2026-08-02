/**
 * @module   ExamGoalCard
 * @desc     备考目标卡 —— 渐进空态：未设目标→引导；有目标无日期→目标分 + 设置日期；两者齐→倒计时主角。
 *           数据经 useAccount 读 user_metadata（target_band / exam_date），编辑走 ExamGoalModal。
 * @author   LingoBridge
 * @created  2026-07-10
 */
'use client'
import { type JSX, useEffect, useState } from 'react'
import { CalendarDays, Target, Pencil } from 'lucide-react'
import Card from '@/components/Card'
import { useAccount } from '@/hooks/useAccount'
import ExamGoalModal from './ExamGoalModal'

// /profile?goal=1（首页目标分提醒 CTA 落点）自动打开编辑弹窗：模块级消费一次，防桌面/移动两个
// ExamGoalCard 实例（page 同时挂载两套视图）都读到 goal=1 而重复开两个弹窗。
let goalParamConsumed = false

/** 考试日展示：含年份，避免跨年日期歧义（lib/date 的 formatMonthDay 只给月日） */
const EXAM_DATE_FMT = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })

/** 'YYYY-MM-DD' → 本地零点 Date；格式不符返回 null（不用 new Date(str)，那按 UTC 解析会差一天） */
function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** 今天到考试日的整天数（按本地日历日比较，非时刻，跨时区/夏令时不差一天） */
function daysUntil(exam: Date): number {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((exam.getTime() - today.getTime()) / 86_400_000)
}

/** 卡片外壳：统一内边距 + 右上编辑按钮 */
function GoalShell({ onEdit, children }: { onEdit: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <Card className="relative px-6 py-5">
      <button
        onClick={onEdit}
        aria-label="编辑备考目标"
        className="absolute top-4 right-4 w-8 h-8 rounded-full grid place-items-center text-v2-text-muted hover:bg-bg-muted hover:text-v2-text-secondary transition-colors"
      >
        <Pencil size={14} />
      </button>
      {children}
    </Card>
  )
}

/**
 * 备考目标卡
 * @sideEffect 读 useAccount 共享账号态；编辑保存后经 USER_UPDATED 自动刷新
 */
export default function ExamGoalCard(): JSX.Element | null {
  const { account } = useAccount()
  const [editing, setEditing] = useState(false)

  // /profile?goal=1：自动打开编辑弹窗（用户从首页目标分提醒直落 Band 选择器）。只在客户端读 window.location.search
  //（不用 useSearchParams，免得给未包 Suspense 的 profile 页引入 Suspense 要求 / 构建报错）。
  // 消费后 replaceState 清掉 goal 参数，避免刷新/返回再次自动开；模块级 goalParamConsumed 保证两实例只开一次。
  useEffect(() => {
    if (goalParamConsumed || typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.get('goal') !== '1') return
    goalParamConsumed = true
    setEditing(true)
    url.searchParams.delete('goal')
    window.history.replaceState(null, '', url.pathname + url.search)
  }, [])

  // 账号未加载完（含 SSR 首帧）先不渲染：避免闪一次「设置目标」引导，也避免 hydration 失配
  if (!account) return null

  const { targetBand, examDate } = account
  const exam = examDate ? parseLocalDate(examDate) : null
  const days = exam ? daysUntil(exam) : null

  const modal = editing && (
    <ExamGoalModal targetBand={targetBand} examDate={examDate} onClose={() => setEditing(false)} />
  )

  // ① 未设目标：整卡是一个引导入口
  if (targetBand === null) {
    return (
      <>
        <Card className="px-6 py-5">
          <button onClick={() => setEditing(true)} className="w-full flex items-center gap-3 text-left">
            <span className="w-10 h-10 rounded-[12px] bg-brand-primary-light grid place-items-center text-brand-primary-dark flex-shrink-0">
              <Target size={18} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[0.9375rem] font-semibold text-v2-text-primary">设置你的备考目标 →</span>
              <span className="block text-[0.78125rem] text-v2-text-secondary mt-0.5">定个分数和考试日期，我们帮你盯着倒计时</span>
            </span>
          </button>
        </Card>
        {modal}
      </>
    )
  }

  const bandLabel = targetBand.toFixed(1)

  // ② 有目标、无日期：目标分为主，引导补考试日期
  if (exam === null || days === null) {
    return (
      <>
        <GoalShell onEdit={() => setEditing(true)}>
          <p className="text-[0.75rem] text-v2-text-secondary">备考目标</p>
          <p className="mt-1 text-[1.625rem] font-bold text-v2-text-primary leading-none tabular-nums">
            Band {bandLabel}
          </p>
          <button
            onClick={() => setEditing(true)}
            className="mt-3 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-primary-dark hover:opacity-80 transition-opacity"
          >
            <CalendarDays size={14} />设置考试日期
          </button>
        </GoalShell>
        {modal}
      </>
    )
  }

  const examLabel = EXAM_DATE_FMT.format(exam)

  // ③ 考试日已过：不再显示大倒计时，小字提示（提醒去更新目标）
  if (days < 0) {
    return (
      <>
        <GoalShell onEdit={() => setEditing(true)}>
          <p className="text-[0.75rem] text-v2-text-secondary">备考目标</p>
          <p className="mt-1 text-[1.625rem] font-bold text-v2-text-primary leading-none tabular-nums">
            Band {bandLabel}
          </p>
          <p className="mt-2.5 text-[0.75rem] text-v2-text-muted">考试日 {examLabel} 已过</p>
        </GoalShell>
        {modal}
      </>
    )
  }

  // ④ 齐活：倒计时是主角
  return (
    <>
      <GoalShell onEdit={() => setEditing(true)}>
        <p className="text-[0.75rem] text-v2-text-secondary">距离考试</p>
        {days === 0 ? (
          <p className="mt-1 text-[2rem] font-bold text-brand-primary-dark leading-none">就是今天</p>
        ) : (
          <p className="mt-1 flex items-baseline gap-1.5 text-brand-primary-dark">
            <span className="text-[2.5rem] font-bold leading-none tabular-nums">{days}</span>
            <span className="text-[0.9375rem] font-semibold">天</span>
          </p>
        )}
        <div className="mt-3.5 pt-3 border-t border-black/[0.05] flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[0.8125rem]">
          <span className="flex items-center gap-1.5 text-v2-text-secondary">
            <Target size={14} className="text-v2-text-muted" />
            目标 <b className="font-semibold text-v2-text-primary tabular-nums">Band {bandLabel}</b>
          </span>
          <span className="flex items-center gap-1.5 text-v2-text-secondary">
            <CalendarDays size={14} className="text-v2-text-muted" />
            {examLabel}
          </span>
        </div>
      </GoalShell>
      {modal}
    </>
  )
}
