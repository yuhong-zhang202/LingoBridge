'use client'
import { useState } from 'react'
import { Search } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import CollectedCardsTab from '@/components/library/CollectedCardsTab'
import MyStoriesTab from '@/components/library/MyStoriesTab'
import { COLLECTED_CARDS, MY_STORIES_NEW } from '@/data/library'

type Tab = 'stories' | 'cards'

const TABS: { key: Tab; label: string }[] = [
  { key: 'stories', label: '我的语料' },
  { key: 'cards',   label: '收藏卡片' },
]

export default function LibraryPage() {
  const [activeTab, setActiveTab] = useState<Tab>('stories')

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
        {activeTab === 'stories' && <MyStoriesTab stories={MY_STORIES_NEW} />}
        {activeTab === 'cards'   && <CollectedCardsTab cards={COLLECTED_CARDS} />}
      </div>

      <TabBar />
    </div>
  )
}
