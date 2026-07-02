/**
 * @module   CollectedCardPracticePage
 * @desc     收藏卡片「拼句练习」沉浸队列页 — 依次练完所有可拼收藏句；顶部关闭 + 计数 + 进度条，底部 重来/进度点/下一句。对齐 /review
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { X, RotateCw, ArrowRight } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import GradientButton from '@/components/GradientButton'
import SentenceOrderGame, { type SentenceStatus } from '@/components/library/SentenceOrderGame'
import { getSavedPhrases } from '@/lib/storage'
import { chunkSentence } from '@/lib/phrase-chunk'
import type { SavedPhrase } from '@/lib/types'

const EMPTY_STATUS: SentenceStatus = { total: 0, correct: 0, solved: false }

export default function CollectedCardPracticePage(): JSX.Element {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = typeof params.id === 'string' ? params.id : ''

  const [queue, setQueue] = useState<SavedPhrase[]>([])
  const [index, setIndex] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [resetSignal, setResetSignal] = useState(0)   // 「重来」用：同一句换 key 重挂载
  const [status, setStatus] = useState<SentenceStatus>(EMPTY_STATUS)

  // 队列 = 所有「可拼」收藏句（优化句能切 ≥3 块）；从点进来的那张开始
  useEffect(() => {
    const playable = getSavedPhrases().filter(p => chunkSentence(p.optimized).length >= 3)
    setQueue(playable)
    const start = playable.findIndex(p => p.id === id)
    setIndex(start >= 0 ? start : 0)
    setLoaded(true)
  }, [id])

  const close = (): void => router.back()
  const total = queue.length
  const current = queue[index]
  const isLast = index >= total - 1
  const pct = total > 0 ? ((index + 1) / total) * 100 : 0

  // 下一句：拼对后可点；最后一句则收尾返回
  const advance = (): void => {
    setStatus(EMPTY_STATUS)
    if (isLast) { close(); return }
    setIndex(i => i + 1)
  }
  // 重来：同一句重新打乱
  const restart = (): void => {
    setStatus(EMPTY_STATUS)
    setResetSignal(s => s + 1)
  }

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
      {/* 顶栏：关闭 + 计数 + 进度条 */}
      <div className="relative z-10 lg:max-w-[640px] lg:w-full lg:mx-auto">
        <div className="flex items-center justify-between h-[52px] px-5">
          <button
            onClick={close}
            aria-label="关闭"
            className="w-[30px] h-[30px] rounded-full bg-white shadow-sm flex items-center justify-center"
          >
            <X size={15} className="text-v2-text-muted" />
          </button>
          {loaded && current && (
            <span className="text-[13px] text-v2-text-muted">{index + 1} / {total}</span>
          )}
        </div>
        {loaded && current && (
          <div className="px-5">
            <div className="mt-1 h-1 rounded-full bg-bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-brand-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-8 relative z-10 flex flex-col lg:max-w-[640px] lg:w-full lg:mx-auto">
        {!loaded ? null : current ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <SentenceOrderGame
              key={`${current.id}-${resetSignal}`}
              originalSentence={current.original}
              aiOptimized={current.optimized}
              onStatus={setStatus}
            />

            {/* 控制行：重来 / 进度点 / 下一句 —— 与拼句区一起在可用高度内整体居中 */}
            <div className="mt-10 w-full flex items-center justify-between gap-3">
              <button onClick={restart} className="btn-ghost px-4 py-2">
                <RotateCw size={14} />重来
              </button>
              {/* 拼句进度点：总数=词块数，已正确就位的高亮 */}
              <div className="flex items-center gap-[5px]">
                {Array.from({ length: status.total }, (_, i) => (
                  <span key={i} className={`w-[6px] h-[6px] rounded-full ${i < status.correct ? 'bg-brand-primary' : 'bg-bg-muted'}`} />
                ))}
              </div>
              <GradientButton
                onClick={advance}
                disabled={!status.solved}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-[13px] font-medium"
              >
                {isLast ? '完成' : '下一句'}
                <ArrowRight size={14} />
              </GradientButton>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState title="没找到这张卡片" ctaLabel="返回" onCta={close} />
          </div>
        )}
      </div>
    </div>
  )
}
