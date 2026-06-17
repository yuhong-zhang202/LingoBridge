/**
 * @module   LoginPage
 * @desc     登录页 — 手机号验证码登录（Twilio Verify），匿名账号升级保留试用数据；底部同意说明 + 隐私政策链接
 * @author   LingoBridge
 * @created  2026-06-03
 */
'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Orb from '@/components/Orb'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import { sendPhoneCode, verifyPhoneCode } from '@/lib/auth'
import { useCountdown } from '@/hooks/useCountdown'

/** 把用户输入归一化为 E.164：以 '+' 起头视为完整国际号；否则默认中国大陆 +86 并去前导 0。 */
function toE164(raw: string): string {
  const cleaned = raw.replace(/[\s-]/g, '')
  if (cleaned.startsWith('+')) return cleaned
  return `+86${cleaned.replace(/^0+/, '')}`
}

export default function LoginPage() {
  const router = useRouter()
  const [phone, setPhone]       = useState('')
  const [code, setCode]         = useState('')
  const [phoneErr, setPhoneErr] = useState<string | null>(null)
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
    setPhoneErr(null)
    setCodeErr(null)
    setSending(true)
    try {
      const result = await sendPhoneCode(toE164(phone))
      setMode(result.mode)
      start(60)
    } catch (e) {
      setPhoneErr(extractMsg(e, '发送失败，请重试'))
    } finally {
      setSending(false)
    }
  }, [phone, start])

  const handleLogin = useCallback(async () => {
    setCodeErr(null)
    if (!mode) {
      setCodeErr('请先获取验证码')
      return
    }
    setLogging(true)
    try {
      await verifyPhoneCode(toE164(phone), code, mode)
      router.push('/')
    } catch (e) {
      setCodeErr(extractMsg(e, '登录失败，请重试'))
    } finally {
      setLogging(false)
    }
  }, [phone, code, mode, router])

  const codeBtnDisabled = running || sending
  const isIntl = phone.trim().startsWith('+')

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-7 pb-[8vh]">

        <Orb size={220} pulse={false} />

        <div className="text-center mt-6 mb-8">
          <h1 className="text-[20px] font-semibold text-v2-text-primary">
            欢迎来到 LingoBridge
          </h1>
          <p className="text-[13px] text-v2-text-secondary mt-1.5">
            绑定手机号，保存你的练习进度
          </p>
        </div>

        <div className="w-full">

          {/* 手机号输入框（含 +86 区号提示） */}
          <div className="relative mb-3">
            {!isIntl && (
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[15px] text-v2-text-muted pointer-events-none">+86</span>
            )}
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="请输入手机号"
              className={`w-full bg-white border border-[#EEEEEE] rounded-[16px] py-3.5 text-[15px] text-v2-text-primary placeholder:text-[#CCCCCC] outline-none focus:border-brand-primary transition-colors ${isIntl ? 'px-4' : 'pl-[52px] pr-4'}`}
            />
          </div>
          {phoneErr && (
            <p className="text-[12px] text-error -mt-2 mb-2 px-1">{phoneErr}</p>
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
            。我们仅用手机号保存你的学习进度。
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
