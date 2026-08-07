/**
 * @module   ExamGoalModal
 * @desc     备考目标编辑弹窗 —— 目标 Band（4.0–9.0 步进 0.5）+ 考试日期（可清空）。
 *           保存写 user_metadata，useAccount 经 USER_UPDATED 自动刷新卡片。壳复用 ProfileModal。
 *           已存的考试日期即使已过期也允许原样保存（陈旧≠非法），否则用户会被锁死在弹窗里连目标分都改不了。
 * @author   LingoBridge
 * @created  2026-07-10
 */
'use client'
import { type JSX, useState } from 'react'
import GradientButton from '@/components/GradientButton'
import ProfileModal from './ProfileModal'
import { saveExamGoal } from '@/lib/auth'

/** 4.0–9.0 步进 0.5 */
const BANDS: number[] = Array.from({ length: 11 }, (_, i) => 4 + i * 0.5)
/** 未设过时的默认高亮 */
const DEFAULT_BAND = 6.5

function messageOf(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message)
  }
  return '出了点问题，请稍后再试'
}

/** 今天的本地 'YYYY-MM-DD'（作 input[type=date] 的 min；不能用 toISOString，那是 UTC 会差一天） */
function todayLocalISO(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

interface ExamGoalModalProps {
  /** 当前已存的目标分（null=未设过，默认高亮 6.5） */
  targetBand: number | null
  /** 当前已存的考试日期 'YYYY-MM-DD'（null=未设） */
  examDate: string | null
  onClose: () => void
}

/**
 * 备考目标编辑弹窗
 * @param targetBand 当前目标分
 * @param examDate   当前考试日期
 * @param onClose    关闭回调
 * @sideEffect       保存时 updateUser 写 user_metadata
 */
export default function ExamGoalModal({ targetBand, examDate, onClose }: ExamGoalModalProps): JSX.Element {
  const [band, setBand] = useState<number>(targetBand ?? DEFAULT_BAND)
  const [date, setDate] = useState<string>(examDate ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 日期下限：已存过的过期日期算「陈旧数据」而非「非法数据」，不能因为它把用户锁死在弹窗里连目标分都改不了。
  // 只由 props examDate 推导、不由可变的 date state 推导——否则用户一清空，下限就跳回今天、来回变。
  // 'YYYY-MM-DD' 是定长格式，字符串字典序比较等价于日期比较。
  const dateFloor = examDate !== null && examDate < todayLocalISO() ? examDate : todayLocalISO()

  async function handleSave(): Promise<void> {
    setErr(null)
    // 可见守卫：早于下限时给红字提示并停在弹窗内，绝不静默失败（原生校验那条路已由 noValidate 关掉）
    if (date !== '' && date < dateFloor) {
      setErr('这个日期太早了。请选今天或之后的日期，或点输入框右边的「清除」先不填。')
      return
    }
    setSaving(true)
    try {
      await saveExamGoal({ targetBand: band, examDate: date === '' ? null : date })
      onClose()
    } catch (e) {
      setErr(messageOf(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ProfileModal title="备考目标" onClose={onClose} className="max-w-[400px]">
      {/* 单一提交控件：日期框内按 Enter 即可提交（Band 按钮均为 type=button，不会误提交）
          noValidate：原生约束校验（如 input[min]）会在 fire submit 事件「之前」就取消提交，onSubmit 压根不执行，
          用户看到的只是「点了没反应」。这类静默失败一律关掉——提交与否由下面的 JS 判断，拦下必给可见提示 */}
      <form noValidate onSubmit={(e) => { e.preventDefault(); void handleSave() }}>
        <div role="group" aria-label="目标分数">
          <p className="text-[0.75rem] text-v2-text-secondary mb-2">目标分数</p>
          <div className="grid grid-cols-4 gap-2">
            {BANDS.map((b) => {
              const selected = b === band
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBand(b)}
                  aria-pressed={selected}
                  className={
                    `h-9 rounded-[10px] text-[0.8125rem] font-medium tabular-nums transition-colors ` +
                    (selected
                      ? 'bg-brand-primary-light text-brand-primary-dark border border-brand-primary'
                      : 'bg-bg-surface text-v2-text-secondary border border-black/[0.08] hover:bg-bg-muted')
                  }
                >
                  {b.toFixed(1)}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-5">
          <label htmlFor="exam-date" className="text-[0.75rem] text-v2-text-secondary mb-1.5 block">
            考试日期<span className="text-v2-text-muted">（可留空）</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              id="exam-date"
              name="exam-date"
              type="date"
              value={date}
              /* 保留 min 是有意的：原生日期选择器仍会把更早的日期灰掉；有 noValidate 兜底，它不再能静默阻断提交 */
              min={dateFloor}
              onChange={(e) => setDate(e.target.value)}
              className="flex-1 h-[40px] px-3.5 rounded-[10px] border border-black/[0.1] text-[1rem] lg:text-[0.8125rem] text-v2-text-primary bg-bg-surface outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 transition-colors"
            />
            {date !== '' && (
              <button
                type="button"
                onClick={() => setDate('')}
                className="text-[0.8125rem] text-v2-text-muted hover:text-v2-text-primary px-2 py-1 rounded-[8px] transition-colors"
              >
                清除
              </button>
            )}
          </div>
        </div>

        {err && <p role="alert" className="text-[0.75rem] text-error mt-3 px-1">{err}</p>}

        {/* 必须显式 type="submit"：GradientButton 默认 type="button"（全站 CTA 多在 form 外，默认值防误提交），
            不写就退化成普通按钮、onSubmit 永不触发＝「点了没反应」。
            不传 onClick：让点击与 Enter 同走 onSubmit，避免双触发 */}
        <GradientButton
          type="submit"
          disabled={saving}
          loading={saving}
          className="w-full mt-5 py-3 rounded-full text-[0.875rem] font-medium disabled:cursor-not-allowed"
        >
          {saving ? '保存中…' : '保存目标'}
        </GradientButton>
      </form>
    </ProfileModal>
  )
}
