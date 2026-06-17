/**
 * @module   FirstUseConsent
 * @desc     首次使用 AI 隐私同意弹窗 — 披露录音/文字会发送给第三方 AI（豆包转写 / 通义千问分析），
 *           localStorage 持久化（key 带版本号，便于披露有实质变化时重新弹）。
 * @author   LingoBridge
 * @created  2026-06-17
 */
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import GradientButton from '@/components/GradientButton'

const CONSENT_KEY = 'lb-ai-consent-v1'

function readConsent(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(CONSENT_KEY) === '1'
  } catch {
    return true
  }
}

function writeConsent(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CONSENT_KEY, '1')
  } catch {
    /* 无痕 / 配额耗尽时静默：仅本会话不弹，下次再判 */
  }
}

export default function FirstUseConsent() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!readConsent()) setOpen(true)
  }, [])

  if (!open) return null

  const handleAgree = () => {
    writeConsent()
    setOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div className="w-full max-w-[430px] bg-bg-surface rounded-t-[20px] px-5 pt-5 pb-7 sheet-enter">
        <h3 className="text-[16px] font-semibold text-v2-text-primary text-center">开始前，关于你的隐私</h3>
        <p className="text-[13px] text-v2-text-secondary leading-relaxed mt-3">
          为了把你说的话转成文字、并生成题目和练习反馈，你的录音与文字会发送给第三方 AI 服务处理——语音转写用豆包，内容分析用通义千问。仅用于练习功能，不出售你的数据。
        </p>
        <div className="flex justify-center mt-3">
          <Link href="/privacy" className="text-[12px] text-brand-accent underline">
            阅读完整隐私政策
          </Link>
        </div>
        <GradientButton
          onClick={handleAgree}
          className="w-full mt-5 py-3 rounded-full text-[14px] font-medium"
        >
          我已了解，开始
        </GradientButton>
      </div>
    </div>
  )
}
