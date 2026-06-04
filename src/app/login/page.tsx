/**
 * @module   LoginPage
 * @desc     登录页 — 方案A 温暖欢迎型，mock UI 登录态（绑定手机号存 localStorage）
 * @author   LingoBridge
 * @created  2026-06-03
 */
'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Orb from '@/components/Orb'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import { sendVerifyCode, verifyCode } from '@/lib/auth'
import { useCountdown } from '@/hooks/useCountdown'

export default function LoginPage() {
  const router = useRouter()
  const [phone, setPhone]       = useState('')
  const [code, setCode]         = useState('')
  const [phoneErr, setPhoneErr] = useState<string | null>(null)
  const [codeErr, setCodeErr]   = useState<string | null>(null)
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
    setSending(true)
    try {
      await sendVerifyCode(phone)
      start(60)
    } catch (e) {
      setPhoneErr(extractMsg(e, '发送失败，请重试'))
    } finally {
      setSending(false)
    }
  }, [phone, start])

  const handleLogin = useCallback(async () => {
    setCodeErr(null)
    setLogging(true)
    try {
      await verifyCode(phone, code)
      router.push('/')
    } catch (e) {
      setCodeErr(extractMsg(e, '登录失败，请重试'))
    } finally {
      setLogging(false)
    }
  }, [phone, code, router])

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
            绑定手机号，保存你的练习进度
          </p>
        </div>

        <div className="w-full">

          {/* 手机号输入框 */}
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="请输入手机号"
            className="w-full bg-white border border-[#EEEEEE] rounded-[16px] px-4 py-3.5 text-[15px] text-v2-text-primary placeholder:text-[#CCCCCC] outline-none focus:border-brand-primary transition-colors mb-3"
          />
          {phoneErr && (
            <p className="text-[12px] text-error -mt-2 mb-2 px-1">{phoneErr}</p>
          )}

          {/* 验证码行 */}
          <div className="flex gap-2">
            <input
              type="tel"
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
                  : 'text-[#444]'
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
            className="btn-gradient w-full h-[50px] mt-5 disabled:opacity-60"
          >
            {logging ? '登录中…' : '登录'}
          </button>

          {/* 暂不登录 */}
          <div className="flex justify-center mt-3">
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
