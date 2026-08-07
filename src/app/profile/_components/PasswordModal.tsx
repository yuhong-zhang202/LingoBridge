/**
 * @module   PasswordModal
 * @desc     修改密码弹窗 — 当前 / 新 / 确认三输入框；校验当前密码后更新（复用 lib/auth 现有能力）
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { type JSX, useState } from 'react'
import { Check } from 'lucide-react'
import GradientButton from '@/components/GradientButton'
import ProfileModal from './ProfileModal'
import { loginWithPassword, updatePassword } from '@/lib/auth'

const PASSWORD_MIN = 6
const INPUT_CLASS =
  'w-full h-[40px] px-3.5 rounded-[10px] border border-black/[0.1] text-[1rem] lg:text-[0.8125rem] text-v2-text-primary placeholder:text-v2-text-muted outline-none focus:border-brand-primary transition-colors'

interface PasswordModalProps {
  /** 当前账号邮箱，用于校验当前密码；为 null 时跳过校验 */
  email: string | null
  onClose: () => void
}

function extractMessage(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message)
  }
  return '修改失败，请稍后再试'
}

/**
 * 修改密码弹窗
 * @param email    当前账号邮箱（校验当前密码用）
 * @param onClose  关闭回调
 * @sideEffect     成功后调用 updatePassword 更新 Supabase 账号密码
 */
export default function PasswordModal({ email, onClose }: PasswordModalProps): JSX.Element {
  const [current, setCurrent] = useState('')
  const [next, setNext]       = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const canSubmit = current.length > 0 && next.length >= PASSWORD_MIN && confirm.length > 0 && !submitting

  async function handleSave(): Promise<void> {
    setErr(null)
    if (next !== confirm) { setErr('两次输入的新密码不一致'); return }
    if (next.length < PASSWORD_MIN) { setErr(`新密码至少 ${PASSWORD_MIN} 位`); return }
    setSubmitting(true)
    try {
      // 先用当前密码重新登录校验身份，再更新为新密码
      if (email) await loginWithPassword(email, current)
      await updatePassword(next)
      setDone(true)
      window.setTimeout(onClose, 1200)
    } catch (e) {
      const msg = extractMessage(e)
      setErr(msg === '邮箱或密码错误' ? '当前密码不正确' : msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ProfileModal title="修改密码" onClose={onClose}>
      {done ? (
        <div className="flex flex-col items-center py-4">
          <Check size={28} className="text-brand-accent mb-2" />
          <p className="text-[0.875rem] text-v2-text-primary">密码已更新</p>
        </div>
      ) : (
        // form + onSubmit：输入框内按 Enter 即可提交；提交按钮须显式 type="submit"（见下方注释）
        <form onSubmit={(e) => { e.preventDefault(); void handleSave() }}>
          <div className="flex flex-col gap-3.5">
            <div>
              <label htmlFor="pwd-current" className="text-[0.75rem] text-v2-text-secondary mb-1.5 block">当前密码</label>
              <input id="pwd-current" name="current-password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password" placeholder="输入当前密码" className={INPUT_CLASS} />
            </div>
            <div>
              <label htmlFor="pwd-new" className="text-[0.75rem] text-v2-text-secondary mb-1.5 block">新密码</label>
              <input id="pwd-new" name="new-password" type="password" value={next} onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password" placeholder={`至少 ${PASSWORD_MIN} 位字符`} className={INPUT_CLASS} />
            </div>
            <div>
              <label htmlFor="pwd-confirm" className="text-[0.75rem] text-v2-text-secondary mb-1.5 block">确认新密码</label>
              <input id="pwd-confirm" name="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password" placeholder="再次输入新密码" className={INPUT_CLASS} />
            </div>
          </div>

          {err && <p role="alert" className="text-[0.75rem] text-error mt-2 px-1">{err}</p>}

          {/* 必须显式 type="submit"：GradientButton 默认 type="button"（全站 CTA 多在 form 外，默认值防误提交），
              不写就退化成普通按钮、onSubmit 永不触发＝「点了没反应」。
              不传 onClick：让点击与 Enter 同走 onSubmit，避免双触发 */}
          <GradientButton type="submit" disabled={!canSubmit}
            className="w-full mt-5 py-3 rounded-full text-[0.875rem] font-medium disabled:cursor-not-allowed">
            {submitting ? '保存中…' : '保存修改'}
          </GradientButton>
        </form>
      )}
    </ProfileModal>
  )
}
