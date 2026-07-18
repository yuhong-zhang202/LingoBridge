/**
 * @module   FirstUseConsent
 * @desc     首次使用「真捕获同意」闸 —— 阻断式：不点「同意并开始」进不去、无 skip。
 *           点击「同意并开始」= 明示同意（clickwrap / affirmative action），调 /api/consent 落一条
 *           可查证的同意记录，成功才关弹窗放行；失败留弹窗 + 重试（绝不只写 localStorage 就放行）。
 *           读路径查库判是否已签（hasRecordedConsent，localStorage 仅作缓存）；披露版本 bump 后老用户重弹重签。
 *           保留次要「不同意，暂不使用」出口（点了不进入，符合「同意须自由给予」）。
 *           披露文案唯一真源在 src/lib/privacy-copy.ts；落库/查库逻辑在 src/lib/consent.ts。
 * @author   LingoBridge
 * @created  2026-06-17
 */
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import GradientButton from '@/components/GradientButton'
import { CONSENT_POPUP_TITLE, CONSENT_POPUP_DISCLOSURE } from '@/lib/privacy-copy'
import { hasRecordedConsent, recordConsent } from '@/lib/consent'

export default function FirstUseConsent() {
  const [open, setOpen] = useState(false)
  const [declined, setDeclined] = useState(false)   // 次要出口：用户选择「暂不使用」后的阻断视图
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)        // 落库失败：留弹窗提示重试

  useEffect(() => {
    let cancelled = false
    // 查库（含缓存快路径）判是否已对当前披露版本签过同意；未签才弹
    hasRecordedConsent().then((ok) => {
      if (!cancelled && !ok) setOpen(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!open) return null

  const handleAgree = async () => {
    setFailed(false)
    setSubmitting(true)
    try {
      const ok = await recordConsent()
      if (ok) {
        setOpen(false)   // 成功才放行
      } else {
        setFailed(true)  // 失败留弹窗 + 重试
      }
    } catch {
      setFailed(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div className="w-full max-w-[430px] bg-bg-surface rounded-t-[20px] px-5 pt-5 pb-7 sheet-enter">
        {declined ? (
          // 次要出口的阻断视图：用户选择不同意 → 不进入应用，仍可「再想想」回到同意
          <>
            <h3 className="text-[16px] font-semibold text-v2-text-primary text-center">暂时无法使用</h3>
            <p className="text-[13px] text-v2-text-secondary leading-relaxed mt-3">
              练习功能需要把你的录音与文字发送给第三方 AI 处理，未同意则无法开始。你随时可以回来重新考虑。
            </p>
            <GradientButton
              onClick={() => setDeclined(false)}
              className="w-full mt-5 py-3 rounded-full text-[14px] font-medium"
            >
              我再想想
            </GradientButton>
          </>
        ) : (
          <>
            <h3 className="text-[16px] font-semibold text-v2-text-primary text-center">{CONSENT_POPUP_TITLE}</h3>
            {CONSENT_POPUP_DISCLOSURE.map((para, i) => (
              <p key={i} className="text-[13px] text-v2-text-secondary leading-relaxed mt-3">
                {para}
              </p>
            ))}
            <div className="flex justify-center gap-4 mt-3">
              <Link href="/privacy/beta" className="text-[12px] text-brand-accent underline">
                内测数据处理说明
              </Link>
              <Link href="/privacy" className="text-[12px] text-brand-accent underline">
                完整隐私政策
              </Link>
            </div>
            {failed && (
              <p className="text-[12px] text-red-500 text-center mt-3">
                保存同意记录失败，请检查网络后重试。
              </p>
            )}
            <GradientButton
              onClick={handleAgree}
              loading={submitting}
              className="w-full mt-5 py-3 rounded-full text-[14px] font-medium"
            >
              同意并开始
            </GradientButton>
            <button
              type="button"
              onClick={() => setDeclined(true)}
              disabled={submitting}
              className="w-full mt-3 text-[12px] text-v2-text-muted underline disabled:opacity-50"
            >
              不同意，暂不使用
            </button>
          </>
        )}
      </div>
    </div>
  )
}
