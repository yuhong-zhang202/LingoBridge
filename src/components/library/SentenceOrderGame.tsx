/**
 * @module   SentenceOrderGame
 * @desc     拼句练习底部弹层 — 把 AI 优化句按词组打乱，用户点词块拼回原序，拼对后朗读；纯自主复习，无调度/写库
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, RotateCw } from 'lucide-react'
import Chip from '@/components/Chip'
import GradientButton from '@/components/GradientButton'
import { chunkSentence, shuffleChunks } from '@/lib/phrase-chunk'

interface Props {
  open: boolean
  originalSentence: string
  aiOptimized: string
  onClose: () => void
}

// 带稳定 id 的词块（内容可能重复，靠 id 区分身份，判定对错仍按位置文本比较）
interface Chunk {
  id: number
  text: string
}

// 朗读英文（系统语音）—— 复用 FlashCard 的 speak 实现方式，不引入新 TTS 调用
function speak(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-US'
  window.speechSynthesis.speak(u)
}

/**
 * 拼句练习弹层
 * @param open             是否显示
 * @param originalSentence 用户原句（顶部提示，帮助理解上下文）
 * @param aiOptimized      AI 优化句（正确答案来源）
 * @param onClose          关闭回调
 * @sideEffect             拼对后调用一次 speechSynthesis 朗读 aiOptimized
 */
export default function SentenceOrderGame({ open, originalSentence, aiOptimized, onClose }: Props): JSX.Element | null {
  const correctTexts = useMemo(() => chunkSentence(aiOptimized), [aiOptimized])

  const [pool, setPool] = useState<Chunk[]>([])
  const [answer, setAnswer] = useState<Chunk[]>([])

  // 重来 / 打开时：重建词块并打乱进词库区，清空答题区
  const reset = useCallback(() => {
    const items: Chunk[] = correctTexts.map((text, id) => ({ id, text }))
    const order = shuffleChunks(items.map(it => String(it.id)))
    setPool(order.map(idStr => items[Number(idStr)]))
    setAnswer([])
  }, [correctTexts])

  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  const allPlaced = pool.length === 0 && answer.length === correctTexts.length && correctTexts.length > 0
  const isCorrect = allPlaced && answer.every((c, i) => c.text === correctTexts[i])

  // 拼对后自动朗读一次（isCorrect 由 false→true 时触发）
  useEffect(() => {
    if (isCorrect) speak(aiOptimized)
  }, [isCorrect, aiOptimized])

  const pickFromPool = (idx: number): void => {
    setAnswer(prev => [...prev, pool[idx]])
    setPool(prev => prev.filter((_, i) => i !== idx))
  }

  const returnToPool = (idx: number): void => {
    if (isCorrect) return   // 拼对后答题区锁定
    setPool(prev => [...prev, answer[idx]])
    setAnswer(prev => prev.filter((_, i) => i !== idx))
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="relative w-full max-w-[430px] bg-bg-surface rounded-t-[20px] px-5 pt-5 pb-7 sheet-enter"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="关闭"
          className="absolute top-4 right-4 w-[30px] h-[30px] rounded-full bg-white shadow-sm flex items-center justify-center"
        >
          <X size={15} className="text-v2-text-muted" />
        </button>

        <h3 className="text-[15px] font-semibold text-v2-text-primary">拼句练习</h3>
        <p className="text-[13px] text-v2-text-muted mt-2 leading-relaxed pr-8">{originalSentence}</p>

        {/* 答题区 */}
        <div className="min-h-[64px] flex flex-wrap gap-2 mt-4 p-3 rounded-[14px] bg-bg-page border border-black/[0.05]">
          {answer.length === 0 ? (
            <span className="text-[12px] text-v2-text-muted self-center">点下面的词块，按你觉得对的顺序拼回来</span>
          ) : (
            answer.map((c, i) => {
              const wrong = allPlaced && !isCorrect && c.text !== correctTexts[i]
              const extra = isCorrect
                ? 'border-success text-success bg-success/10'
                : wrong
                  ? 'border-error text-error bg-error/10'
                  : ''
              return (
                <Chip
                  key={c.id}
                  variant="default"
                  size="md"
                  onClick={isCorrect ? undefined : () => returnToPool(i)}
                  className={extra}
                >
                  {c.text}
                </Chip>
              )
            })
          )}
        </div>

        {/* 词库区 */}
        {pool.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {pool.map((c, i) => (
              <Chip key={c.id} variant="ghost" size="md" onClick={() => pickFromPool(i)}>
                {c.text}
              </Chip>
            ))}
          </div>
        )}

        {isCorrect && (
          <p className="text-[13px] text-success mt-4 text-center">拼对了，跟着读一遍吧 🎉</p>
        )}

        {/* 重来 */}
        <div className="flex justify-center mt-5">
          <GradientButton onClick={reset} className="px-6 py-2.5 rounded-full text-[13px] font-medium inline-flex items-center gap-1.5">
            <RotateCw size={14} />重来
          </GradientButton>
        </div>
      </div>
    </div>
  )
}
