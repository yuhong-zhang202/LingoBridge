'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Mic2, BookOpen } from 'lucide-react'
import TabBar from '@/components/TabBar'
import MyStoriesTab from './MyStoriesTab'
import QuestionBankTab from './QuestionBankTab'
import { MY_STORIES, QUESTIONS_BY_PART } from '@/data/library'

export default function LibraryPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'stories' | 'bank'>('stories')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const totalStories = MY_STORIES.length
  const totalWithStory = Object.values(QUESTIONS_BY_PART)
    .flat()
    .filter(q => q.hasStory).length

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col pb-[56px]">
      <div className="ambient-light" />

      {/* 顶部 */}
      <div className="flex items-center justify-between h-[52px] px-6 bg-bg-page relative z-10">
        <span className="text-[18px] font-bold text-[#111]">素材库</span>
        <button
          onClick={() => setSearchOpen(!searchOpen)}
          className="w-[32px] h-[32px] rounded-full bg-white shadow-sm flex items-center justify-center"
        >
          <Search size={15} className="text-[#555]" />
        </button>
      </div>

      {/* 搜索框 */}
      {searchOpen && (
        <div className="px-6 pb-3 relative z-10 animate-fade-up">
          <div className="bg-white rounded-[12px] border border-black/[0.07] flex items-center gap-2 px-3 h-[40px]">
            <Search size={14} className="text-[#CCCCCC]" />
            <input
              type="text"
              placeholder="搜索题目或素材..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 text-[13px] text-[#333] bg-transparent outline-none placeholder:text-[#CCCCCC]"
              autoFocus
            />
          </div>
        </div>
      )}

      {/* 概况数据 */}
      <div className="px-6 pb-4 relative z-10">
        <div className="flex gap-3">
          <div className="flex-1" style={{ background: 'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80))', borderRadius: 16, padding: 1.5 }}>
            <div className="bg-white rounded-[14px] p-3.5">
              <p className="text-[24px] font-bold" style={{ color: '#C9905A' }}>
                {totalStories}
              </p>
              <p className="text-[11px] text-[#AAAAAA] mt-0.5">个故事素材</p>
            </div>
          </div>
          <div className="flex-1" style={{ background: 'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80))', borderRadius: 16, padding: 1.5 }}>
            <div className="bg-white rounded-[14px] p-3.5">
              <p className="text-[24px] font-bold" style={{ color: '#7BA699' }}>{totalWithStory}</p>
              <p className="text-[11px] text-[#AAAAAA] mt-0.5">已覆盖题目</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="px-6 mb-4 relative z-10">
        <div className="bg-white rounded-[12px] p-1 flex border border-black/[0.05]">
          <button
            onClick={() => setActiveTab('stories')}
            className={`flex-1 h-[34px] rounded-[10px] text-[13px] font-medium transition-all duration-200 flex items-center justify-center gap-1.5 ${activeTab === 'stories' ? 'bg-[#F4F4F4] text-[#111]' : 'text-[#AAAAAA]'}`}
          >
            <Mic2 size={13} />
            我的素材
          </button>
          <button
            onClick={() => setActiveTab('bank')}
            className={`flex-1 h-[34px] rounded-[10px] text-[13px] font-medium transition-all duration-200 flex items-center justify-center gap-1.5 ${activeTab === 'bank' ? 'bg-[#F4F4F4] text-[#111]' : 'text-[#AAAAAA]'}`}
          >
            <BookOpen size={13} />
            当季题库
          </button>
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto relative z-10">
        {activeTab === 'stories'
          ? <MyStoriesTab stories={MY_STORIES} onNavigate={router.push} />
          : <QuestionBankTab onNavigate={router.push} />
        }
      </div>

      <TabBar />
    </div>
  )
}
