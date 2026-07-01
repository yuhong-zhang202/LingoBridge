/**
 * @module   CollectedCardPracticePage
 * @desc     收藏卡片「拼句练习」独立沉浸页 — 按路由 id 取收藏句，居中渲染 SentenceOrderGame；单句、无队列/进度
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import SentenceOrderGame from '@/components/library/SentenceOrderGame'
import { getSavedPhrases } from '@/lib/storage'
import type { SavedPhrase } from '@/lib/types'

export default function CollectedCardPracticePage(): JSX.Element {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = typeof params.id === 'string' ? params.id : ''

  const [item, setItem] = useState<SavedPhrase | null>(null)
  const [loaded, setLoaded] = useState(false)

  // localStorage 客户端读，按路由 id 找收藏句
  useEffect(() => {
    setItem(getSavedPhrases().find(p => p.id === id) ?? null)
    setLoaded(true)
  }, [id])

  const close = (): void => router.back()

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
      {/* 顶栏：仅关闭按钮，无进度计数 */}
      <div className="relative z-10 lg:max-w-[420px] lg:w-full lg:mx-auto">
        <div className="flex items-center h-[52px] px-5">
          <button
            onClick={close}
            aria-label="关闭"
            className="w-[30px] h-[30px] rounded-full bg-white shadow-sm flex items-center justify-center"
          >
            <X size={15} className="text-v2-text-muted" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-10 relative z-10 flex flex-col">
        {!loaded ? null : item ? (
          <div className="max-w-[340px] w-full mx-auto pt-6 lg:max-w-[420px]">
            <SentenceOrderGame
              originalSentence={item.original}
              aiOptimized={item.optimized}
              onComplete={close}
            />
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
