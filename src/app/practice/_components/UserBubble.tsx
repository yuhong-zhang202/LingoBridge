/**
 * @module   UserBubble
 * @desc     练习页用户消息气泡（左上角 🔨 触发重新表达）
 * @author   LingoBridge
 * @created  2026-05-15
 */
import { User, Wand2 } from 'lucide-react'

interface UserBubbleProps {
  text: string
  onPolish?: () => void
}

export default function UserBubble({ text, onPolish }: UserBubbleProps): JSX.Element {
  return (
    <div className="flex items-start gap-2 max-w-[85%] ml-auto flex-row-reverse mb-4">
      <div
        className="w-[34px] h-[34px] rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: '#FBE6B0' }}
      >
        <User size={18} color="#C68A1E" fill="#C68A1E" />
      </div>
      <div
        className="relative px-3.5 py-2.5"
        style={{ background: '#EDF6EB', border: '1px solid rgba(192,221,185,.55)', borderRadius: '16px 6px 16px 16px' }}
      >
        {/* 重新表达：气泡左上角，安静的小按钮 */}
        {onPolish && (
          <button
            onClick={onPolish}
            aria-label="换个说法"
            className="absolute -left-2.5 -top-2.5 w-[22px] h-[22px] rounded-full bg-white border border-black/[0.08] shadow-sm flex items-center justify-center text-brand-primary active:scale-90 transition-transform"
          >
            <Wand2 size={12} />
          </button>
        )}
        <p className="text-[14px] text-[#1A1A1A] leading-[1.6]">{text}</p>
      </div>
    </div>
  )
}
