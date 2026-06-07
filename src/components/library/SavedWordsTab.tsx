'use client'
import { useEffect, useState } from 'react'
import EmptyState from '@/components/EmptyState'
import PhraseDetailCard from '@/components/analysis/PhraseDetailCard'
import SwipeToDelete from '@/components/library/SwipeToDelete'
import { getSavedWords, removeSavedWord } from '@/lib/storage'
import type { SavedWord } from '@/lib/types'

export default function SavedWordsTab() {
  const [words, setWords] = useState<SavedWord[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setWords(getSavedWords())
    setLoaded(true)
  }, [])

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
    <div className="flex flex-col gap-3 pt-3">
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
            isSaved={true}
            onToggleSave={() => {
              removeSavedWord(w.id)
              setWords(prev => prev.filter(x => x.id !== w.id))
            }}
          />
        </SwipeToDelete>
      ))}
    </div>
  )
}
