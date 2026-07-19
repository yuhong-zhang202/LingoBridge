/**
 * @module   MicPermissionSheet
 * @desc     麦克风权限底部弹窗 — 录音前探测失败时弹出，按 denied/unavailable 与平台给出开启步骤，
 *           并提供保底「用文字输入」入口。弹窗壳照 FirstUseConsent。
 * @author   LingoBridge
 * @created  2026-06-22
 */
'use client'
import { MicOff } from 'lucide-react'
import GradientButton from '@/components/GradientButton'

interface MicPermissionSheetProps {
  open: boolean
  reason: 'denied' | 'unavailable'
  onUseText: () => void
  onDismiss: () => void
}

type Platform = 'ios' | 'android' | 'other'

/** 由 userAgent 粗判平台，决定 denied 文案里的设置路径 */
function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}

const DENIED_TEXT: Record<Platform, string> = {
  ios: '录音需要用到麦克风。如果之前选了不允许，请到「设置 > 隐私与安全性 > 麦克风」，找到 LingoBridge 打开，再回来重试。也可以直接用文字写下你的故事。',
  android: '录音需要用到麦克风。如果之前选了不允许，请到「设置 > 应用 > LingoBridge > 权限 > 麦克风」，选择允许，再回来重试。也可以直接用文字写下你的故事。',
  other: '录音需要用到麦克风。如果之前选了不允许，请到手机设置里为 LingoBridge 打开麦克风权限，再回来重试。也可以直接用文字写下你的故事。',
}

const UNAVAILABLE_TEXT = '没检测到可用的麦克风，或当前环境不支持录音。你可以直接用文字写下你的故事。'

/**
 * 麦克风权限弹窗
 * @param open      是否显示
 * @param reason    denied（被拒绝）/ unavailable（无设备或环境不支持）
 * @param onUseText 点「用文字输入」
 * @param onDismiss 点「知道了」/ 关闭
 */
export default function MicPermissionSheet({ open, reason, onUseText, onDismiss }: MicPermissionSheetProps) {
  if (!open) return null

  const title = reason === 'unavailable' ? '麦克风不可用' : '需要麦克风权限'
  const body  = reason === 'unavailable' ? UNAVAILABLE_TEXT : DENIED_TEXT[detectPlatform()]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div
        className="w-full max-w-[430px] bg-bg-surface rounded-t-[20px] px-5 pt-5 sheet-enter flex flex-col items-center"
        style={{ paddingBottom: 'calc(28px + env(safe-area-inset-bottom))' }}
      >
        <div className="w-14 h-14 rounded-full bg-black/5 flex items-center justify-center">
          <MicOff size={24} className="text-v2-text-muted" />
        </div>

        <h3 className="text-[16px] font-semibold text-v2-text-primary text-center mt-3">{title}</h3>

        <p className="text-[13px] text-v2-text-secondary leading-relaxed text-center mt-3">{body}</p>

        <GradientButton
          onClick={onUseText}
          className="w-full mt-5 py-3 rounded-full text-[14px] font-medium"
        >
          用文字输入
        </GradientButton>

        {/* unavailable 时去设置无意义，只保留「用文字输入」 */}
        {reason !== 'unavailable' && (
          <button onClick={onDismiss} className="text-[13px] text-v2-text-muted mt-3">
            知道了
          </button>
        )}
      </div>
    </div>
  )
}
