/**
 * @module   ExamGoalModal
 * @desc     备考目标编辑弹窗 —— 目标 Band（4.0–9.0 步进 0.5）+ 考试日期（可清空）。
 *           保存写 user_metadata，useAccount 经 USER_UPDATED 自动刷新卡片。壳复用 ProfileModal。
 *           已存的考试日期即使已过期也允许原样保存（陈旧≠非法），否则用户会被锁死在弹窗里连目标分都改不了。
 *           埋点：保存成功/失败各发一条 auth.goal_saved / auth.goal_save_failed（2026-08-07 补）——
 *           保存走客户端直连 supabase updateUser、【不经过我方任何 API】，服务端零痕迹，
 *           这两条事件是这条路成败率的唯一观测渠道。fire-and-forget，绝不影响保存主链路。
 * @author   LingoBridge
 * @created  2026-07-10
 */
'use client'
import { type JSX, useState } from 'react'
import GradientButton from '@/components/GradientButton'
import ProfileModal from './ProfileModal'
import { saveExamGoal } from '@/lib/auth'
import { track } from '@/lib/client-events'
import { GOAL_BAND, type GoalBand, type GoalSaveFailReason } from '@/lib/event-schema'

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

/**
 * 目标分数字 → 埋点枚举串（6.5 → '6.5'）。埋点专用，不参与保存。
 * 不在 GOAL_BAND 枚举里（将来 UI 改了步进）返回 undefined，该字段随之缺失 ——
 * 缺一个字段在看板上看得见，塞一个近似假值看不见。
 * @param  b  目标分（4.0–9.0 步进 0.5）
 * @returns   枚举串，非枚举值返回 undefined
 */
function bandCode(b: number): GoalBand | undefined {
  const s = b.toFixed(1)
  return (GOAL_BAND as readonly string[]).includes(s) ? (s as GoalBand) : undefined
}

/**
 * 保存异常 → 失败原因 code。埋点专用，不改任何错误处理与文案。
 * 只认 saveExamGoal 抛出的 AppError.code，其余一律 'unknown' ——
 * 【绝不把 error.message 上报】：那是自由文本，可能带邮箱等身份信息（隐私铁律）。
 * @param  e  catch 到的异常
 * @returns   收敛后的原因 code
 */
function failReasonOf(e: unknown): GoalSaveFailReason {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : ''
  return code === 'SAVE_FAILED' ? 'update_failed' : 'unknown'
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
  // 首次设置 vs 修改：入参 targetBand 为 null 即此前没设过。用挂载时的 prop 而非 state，
  // 保存成功后 prop 会被刷新，事后再读就恒为「修改」了（同 auth.registered 的 fromAnonymous 之坑）。
  const isFirstTime = targetBand === null

  // 日期下限：已存过的过期日期算「陈旧数据」而非「非法数据」，不能因为它把用户锁死在弹窗里连目标分都改不了。
  // 只由 props examDate 推导、不由可变的 date state 推导——否则用户一清空，下限就跳回今天、来回变。
  // 'YYYY-MM-DD' 是定长格式，字符串字典序比较等价于日期比较。
  const dateFloor = examDate !== null && examDate < todayLocalISO() ? examDate : todayLocalISO()

  async function handleSave(): Promise<void> {
    setErr(null)
    // 可见守卫：早于下限时给红字提示并停在弹窗内，绝不静默失败（原生校验那条路已由 noValidate 关掉）
    if (date !== '' && date < dateFloor) {
      setErr('这个日期太早了。请选今天或之后的日期，或点输入框右边的「清除」先不填。')
      // 这也是一次「用户点了保存却没存成」，与后端失败同等重要，照样记一条。
      // 埋点必须挂在【这里】而不是 input 的 onInvalid 上：form 有 noValidate，浏览器不再跑原生
      // 约束校验、永不派发 invalid 事件，挂那儿等于一条永远记不到的死枚举。
      track('auth.goal_save_failed', { reason: 'date_before_min', isFirstTime })
      return
    }
    setSaving(true)
    try {
      await saveExamGoal({ targetBand: band, examDate: date === '' ? null : date })
      // 埋点一律排在用户可见动作【之后】，且 fire-and-forget（track 不返回 Promise、不进条件、
      // 不影响任何分支）—— 保存主链路与错误文案绝不因埋点而变。
      // 这条路不经过我方 API、服务端零痕迹，本事件是成败率的唯一来源（见 event-schema 该条目）。
      onClose()
      track('auth.goal_saved', { band: bandCode(band), hasDate: date !== '', isFirstTime })
    } catch (e) {
      setErr(messageOf(e))
      track('auth.goal_save_failed', { reason: failReasonOf(e), isFirstTime })
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
