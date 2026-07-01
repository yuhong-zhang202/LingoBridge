/**
 * @module   SentenceOrderGame
 * @desc     拼句练习展示组件 — 把 AI 优化句按词组打乱，点词块拼回原序；每行各自独立虚线、拼对朗读。纯自主复习，无调度/写库
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RotateCw, CheckCircle2 } from 'lucide-react'
import Chip from '@/components/Chip'
import GradientButton from '@/components/GradientButton'
import { chunkSentence, shuffleChunks } from '@/lib/phrase-chunk'

interface Props {
  originalSentence: string
  aiOptimized: string
  onComplete: () => void   // 拼对后由外层决定跳转/关闭（页面里调用 router.back()）
}

// 带稳定 id 的词块（内容可能重复，靠 id 区分身份，判对仍按位置文本比较）
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
 * 拼句练习展示组件
 * @param originalSentence 用户原句（顶部提示）
 * @param aiOptimized      AI 优化句（正确答案来源）
 * @param onComplete       拼对后点「完成」的回调
 * @sideEffect             拼对后调用一次 speechSynthesis 朗读 aiOptimized
 */
export default function SentenceOrderGame({ originalSentence, aiOptimized, onComplete }: Props): JSX.Element {
  const correctTexts = useMemo(() => chunkSentence(aiOptimized), [aiOptimized])

  const [pool, setPool] = useState<Chunk[]>([])
  const [answer, setAnswer] = useState<Chunk[]>([])

  // 重来 / 首次：重建词块并打乱进词库区，清空拼句区
  const reset = useCallback(() => {
    const items: Chunk[] = correctTexts.map((text, id) => ({ id, text }))
    const order = shuffleChunks(items.map(it => String(it.id)))
    setPool(order.map(idStr => items[Number(idStr)]))
    setAnswer([])
  }, [correctTexts])

  useEffect(() => { reset() }, [reset])

  const allPlaced = pool.length === 0 && answer.length === correctTexts.length && correctTexts.length > 0
  const isCorrect = allPlaced && answer.every((c, i) => c.text === correctTexts[i])

  // 拼对后自动朗读一次
  useEffect(() => { if (isCorrect) speak(aiOptimized) }, [isCorrect, aiOptimized])

  // 测量拼句区各视觉行的底部 y，给每行画一条独立虚线（宽度限于内容区、居中，不贯穿全屏）
  const answerRef = useRef<HTMLDivElement>(null)
  const [lineTops, setLineTops] = useState<number[]>([])

  useLayoutEffect(() => {
    const el = answerRef.current
    if (!el || answer.length === 0) { setLineTops([]); return }
    const measure = (): void => {
      const chips = Array.from(el.querySelectorAll<HTMLElement>('[data-chip]'))
      const rows: { top: number; bottom: number }[] = []
      for (const c of chips) {
        const top = c.offsetTop
        const bottom = c.offsetTop + c.offsetHeight
        const row = rows.find(r => Math.abs(r.top - top) < 4)
        if (row) row.bottom = Math.max(row.bottom, bottom)
        else rows.push({ top, bottom })
      }
      setLineTops(rows.map(r => r.bottom + 4))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [answer])

  const pickFromPool = (idx: number): void => {
    setAnswer(prev => [...prev, pool[idx]])
    setPool(prev => prev.filter((_, i) => i !== idx))
  }
  const returnToPool = (idx: number): void => {
    if (isCorrect) return   // 拼对后锁定，不允许再调整
    setPool(prev => [...prev, answer[idx]])
    setAnswer(prev => prev.filter((_, i) => i !== idx))
  }

  return (
    <div className="w-full">
      {/* 原句提示 + 说明 */}
      <p className="text-[13px] text-v2-text-muted text-center leading-relaxed">{originalSentence}</p>
      <p className="text-[13px] text-v2-text-secondary text-center mt-1.5">拼出 AI 优化后的说法</p>

      {/* 拼句区：flex-wrap 摆放，每行底部各自一条居中虚线（绝对定位，不影响词块布局） */}
      <div className="relative max-w-[280px] mx-auto mt-6 min-h-[48px]">
        {answer.length === 0 ? (
          <p className="text-[12px] text-v2-text-muted text-center pt-3">点下面的词块，按你觉得对的顺序拼回来</p>
        ) : (
          <>
            <div ref={answerRef} className="flex flex-wrap justify-center gap-x-2 gap-y-4">
              {answer.map((c, i) => {
                const wrong = allPlaced && !isCorrect && c.text !== correctTexts[i]
                const extra = isCorrect
                  ? 'border-success text-success bg-success/10'
                  : wrong ? 'border-error text-error bg-error/10' : ''
                return (
                  <span key={c.id} data-chip className="inline-flex">
                    <Chip
                      variant="default"
                      size="md"
                      onClick={isCorrect ? undefined : () => returnToPool(i)}
                      className={extra}
                    >
                      {c.text}
                    </Chip>
                  </span>
                )
              })}
            </div>
            {lineTops.map((top, i) => (
              <div
                key={i}
                className={`absolute left-0 right-0 border-b-2 ${isCorrect ? 'border-solid border-success' : 'border-dashed border-brand-primary-light'}`}
                style={{ top }}
              />
            ))}
          </>
        )}
      </div>

      {/* 成功提示条 */}
      {isCorrect && (
        <div className="max-w-[280px] mx-auto mt-5 flex items-center justify-center gap-1.5 rounded-[12px] bg-success/10 py-2.5">
          <CheckCircle2 size={15} className="text-success" />
          <span className="text-[13px] font-medium text-success">拼对啦 🎉</span>
        </div>
      )}

      {/* 词库区 */}
      {pool.length > 0 && (
        <div className="mt-7">
          <p className="text-[12px] text-v2-text-muted text-center mb-3">词库</p>
          <div className="flex flex-wrap justify-center gap-2 max-w-[300px] mx-auto">
            {pool.map((c, i) => (
              <Chip key={c.id} variant="default" size="md" onClick={() => pickFromPool(i)}>
                {c.text}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {/* 操作区：完成（拼对才可点）+ 重来 */}
      <div className="mt-8 flex flex-col items-center gap-3">
        <GradientButton
          onClick={onComplete}
          disabled={!isCorrect}
          className="px-8 py-2.5 rounded-full text-[14px] font-medium"
        >
          完成
        </GradientButton>
        <button onClick={reset} className="btn-ghost px-5 py-2">
          <RotateCw size={14} />重来
        </button>
      </div>
    </div>
  )
}
