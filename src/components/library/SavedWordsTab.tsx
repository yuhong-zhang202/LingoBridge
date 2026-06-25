'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Layers, ChevronRight } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import PhraseDetailCard from '@/components/analysis/PhraseDetailCard'
import SwipeToDelete from '@/components/library/SwipeToDelete'
import { getSavedWords, removeSavedWord } from '@/lib/storage'
import { getDueCount, listDeckWordIds, addPhraseCard } from '@/lib/db/phrase-cards'
import type { SavedWord } from '@/lib/types'

export default function SavedWordsTab(): JSX.Element | null {
  const [words, setWords] = useState<SavedWord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [deckIds, setDeckIds] = useState<Set<string>>(new Set())
  const [dueCount, setDueCount] = useState(0)

  useEffect(() => {
    setWords(getSavedWords())
    setLoaded(true)
  }, [])

  // 记忆卡片数据（Supabase）：异步加载，不阻塞词组列表浏览
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [ids, count] = await Promise.all([listDeckWordIds(), getDueCount()])
        if (cancelled) return
        setDeckIds(new Set(ids))
        setDueCount(count)
      } catch {
        // 拿不到也不影响收藏列表
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleAdd = async (w: SavedWord): Promise<void> => {
    try {
      await addPhraseCard({ text: w.text, meaning: w.meaning, scene: w.scene, group: w.group, sourceWordId: w.id })
      setDeckIds(prev => new Set(prev).add(w.id))
      setDueCount(c => c + 1)   // 新卡立即到期
    } catch {
      // 失败则不标记，用户可重试
    }
  }

  if (!loaded) return null
  if (words.length === 0) {
    return (
      <EmptyState
        title="还没有收藏词组"
        subtitle="题目分析里点开任意词组，点收藏即可保存到这里"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 pt-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start">
      {/* 记忆卡片入口 */}
      <Link
        href="/review"
        className="flex items-center gap-2.5 bg-white rounded-[14px] border border-black/[0.05] px-4 py-3 active:scale-[0.99] transition-transform duration-150 lg:col-span-2"
      >
        <Layers size={16} className="text-brand-primary" />
        <span className="text-[13px] font-medium text-v2-text-primary">
          {dueCount > 0 ? `待复习 ${dueCount} 张` : '记忆卡片'}
        </span>
        <span className="ml-auto flex items-center gap-0.5 text-[12px] text-v2-text-muted">
          {dueCount > 0 ? '开始复习' : '暂无待复习'}
          <ChevronRight size={14} />
        </span>
      </Link>

      {words.map(w => (
        <SwipeToDelete
          key={w.id}
          borderRadius={14}
          onDelete={() => {
            removeSavedWord(w.id)
            setWords(prev => prev.filter(x => x.id !== w.id))
          }}
        >
          <PhraseDetailCard
            text={w.text}
            meaning={w.meaning}
            scene={w.scene}
            group={w.group}
            level={w.level}
            inDeck={deckIds.has(w.id)}
            onAddToMemory={() => void handleAdd(w)}
          />
        </SwipeToDelete>
      ))}
    </div>
  )
}
