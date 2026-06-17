/**
 * @module   LoginPage
 * @desc     登录页 — 邮箱验证码登录，匿名账号升级保留试用数据；底部同意说明 + 隐私政策链接
 * @author   LingoBridge
 * @created  2026-06-03
 */
'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Orb from '@/components/Orb'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import { sendEmailCode, verifyEmailCode } from '@/lib/auth'
import { useCountdown } from '@/hooks/useCountdown'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [code, setCode]         = useState('')
  const [emailErr, setEmailErr] = useState<string | null>(null)
  const [codeErr, setCodeErr]   = useState<string | null>(null)
  const [mode, setMode]         = useState<'convert' | 'login' | null>(null)
  const [sending, setSending]   = useState(false)
  const [logging, setLogging]   = useState(false)
  const { count, running, start } = useCountdown()

  const extractMsg = (e: unknown, fallback: string): string => {
    if (typeof e === 'object' && e !== null && 'message' in e) {
      return String((e as { message: unknown }).message)
    }
    return fallback
  }

  const handleSendCode = useCallback(async () => {
    setEmailErr(null)
    setCodeErr(null)
    setSending(true)
    try {
      const result = await sendEmailCode(email)
      setMode(result.mode)
      start(60)
    } catch (e) {
      setEmailErr(extractMsg(e, '发送失败，请重试'))
    } finally {
      setSending(false)
    }
  }, [email, start])

  const handleLogin = useCallback(async () => {
    setCodeErr(null)
    if (!mode) {
      setCodeErr('请先获取验证码')
      return
    }
    setLogging(true)
    try {
      await verifyEmailCode(email, code, mode)
      router.push('/')
    } catch (e) {
      setCodeErr(extractMsg(e, '登录失败，请重试'))
    } finally {
      setLogging(false)
    }
  }, [email, code, mode, router])

  const codeBtnDisabled = running || sending

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-7 pb-[8vh]">

        <Orb size={220} pulse={false} />

        <div className="text-center mt-6 mb-8">
          <h1 className="text-[20px] font-semibold text-v2-text-primary">
            欢迎来到 LingoBridge
          </h1>
          <p className="text-[13px] text-v2-text-secondary mt-1.5">
            绑定邮箱，保存你的练习进度
          </p>
        </div>

        <div className="w-full">

          {/* 邮箱输入框 */}
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="请输入邮箱"
            autoComplete="email"
            className="w-full bg-white border border-[#EEEEEE] rounded-[16px] px-4 py-3.5 text-[15px] text-v2-text-primary placeholder:text-[#CCCCCC] outline-none focus:border-brand-primary transition-colors mb-3"
          />
          {emailErr && (
            <p className="text-[12px] text-error -mt-2 mb-2 px-1">{emailErr}</p>
          )}

          {/* 验证码行 */}
          <div className="flex gap-2">
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="验证码"
              className="flex-1 bg-white border border-[#EEEEEE] rounded-[16px] px-4 py-3.5 text-[15px] text-v2-text-primary placeholder:text-[#CCCCCC] outline-none focus:border-brand-primary transition-colors"
            />
            <button
              onClick={() => void handleSendCode()}
              disabled={codeBtnDisabled}
              className={`rounded-full px-4 py-3.5 text-[12px] font-medium whitespace-nowrap active:scale-[0.97] transition-all duration-150 ${
                codeBtnDisabled
                  ? 'bg-[#EEEEEE] text-[#CCCCCC] cursor-not-allowed'
                  : 'text-v2-text-secondary'
              }`}
              style={codeBtnDisabled ? undefined : GRADIENT_BORDER_STYLE}
            >
              {running ? `${count}s 后重发` : '发送验证码'}
            </button>
          </div>
          {codeErr && (
            <p className="text-[12px] text-error mt-1.5 px-1">{codeErr}</p>
          )}

          {/* 登录按钮 */}
          <button
            onClick={() => void handleLogin()}
            disabled={logging}
            className="btn-gradient w-full h-[50px] mt-5 disabled:opacity-50"
          >
            {logging ? '登录中…' : '登录'}
          </button>

          {/* 同意说明 */}
          <p className="text-[12px] text-v2-text-muted text-center mt-3 leading-relaxed">
            继续即表示同意我们的
            <Link href="/privacy" className="text-brand-primary underline">《隐私政策》</Link>
            。我们仅用邮箱保存你的学习进度。
          </p>

          {/* 暂不登录 */}
          <div className="flex justify-center mt-2">
            <button
              onClick={() => router.push('/')}
              className="text-[13px] text-v2-text-muted"
            >
              暂不登录，先看看
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
