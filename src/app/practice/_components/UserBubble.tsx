/**
 * @module   UserBubble
 * @desc     练习页用户消息气泡 — 左上角 ✨ 换个说法；气泡内每个词可点，触发发音纠错
 * @author   LingoBridge
 * @created  2026-05-15
 */
import { Sparkles } from 'lucide-react'
import Avatar from '@/components/Avatar'
import OrbWarm from './OrbWarm'

interface UserBubbleProps {
  text: string
  onPolish?: () => void
  onWordTap?: (word: string) => void
  /** 当前用户头像；不传/为空回退 OrbWarm（匿名、未上传、首页 mockup 均走回退） */
  avatarUrl?: string | null
}

/** 去掉词首尾的非字母字符（保留撇号），用作收藏的"听成的词" */
function cleanWord(s: string): string {
  return s.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '')
}

export default function UserBubble({ text, onPolish, onWordTap, avatarUrl }: UserBubbleProps): JSX.Element {
  return (
    <div className="flex items-start gap-2 max-w-[85%] ml-auto flex-row-reverse mb-4">
      <Avatar avatarUrl={avatarUrl} size={34} fallback={<OrbWarm size={34} className="flex-shrink-0" />} />
      <div
        className="relative px-3.5 py-2.5"
        style={{ background: '#EDF6EB', border: '1px solid rgba(192,221,185,.55)', borderRadius: '16px 6px 16px 16px' }}
      >
        {onPolish && (
          <button
            onClick={onPolish}
            aria-label="换个说法"
            className="absolute -left-2.5 -top-2.5 w-[22px] h-[22px] rounded-full bg-white border border-black/[0.08] shadow-sm flex items-center justify-center text-brand-primary active:scale-[0.97] transition-transform"
          >
            <Sparkles size={12} />
          </button>
        )}
        <p className="text-[14px] text-v2-text-primary leading-[1.6]">
          {onWordTap
            ? text.split(/(\s+)/).map((tok, i) => {
                const w = cleanWord(tok)
                return /[A-Za-z]/.test(tok) && w
                  ? (
                    <span
                      key={i}
                      onClick={() => onWordTap(w)}
                      className="cursor-pointer rounded-[3px] hover:bg-brand-primary-light/50 active:bg-brand-primary-light/80 transition-colors"
                    >
                      {tok}
                    </span>
                  )
                  : <span key={i}>{tok}</span>
              })
            : text}
        </p>
      </div>
    </div>
  )
}
