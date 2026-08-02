/**
 * @module   TranscribeFailCard
 * @desc     练习页底部输入区在「转写彻底失败」（自动重试到顶/超时后）时的替换卡片 —— 照 isCapped 收尾区的
 *           `flex flex-col items-center gap-3` 范式：一句安抚 + 主按钮「重试转写」（同一段留存 blob 重发）。
 *           【绝不出现任何「再说 / 重录」字样】——语音这段已被系统接住、只是转写没成功，让用户重说是把系统
 *           的锅甩给用户。挂载即把焦点移到「重试转写」（a11y）。
 *           「改用文字输入」次按钮已按产品方拍板移除（2026-07-26）：练习对话保持纯语音，失败只走重试。
 *           对应的 textInput 状态机与 TextInputBar 已于清理时一并删除，如需恢复文字兜底须重新加回按钮 + 状态。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { type JSX, useEffect, useRef } from 'react'
import GradientButton from '@/components/GradientButton'

interface TranscribeFailCardProps {
  /** 用同一段留存的 blob 重发转写 */
  onRetry: () => void
}

/**
 * 转写失败卡片（单按钮：重试转写）。
 * @param onRetry  「重试转写」主按钮回调
 * @returns        底部输入区替换卡片
 */
export default function TranscribeFailCard({ onRetry }: TranscribeFailCardProps): JSX.Element {
  // 进失败态即把焦点移到「重试转写」（GradientButton 不透传 ref，改在根容器上按标签取首个 button）
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [])

  return (
    <div ref={rootRef} className="flex flex-col items-center gap-3">
      <p className="text-[0.8125rem] text-v2-text-secondary text-center leading-[1.5]">
        刚才这段没接住，网络或服务开了会儿小差
      </p>
      <GradientButton onClick={onRetry} className="px-6 py-3 rounded-full text-[0.875rem] font-medium">
        重试转写
      </GradientButton>
    </div>
  )
}
