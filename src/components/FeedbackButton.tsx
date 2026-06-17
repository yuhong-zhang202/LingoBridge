/**
 * @module   FeedbackButton
 * @desc     右上角「反馈」药丸触发件 — 自管 open 状态，渲染 FeedbackPopup；
 *           popup 内部根据当前路由决定选项与文案。
 * @author   LingoBridge
 * @created  2026-06-17
 */
'use client'
import { useState } from 'react'
import GradientButton from '@/components/GradientButton'
import FeedbackPopup from '@/components/FeedbackPopup'

export default function FeedbackButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <GradientButton
        onClick={() => setOpen(true)}
        className="px-4 py-1.5 rounded-full text-[12px] font-medium"
      >
        反馈
      </GradientButton>
      <FeedbackPopup open={open} onClose={() => setOpen(false)} />
    </>
  )
}
