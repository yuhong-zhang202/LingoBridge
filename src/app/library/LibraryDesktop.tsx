/**
 * @module   LibraryDesktop
 * @desc     素材库（桌面端）— 顶部导航 + 面包屑页头 + 今日复习 hero + 四类 Tab + 2 列卡片网格。密面板风（对齐题库 v3）。
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import TopNav from '@/components/TopNav'
import ManageHeader, { MANAGE_CONTAINER } from '@/components/ManageHeader'
import RequireAccountGate from '@/components/RequireAccountGate'
import Card from '@/components/Card'
import Skeleton from '@/components/Skeleton'
import OfflineState from '@/components/OfflineState'
import CollectedCardsTab from '@/components/library/CollectedCardsTab'
import SavedWordsTab from '@/components/library/SavedWordsTab'
import PronunciationTab from '@/components/library/PronunciationTab'
import MyStoriesTab from '@/components/library/MyStoriesTab'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import type { LibraryViewProps } from './types'

type Tab = 'cards' | 'phrases' | 'pron' | 'stories'

export default function LibraryDesktop({ stories, cards, wordsCount, pronCount, dueCount, loading, error, onDeleteStory }: LibraryViewProps) {
  const [tab, setTab] = useState<Tab>('cards')
  const totalCount = stories.length + cards.length + wordsCount + pronCount

  const TABS = [
    { id: 'cards',   label: '收藏卡片', count: cards.length },
    { id: 'phrases', label: '词组收藏', count: wordsCount },
    { id: 'pron',    label: '发音',     count: pronCount },
    { id: 'stories', label: '我的语料', count: stories.length },
  ] as const

  return (
    <div className="min-h-screen bg-bg-page">
      <TopNav containerClassName={MANAGE_CONTAINER} />

      <RequireAccountGate>
        <main className={`${MANAGE_CONTAINER} pb-12`}>
          <ManageHeader
            title="我的素材库"
            subtitle={`已攒下 ${totalCount} 条，慢慢成你自己的表达库`}
            right={<Search size={18} className="text-v2-text-muted" aria-label="搜索" />}
          />

          {/* 今日复习 hero —— 复用 /review 入口 */}
          <Link href="/review" className="block">
            <Card variant="gradient" className="px-[22px] py-[18px] flex items-center gap-5 active:scale-[0.99] transition-transform">
              <div className="flex-1 min-w-0">
                <span className="text-[12px] font-semibold text-brand-primary-dark">今日复习 · 词组闪卡</span>
                <p className="text-[17px] font-bold text-v2-text-primary mt-1">
                  {dueCount > 0
                    ? <><span className="text-brand-primary-dark">{dueCount}</span> 张词卡，等你翻一翻</>
                    : '今天没有要复习的卡'}
                </p>
                <p className="text-[13px] text-v2-text-secondary mt-1">把收藏的词组记牢——一天几张，不费劲。</p>
              </div>
              <span className="inline-flex items-center gap-[3px] rounded-full px-5 py-2.5 text-[14px] font-medium flex-shrink-0" style={GRADIENT_BORDER_STYLE}>
                <span className="text-v2-text-secondary">开始复习</span>
                <span className="text-brand-primary-dark">›</span>
              </span>
            </Card>
          </Link>

          {/* 四类 Tab 分段切换 */}
          <div className="flex gap-[3px] p-[3px] bg-bg-inner rounded-[10px] w-fit max-w-full my-5 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 text-[13px] px-[16px] py-[7px] rounded-[8px] whitespace-nowrap transition-colors ${tab === t.id ? 'bg-white text-v2-text-primary font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-v2-text-muted font-medium'}`}
              >
                {t.label}<span className="text-[12px] text-v2-text-muted">{t.count}</span>
              </button>
            ))}
          </div>

          {/* 当前 Tab 内容（复用现有子组件，列表在 lg 下两栏） */}
          {tab === 'cards'   && <CollectedCardsTab cards={cards} />}
          {tab === 'phrases' && <SavedWordsTab />}
          {tab === 'pron'    && <PronunciationTab />}
          {tab === 'stories' && (
            loading ? (
              <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-3">
                {[0, 1, 2].map((i) => (
                  <Card key={i} variant="gradient" className="p-4">
                    <div className="flex items-center justify-between mb-2.5">
                      <Skeleton className="w-16 h-5 rounded-full" />
                      <Skeleton className="w-4 h-4 rounded-full" />
                    </div>
                    <Skeleton className="w-full h-[14px]" />
                    <Skeleton className="w-[88%] h-[14px] mt-2" />
                    <Skeleton className="w-[60%] h-[14px] mt-2" />
                    <div className="flex items-center gap-2 mt-2.5">
                      <Skeleton className="w-14 h-[22px] rounded-full" />
                      <Skeleton className="w-24 h-3" />
                    </div>
                  </Card>
                ))}
              </div>
            ) : error ? (
              typeof navigator !== 'undefined' && !navigator.onLine
                ? <OfflineState onRetry={() => window.location.reload()} />
                : <p className="text-[13px] text-error text-center pt-16">{error}</p>
            ) : (
              <MyStoriesTab stories={stories} onDelete={onDeleteStory} />
            )
          )}
        </main>
      </RequireAccountGate>
    </div>
  )
}
