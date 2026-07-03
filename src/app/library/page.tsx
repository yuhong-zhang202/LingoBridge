/**
 * @module   LibraryPage
 * @desc     素材库入口 — 统一加载数据，按断点分发两套 UI：
 *           移动端(lg 以下)走改版前 hub + 二级列表，桌面端(lg 及以上)走密面板版
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useState, useEffect, useCallback } from 'react'
import { listMyCorpus, getCorpusPointCodes, deleteCorpus } from '@/lib/db/corpus'
import { getQuestionCountByObservations } from '@/lib/db/questions'
import { DIMENSION_LABEL } from '@/lib/constants'
import { getSavedPhrases, getSavedWords, getSavedPronunciations } from '@/lib/storage'
import { getDueCount } from '@/lib/db/phrase-cards'
import { formatRelativeTime } from '@/lib/utils'
import type { MyStory, CollectedCard, DimensionLabel } from '@/lib/types'
import LibraryMobile from './LibraryMobile'
import LibraryDesktop from './LibraryDesktop'

function codeToLabel(code: string): DimensionLabel | undefined {
  const prefix = code.split('_')[0] ?? ''
  if (prefix === 'EMO') return DIMENSION_LABEL.emotion
  if (prefix === 'REL') return DIMENSION_LABEL.relationship
  if (prefix === 'SPA') return DIMENSION_LABEL.space
  if (prefix === 'SPI') return DIMENSION_LABEL.spirit
  if (prefix === 'GRO') return DIMENSION_LABEL.growth
  if (prefix === 'VAL') return DIMENSION_LABEL.value
  return undefined
}

export default function LibraryPage() {
  const [stories, setStories]       = useState<MyStory[]>([])
  const [cards, setCards]           = useState<CollectedCard[]>([])
  const [wordsCount, setWordsCount] = useState(0)
  const [pronCount, setPronCount]   = useState(0)
  const [dueCount, setDueCount]     = useState(0)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)

  useEffect(() => {
    // 收藏卡片：localStorage 同步读
    setCards(
      getSavedPhrases().map(p => ({
        id: p.id,
        questionId: '',
        part: `Part ${p.part}` as CollectedCard['part'],
        topicEn: p.questionEn,
        originalSentence: p.original,
        aiOptimized: p.optimized,
        collectedAt: formatRelativeTime(p.createdAt),
        keywords: undefined,
      }))
    )

    // 词组 / 发音 计数（localStorage 同步）
    setWordsCount(getSavedWords().length)
    setPronCount(getSavedPronunciations().length)

    // 待复习数（异步）
    getDueCount()
      .then(setDueCount)
      .catch(e => console.warn('[LibraryPage] 获取待复习数失败', e))

    // 我的语料：Supabase 异步读，并行计算每条语料的匹配题数和主维度
    listMyCorpus()
      .then(async (corpus) => {
        const stories = await Promise.all(
          corpus.map(async (c) => {
            let matchedCount = 0
            let dimension: MyStory['dimension'] = undefined
            try {
              const { codes, primaryCode } = await getCorpusPointCodes(c.id)
              matchedCount = await getQuestionCountByObservations(codes)
              dimension = primaryCode ? codeToLabel(primaryCode) : undefined
            } catch (err: unknown) {
              console.warn('[LibraryPage] 计算语料匹配数失败，保留默认值', err)
            }
            return {
              id: c.id,
              inputType: c.source,
              content: c.cleanedText ?? c.rawText,
              createdAt: formatRelativeTime(c.createdAt),
              duration: undefined,
              matchedCount,
              dimension,
            }
          })
        )
        setStories(stories)
      })
      .catch((e: unknown) => {
        console.error('[LibraryPage] 加载语料失败', e)
        setError('加载语料失败，请重试')
      })
      .finally(() => setLoading(false))
  }, [])

  const onDeleteStory = useCallback((id: string) => {
    setStories(prev => prev.filter(s => s.id !== id))
    deleteCorpus(id).catch(e => console.error('[LibraryPage] 删除语料失败', e))
  }, [])

  const viewProps = { stories, cards, wordsCount, pronCount, dueCount, loading, error, onDeleteStory }

  return (
    <>
      <div className="lg:hidden"><LibraryMobile {...viewProps} /></div>
      <div className="hidden lg:block"><LibraryDesktop {...viewProps} /></div>
    </>
  )
}
