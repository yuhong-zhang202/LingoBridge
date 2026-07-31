/**
 * @module   LoginPage
 * @desc     登录页 — 邮箱 + 密码（不发验证码）。注册升级匿名账号保住试用数据；
 *           老用户登录走 signInWithPassword；忘记密码触发重置邮件 → /reset-password。
 * @author   LingoBridge
 * @created  2026-06-03
 */
'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useNav } from '@/components/NavProgress'
import ProgressLink from '@/components/ProgressLink'
import { Eye, EyeOff } from 'lucide-react'
import Orb from '@/components/Orb'
import FeedbackPopup from '@/components/FeedbackPopup'
import GradientButton from '@/components/GradientButton'
import {
  registerWithPassword,
  loginWithPassword,
  sendPasswordReset,
} from '@/lib/auth'

type Mode = 'register' | 'login'

export default function LoginPage() {
  const router = useRouter()
  const { navigate } = useNav() // 「暂不登录，先看看」跳首页走 navigate 亮进度条；登录成功后的重定向仍用 router
  const [mode, setMode]   = useState<Mode>('register')
  const [email, setEmail] = useState('')
  const [pwd, setPwd]     = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [err, setErr]     = useState<string | null>(null)
  const [info, setInfo]   = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [forgotOpen, setForgotOpen] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetMsg,   setResetMsg]   = useState<string | null>(null)
  const [resetting,  setResetting]  = useState(false)
  const [contactOpen, setContactOpen] = useState(false)

  const extractMsg = (e: unknown, fallback: string): string => {
    if (typeof e === 'object' && e !== null && 'message' in e) {
      return String((e as { message: unknown }).message)
    }
    return fallback
  }
  const extractCode = (e: unknown): string | null => {
    if (typeof e === 'object' && e !== null && 'code' in e) {
      const c = (e as { code: unknown }).code
      return typeof c === 'string' ? c : null
    }
    return null
  }

  const switchMode = (m: Mode) => {
    setMode(m); setErr(null); setInfo(null)
  }

  const handleSubmit = useCallback(async () => {
    setErr(null); setInfo(null)
    setSubmitting(true)
    try {
      if (mode === 'register') {
        await registerWithPassword(email, pwd)
      } else {
        await loginWithPassword(email, pwd)
      }
      router.push('/')
    } catch (e) {
      if (extractCode(e) === 'EMAIL_EXISTS') {
        setMode('login')
        setInfo('该邮箱已注册，已切换到登录。请输入密码后登录。')
      } else {
        setErr(extractMsg(e, mode === 'register' ? '创建账号失败' : '登录失败'))
      }
    } finally {
      setSubmitting(false)
    }
  }, [mode, email, pwd, router])

  const handleSendReset = useCallback(async () => {
    setResetMsg(null)
    setResetting(true)
    try {
      await sendPasswordReset(resetEmail)
      setResetMsg('重置链接已发到你的邮箱，请查收（也看下垃圾箱）。仍收不到？请到「我的 → 帮助与反馈」联系我们手动重置。')
    } catch (e) {
      setResetMsg(extractMsg(e, '发送失败，请稍后再试'))
    } finally {
      setResetting(false)
    }
  }, [resetEmail])

  return (
    <div className="relative min-h-dvh bg-bg-page flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-7 pb-[8vh]">

        <Orb size={220} pulse={false} />

        <div className="text-center mt-6 mb-6">
          <h1 className="text-[20px] font-semibold text-v2-text-primary">
            欢迎来到 LingoBridge
          </h1>
          <p className="text-[13px] text-v2-text-secondary mt-1.5">
            {mode === 'register' ? '创建账号，保存你的练习进度' : '登录'}
          </p>
        </div>

        {/* mode 切换 */}
        <div className="flex justify-center gap-1 mb-5 bg-bg-muted rounded-full p-1 w-[240px]">
          {(['register', 'login'] as const).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`flex-1 text-[13px] py-1.5 rounded-full transition-colors ${
                mode === m ? 'bg-white text-v2-text-primary font-semibold shadow-sm' : 'text-v2-text-muted'
              }`}
            >
              {m === 'register' ? '创建账号' : '登录'}
            </button>
          ))}
        </div>

        <div className="w-full max-w-[400px] mx-auto">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="邮箱"
            autoComplete="email"
            className="w-full bg-white border border-neutral-line rounded-[16px] px-4 py-3.5 text-[16px] text-v2-text-primary placeholder:text-neutral-mute outline-none focus:border-brand-primary transition-colors mb-3"
          />

          <div className="relative mb-1.5">
            <input
              type={showPwd ? 'text' : 'password'}
              value={pwd}
              onChange={e => setPwd(e.target.value)}
              placeholder="密码（至少 6 位）"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              className="w-full bg-white border border-neutral-line rounded-[16px] pl-4 pr-12 py-3.5 text-[16px] text-v2-text-primary placeholder:text-neutral-mute outline-none focus:border-brand-primary transition-colors"
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

          {info && <p className="text-[12px] text-v2-text-secondary mt-1 mb-1.5 px-1">{info}</p>}
          {err && <p className="text-[12px] text-error mt-1 mb-1.5 px-1">{err}</p>}

          {/* 忘记密码（仅登录模式） */}
          {mode === 'login' && (
            <div className="flex justify-end mt-1 mb-2">
              <button
                onClick={() => { setForgotOpen(true); setResetEmail(email); setResetMsg(null) }}
                className="text-[12px] text-v2-text-muted active:opacity-60"
              >
                忘记密码？
              </button>
            </div>
          )}

          {/* GradientButton（升级自原裸 btn-gradient）：loading 时自带 spinner + 禁用 + aria-busy，
              提交注册/登录期间转圈，读屏也能听到「处理中」。 */}
          <GradientButton
            onClick={() => void handleSubmit()}
            loading={submitting}
            className="w-full h-[50px] mt-4 flex items-center justify-center rounded-full text-[14px] font-semibold"
          >
            {submitting ? '处理中…' : (mode === 'register' ? '创建账号' : '登录')}
          </GradientButton>

          <p className="text-[12px] text-v2-text-muted text-center mt-3 leading-relaxed">
            继续即表示同意我们的
            <ProgressLink href="/privacy" className="text-brand-primary underline">《隐私政策》</ProgressLink>
            。我们仅用邮箱保存你的学习进度。
          </p>

          <div className="flex justify-center mt-2">
            <button onClick={() => navigate('/')} className="text-[13px] text-v2-text-muted">
              暂不登录，先看看
            </button>
          </div>
        </div>
      </div>

      {/* 忘记密码模态 */}
      {forgotOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setForgotOpen(false)}>
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-[430px] bg-white rounded-t-[20px] px-5 pt-5 animate-fade-up"
            style={{ paddingBottom: 'calc(28px + env(safe-area-inset-bottom))' }}
          >
            <h3 className="text-[16px] font-semibold text-v2-text-primary text-center mb-2">重置密码</h3>
            <p className="text-[12px] text-v2-text-muted text-center mb-3">填邮箱，发送重置链接到你的邮箱</p>
            <input
              type="email"
              value={resetEmail}
              onChange={e => setResetEmail(e.target.value)}
              placeholder="邮箱"
              autoComplete="email"
              className="w-full bg-white border border-neutral-line rounded-[16px] px-4 py-3.5 text-[16px] text-v2-text-primary placeholder:text-neutral-mute outline-none focus:border-brand-primary transition-colors mb-3"
            />
            {resetMsg && <p className="text-[12px] text-v2-text-secondary leading-relaxed mb-2 px-1">{resetMsg}</p>}
            <div className="flex justify-center mb-3">
              <button
                onClick={() => { setForgotOpen(false); setContactOpen(true) }}
                className="text-[12px] text-brand-primary underline active:opacity-60"
              >
                仍收不到？联系开发者人工重置
              </button>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setForgotOpen(false)}
                className="btn-ghost flex-1 h-[48px] active:scale-[0.97] transition-transform duration-150"
              >
                关闭
              </button>
              <GradientButton
                onClick={() => void handleSendReset()}
                loading={resetting}
                className="flex-1 h-[48px] flex items-center justify-center rounded-full text-[14px] font-semibold"
              >
                {resetting ? '发送中…' : '发送重置链接'}
              </GradientButton>
            </div>
          </div>
        </div>
      )}

      <FeedbackPopup open={contactOpen} onClose={() => setContactOpen(false)} source="password" />
    </div>
  )
}
