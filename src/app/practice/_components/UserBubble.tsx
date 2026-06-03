/**
 * @module   UserBubble
 * @desc     练习页用户消息气泡（左上角 🔨 触发重新表达）
 * @author   LingoBridge
 * @created  2026-05-15
 */
interface UserBubbleProps {
  text: string
  onPolish: () => void
}

export default function UserBubble({ text, onPolish }: UserBubbleProps): JSX.Element {
  return (
    <div className="flex items-start gap-2 max-w-[85%] ml-auto flex-row-reverse mb-4">
      <div
        className="w-[34px] h-[34px] rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-semibold"
        style={{ background: '#F5D5BC', color: '#B5663A' }}
      >
        你
      </div>
      <div
        className="relative px-3.5 py-2.5"
        style={{ background: '#EDF6EB', border: '1px solid rgba(192,221,185,.55)', borderRadius: '16px 6px 16px 16px' }}
      >
        {/* 🔨 重新表达：气泡左上角，安静的小按钮 */}
        <button
          onClick={onPolish}
          aria-label="换个说法"
          className="absolute -left-2.5 -top-2.5 w-[22px] h-[22px] rounded-full bg-white border border-black/[0.08] shadow-sm flex items-center justify-center active:scale-90 transition-transform"
          style={{ fontSize: 11, lineHeight: 1 }}
        >
          🔨
        </button>
        <p className="text-[14px] text-[#1A1A1A] leading-[1.6]">{text}</p>
      </div>
    </div>
  )
}
