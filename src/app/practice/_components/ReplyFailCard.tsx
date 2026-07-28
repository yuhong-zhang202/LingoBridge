/**
 * @module   ReplyFailCard
 * @desc     练习页底部输入区在「教练回复失败」（POST /api/practice 非额度/同意类错误）时的替换卡片 ——
 *           照 TranscribeFailCard/isCapped 收尾区的 `flex flex-col items-center gap-3` 范式：一句安抚 +
 *           主按钮「再试一次」（用当前 messages 重发，末条已是用户气泡、绝不追加第二条）。
 *           与转写失败卡的分工：转写失败是「语音接住了、转文字没成」；回复失败是「用户这句已上屏、教练
 *           那句没拿到」——都不该让用户重说，只重发。attempt≥2 换更「网络不稳、过会儿再试」的措辞。
 *           挂载即把焦点移到「再试一次」（a11y，GradientButton 不透传 ref，改在根容器按标签取首个 button）。
 * @author   LingoBridge
 * @created  2026-07-28
 */
'use client'
import { type JSX, useEffect, useRef } from 'react'
import GradientButton from '@/components/GradientButton'

interface ReplyFailCardProps {
  /** 用当前 messages（末条为用户气泡）重发 /api/practice，成功只追加教练回复 */
  onRetry: () => void
  /** 已进本失败态的次数（≥2 换「网络不稳、过会儿再试」措辞） */
  attempt?: number
}

/**
 * 教练回复失败卡片（单按钮：再试一次）。
 * @param onRetry   「再试一次」主按钮回调（重发当前 messages）
 * @param attempt   已失败次数，默认 1；≥2 切换更强的安抚文案
 * @returns         底部输入区替换卡片
 */
export default function ReplyFailCard({ onRetry, attempt = 1 }: ReplyFailCardProps): JSX.Element {
  // 进失败态即把焦点移到「再试一次」（GradientButton 不透传 ref，改在根容器上按标签取首个 button）
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [])

  const msg = attempt >= 2
    ? '教练还是没接上，可能网络不太稳，过一会儿再试试'
    : '教练那边没接上，网络或服务开了会儿小差'

  return (
    <div ref={rootRef} className="flex flex-col items-center gap-3">
      <p className="text-[13px] text-v2-text-secondary text-center leading-[1.5]">{msg}</p>
      <GradientButton onClick={onRetry} className="px-6 py-3 rounded-full text-[14px] font-medium">
        再试一次
      </GradientButton>
    </div>
  )
}
