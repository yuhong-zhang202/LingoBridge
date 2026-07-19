/**
 * @module   ResetPasswordPage
 * @desc     重置密码 — 用户从邮件链接进入，Supabase JS 自动处理 URL 中的 recovery token
 *           并建立临时会话；本页让用户设新密码并保存。
 * @author   LingoBridge
 * @created  2026-06-17
 */
'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import TopBar from '@/components/TopBar'
import GradientButton from '@/components/GradientButton'
import { updatePassword } from '@/lib/auth'
import { getSupabase } from '@/lib/supabase'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [hasRecoverySession, setHasRecoverySession] = useState<boolean | null>(null)
  const [pwd, setPwd]         = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]       = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  // 入页后等 Supabase 处理 URL 里的 recovery token；同时兜底读一次 getSession
  useEffect(() => {
    const supabase = getSupabase()
    let resolved = false

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        resolved = true
        setHasRecoverySession(true)
      }
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!resolved) setHasRecoverySession(!!session)
    })

    return () => { sub.subscription.unsubscribe() }
  }, [])

  const extractMsg = (e: unknown, fallback: string): string => {
    if (typeof e === 'object' && e !== null && 'message' in e) {
      return String((e as { message: unknown }).message)
    }
    return fallback
  }

  const handleSubmit = useCallback(async () => {
    setErr(null)
    setSubmitting(true)
    try {
      await updatePassword(pwd)
      setDone(true)
      setTimeout(() => router.replace('/login'), 1200)
    } catch (e) {
      setErr(extractMsg(e, '设置失败，请重新打开重置链接'))
    } finally {
      setSubmitting(false)
    }
  }, [pwd, router])

  return (
    <div className="relative h-dvh overflow-hidden bg-bg-page flex flex-col">
      <TopBar title="重置密码" />

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-10 relative z-10">
        {hasRecoverySession === null && (
          <p className="text-[13px] text-v2-text-muted text-center pt-16">加载中…</p>
        )}

        {hasRecoverySession === false && (
          <div className="pt-16 text-center">
            <p className="text-[14px] text-v2-text-primary mb-2">链接已失效</p>
            <p className="text-[13px] text-v2-text-muted leading-relaxed">
              请重新发起重置：返回登录页 → 「忘记密码？」
            </p>
            <div className="mt-5 flex justify-center">
              <GradientButton onClick={() => router.replace('/login')} className="px-6 py-2.5 rounded-full text-[14px] font-medium">
                返回登录
              </GradientButton>
            </div>
          </div>
        )}

        {hasRecoverySession === true && !done && (
          <div className="pt-6">
            <p className="text-[13px] text-v2-text-secondary mb-3">为你的账号设置新密码（至少 6 位）。</p>
            <div className="relative mb-2">
              <input
                type={showPwd ? 'text' : 'password'}
                value={pwd}
                onChange={e => setPwd(e.target.value)}
                placeholder="新密码"
                autoComplete="new-password"
                className="w-full bg-white border border-neutral-line rounded-[16px] pl-4 pr-12 py-3.5 text-[15px] text-v2-text-primary placeholder:text-neutral-mute outline-none focus:border-brand-primary transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                aria-label={showPwd ? '隐藏密码' : '显示密码'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-v2-text-muted"
              >
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {err && <p className="text-[12px] text-error mt-1 mb-2 px-1">{err}</p>}
            <GradientButton
              onClick={() => void handleSubmit()}
              disabled={submitting}
              className="w-full h-[48px] mt-4 rounded-full text-[14px] font-medium"
            >
              {submitting ? '保存中…' : '保存新密码'}
            </GradientButton>
          </div>
        )}

        {done && (
          <p className="text-[14px] text-v2-text-primary text-center pt-16">
            ✓ 密码已更新，正在返回登录…
          </p>
        )}
      </div>
    </div>
  )
}
