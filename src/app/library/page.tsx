/**
 * @module   LibraryPage
 * @desc     素材库页面 — 我的语料（Supabase）+ 收藏卡片（localStorage）
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useState, useEffect } from 'react'
import { Search } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import CollectedCardsTab from '@/components/library/CollectedCardsTab'
import MyStoriesTab from '@/components/library/MyStoriesTab'
import SavedWordsTab from '@/components/library/SavedWordsTab'
import PronunciationTab from '@/components/library/PronunciationTab'
import { listMyCorpus, getCorpusPointCodes, deleteCorpus } from '@/lib/db/corpus'
import { getQuestionCountByObservations } from '@/lib/db/questions'
import { DIMENSION_LABEL } from '@/lib/constants'
import { getSavedPhrases } from '@/lib/storage'
import { formatRelativeTime } from '@/lib/utils'
import type { MyStory, CollectedCard, DimensionLabel } from '@/lib/types'

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

type Tab = 'stories' | 'cards' | 'words' | 'pron'

const TABS: { key: Tab; label: string }[] = [
  { key: 'stories', label: '我的语料' },
  { key: 'cards',   label: '收藏卡片' },
  { key: 'words',   label: '词组收藏' },
  { key: 'pron',    label: '发音' },
]

export default function LibraryPage() {
  const [activeTab, setActiveTab] = useState<Tab>('stories')
  const [stories, setStories]     = useState<MyStory[]>([])
  const [cards, setCards]         = useState<CollectedCard[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    // 收藏卡片：localStorage 同步读，立即可用
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

  return (
    <div
      className="relative flex flex-col bg-bg-page overflow-hidden"
      style={{ height: '100dvh', paddingBottom: 'calc(56px + env(safe-area-inset-bottom))' }}
    >
      <TopBar
        title="素材库"
        right={<Search size={18} className="text-v2-text-muted" />}
      />

      <div className="flex border-b border-black/[0.06] mx-5 mb-3">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 pb-2.5 text-center text-[13px] font-medium relative transition-colors ${
              activeTab === key ? 'text-brand-primary-dark' : 'text-v2-text-muted'
            }`}
          >
            {label}
            {activeTab === key && (
              <div className="absolute bottom-0 left-[20%] right-[20%] h-[2px] rounded-full bg-gradient-to-r from-brand-primary to-brand-accent" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-6 relative z-10">
        {activeTab === 'stories' && (
          loading
            ? <p className="text-[13px] text-v2-text-muted text-center pt-16">加载中…</p>
            : error
              ? <p className="text-[13px] text-error text-center pt-16">{error}</p>
              : <MyStoriesTab stories={stories} onDelete={(id) => {
                  setStories(prev => prev.filter(s => s.id !== id))
                  deleteCorpus(id).catch(e => console.error('[LibraryPage] 删除语料失败', e))
                }} />
        )}
        {activeTab === 'cards' && <CollectedCardsTab cards={cards} />}
        {activeTab === 'words' && <SavedWordsTab />}
        {activeTab === 'pron' && <PronunciationTab />}
      </div>

      <TabBar />
    </div>
  )
}
