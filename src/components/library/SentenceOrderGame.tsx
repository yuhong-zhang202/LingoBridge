/**
 * @module   SentenceOrderGame
 * @desc     拼句练习展示组件 — 打乱 AI 优化句词块、点回原序；每行独立虚线、拼对朗读；进度/完成状态上抛给外层队列页控制。纯展示，无路由/按钮
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { type JSX, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Chip from '@/components/Chip'
import { chunkSentence, shuffleChunks } from '@/lib/phrase-chunk'

export interface SentenceStatus {
  total: number    // 词块总数
  correct: number  // 已正确就位的词块数（供底部进度点用）
  solved: boolean  // 全部就位且完全正确
}

interface Props {
  originalSentence: string
  aiOptimized: string
  onStatus: (s: SentenceStatus) => void   // 每次进度变化上抛给页面（页面据此驱动进度点 / 下一句可点）
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
 * 拼句练习展示组件（外层用 key 换卡/重来即重挂载重置）
 * @param originalSentence 用户原句（顶部提示）
 * @param aiOptimized      AI 优化句（正确答案来源）
 * @param onStatus         进度回调：总块数 / 已正确就位数 / 是否拼对
 * @sideEffect             拼对后调用一次 speechSynthesis 朗读 aiOptimized
 */
export default function SentenceOrderGame({ originalSentence, aiOptimized, onStatus }: Props): JSX.Element {
  const correctTexts = useMemo(() => chunkSentence(aiOptimized), [aiOptimized])

  const [pool, setPool] = useState<Chunk[]>([])
  const [answer, setAnswer] = useState<Chunk[]>([])

  // 挂载即打乱（换卡/重来由外层换 key 触发重挂载，天然重置）
  useEffect(() => {
    const items: Chunk[] = correctTexts.map((text, id) => ({ id, text }))
    const order = shuffleChunks(items.map(it => String(it.id)))
    setPool(order.map(idStr => items[Number(idStr)]))
    setAnswer([])
  }, [correctTexts])

  const total = correctTexts.length
  const placedCorrect = answer.reduce((n, c, i) => n + (c.text === correctTexts[i] ? 1 : 0), 0)
  const allPlaced = pool.length === 0 && answer.length === total && total > 0
  const solved = allPlaced && placedCorrect === total

  // 状态上抛（onStatus 为页面 setState，引用稳定）
  useEffect(() => { onStatus({ total, correct: placedCorrect, solved }) }, [total, placedCorrect, solved, onStatus])
  // 拼对后自动朗读一次
  useEffect(() => { if (solved) speak(aiOptimized) }, [solved, aiOptimized])

  // 测量拼句区各视觉行的底部 y，给每行画一条独立虚线（宽度 = 拼句区宽度，随内容列自适应）
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
      setLineTops(rows.map(r => r.bottom + 6))
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
    if (solved) return   // 拼对后锁定，不允许再调整
    setPool(prev => [...prev, answer[idx]])
    setAnswer(prev => prev.filter((_, i) => i !== idx))
  }

  return (
    <div className="w-full">
      {/* 原句 */}
      <p className="text-[12px] text-v2-text-muted text-center">原句</p>
      <p className="text-[15px] text-v2-text-primary text-center leading-relaxed mt-1.5">{originalSentence}</p>
      <p className="text-[13px] text-v2-text-muted text-center mt-5">拼出 AI 优化后的说法</p>

      {/* 拼句区：flex-wrap 摆放，每行底部各自一条虚线（宽度随内容列，绝对定位不影响词块布局） */}
      <div className="relative w-full mt-5 min-h-[40px]">
        {answer.length === 0 ? (
          <div>
            <p className="text-[12px] text-v2-text-muted text-center">点下面的词块，按你觉得对的顺序拼回来</p>
            <div className="border-b-2 border-dashed border-brand-primary-light mt-4" />
          </div>
        ) : (
          <>
            <div ref={answerRef} className="flex flex-wrap justify-center gap-x-2 gap-y-5">
              {answer.map((c, i) => {
                const wrong = allPlaced && !solved && c.text !== correctTexts[i]
                const extra = solved
                  ? 'border-success text-success bg-success/10'
                  : wrong ? 'border-error text-error bg-error/10' : ''
                return (
                  <span key={c.id} data-chip className="inline-flex">
                    <Chip
                      variant="default"
                      size="md"
                      onClick={solved ? undefined : () => returnToPool(i)}
                      className={`${extra} text-[15px] px-[16px] py-[9px]`}
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
                className={`absolute left-0 right-0 border-b-2 ${solved ? 'border-solid border-success' : 'border-dashed border-brand-primary-light'}`}
                style={{ top }}
              />
            ))}
          </>
        )}
      </div>

      {/* 词库区 */}
      {pool.length > 0 && (
        <div className="mt-9">
          <p className="text-[12px] text-v2-text-muted text-center mb-3">词库</p>
          <div className="flex flex-wrap justify-center gap-2.5">
            {pool.map((c, i) => (
              <Chip key={c.id} variant="default" size="md" onClick={() => pickFromPool(i)} className="text-[15px] px-[16px] py-[9px]">
                {c.text}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
