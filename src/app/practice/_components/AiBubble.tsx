/**
 * @module   AiBubble
 * @desc     练习页 AI 教练文字气泡（Phase 1 无 TTS，以文字呈现）
 * @author   LingoBridge
 * @created  2026-06-03
 */
export default function AiBubble({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex items-start gap-2 max-w-[85%] mb-4">
      <div className="w-[34px] h-[34px] rounded-full bg-[#E8F3E5] border border-[#C0DDB9] flex items-center justify-center flex-shrink-0 text-[14px]">
        🌿
      </div>
      <div
        className="px-3.5 py-2.5"
        style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,.07)', borderRadius: '6px 16px 16px 16px' }}
      >
        <p className="text-[14px] text-[#1A1A1A] leading-[1.6]">{text}</p>
      </div>
    </div>
  )
}
