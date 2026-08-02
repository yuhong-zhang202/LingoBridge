/**
 * @module   OfflineState
 * @desc     离线兜底态 — 取数失败且离线时页面内展示，品牌化提示 + 重试。
 * @author   LingoBridge
 * @created  2026-06-22
 */
'use client'
import { WifiOff, RotateCw } from 'lucide-react'
import GradientButton from '@/components/GradientButton'

export default function OfflineState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-16">
      <div className="w-[88px] h-[88px] rounded-full bg-bg-muted flex items-center justify-center">
        <WifiOff size={34} className="text-v2-text-muted" />
      </div>
      <h2 className="text-[1.0625rem] font-semibold text-v2-text-primary mt-5">网络好像断开了</h2>
      <p className="text-[0.8125rem] text-v2-text-secondary leading-relaxed text-center mt-2.5">
        请检查网络连接后重试。你已保存的故事和语料不会丢失。
      </p>
      <GradientButton
        onClick={onRetry}
        className="mt-6 px-6 py-3 rounded-full text-[0.875rem] font-medium flex items-center gap-1.5"
      >
        <RotateCw size={15} />
        重试
      </GradientButton>
    </div>
  )
}
