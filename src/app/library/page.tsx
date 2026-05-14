'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Mic2, BookOpen, CheckCircle,
  Circle, ChevronRight, ChevronDown,
  Plus,
} from 'lucide-react'
import TabBar from '@/components/TabBar'

// ── 数据类型 ──

type Story = {
  id: string
  title: string
  preview: string
  date: string
  band: string
  matchCount: number
}

type Question = {
  id: string
  part: 'Part 1' | 'Part 2' | 'Part 3'
  en: string
  zh: string
  hasStory: boolean
  storyTitle?: string
}

// ── 静态数据 ──

const MY_STORIES: Story[] = [
  {
    id: '1',
    title: '公园的周末',
    preview: '上周末我去了附近的公园，空气很好...',
    date: '昨天',
    band: '6.0',
    matchCount: 3,
  },
  {
    id: '2',
    title: '工作的烦恼',
    preview: '今天开会又迟到了，被经理说了一顿...',
    date: '3天前',
    band: '6.5',
    matchCount: 2,
  },
  {
    id: '3',
    title: '和朋友的晚餐',
    preview: '昨晚和大学同学聚餐，去了一家新开的...',
    date: '5天前',
    band: '6.0',
    matchCount: 4,
  },
]

const QUESTIONS_BY_PART: Record<string, Question[]> = {
  'Part 1': [
    {
      id: 'q1',
      part: 'Part 1',
      en: 'Do you often go to parks or outdoor spaces?',
      zh: '你经常去公园吗？',
      hasStory: true,
      storyTitle: '公园的周末',
    },
    {
      id: 'q2',
      part: 'Part 1',
      en: 'What outdoor activities do you enjoy?',
      zh: '你喜欢哪些户外活动？',
      hasStory: false,
    },
    {
      id: 'q3',
      part: 'Part 1',
      en: 'Do you prefer working indoors or outdoors?',
      zh: '你更喜欢在室内还是室外工作？',
      hasStory: false,
    },
  ],
  'Part 2': [
    {
      id: 'q4',
      part: 'Part 2',
      en: 'Describe a place in nature you like to visit.',
      zh: '描述你喜欢的自然场所。',
      hasStory: true,
      storyTitle: '公园的周末',
    },
    {
      id: 'q5',
      part: 'Part 2',
      en: 'Describe a time when you felt relaxed.',
      zh: '描述一次你感到放松的经历。',
      hasStory: false,
    },
  ],
  'Part 3': [
    {
      id: 'q6',
      part: 'Part 3',
      en: 'Why do people need green spaces in cities?',
      zh: '为什么城市需要绿色空间？',
      hasStory: false,
    },
  ],
}

const GRADIENT_BORDER_STYLE = {
  background: [
    'linear-gradient(white, white) padding-box',
    'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80)) border-box',
  ].join(','),
  border: '1.5px solid transparent',
} as React.CSSProperties

// ── 子组件：我的素材 Tab ──

function MyStoriesTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (MY_STORIES.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
        <div
          className="w-[80px] h-[80px] rounded-full mb-6"
          style={{
            background: 'radial-gradient(circle, rgba(240,188,160,0.30) 0%, rgba(168,210,196,0.20) 50%, transparent 70%)',
            filter: 'blur(4px)',
          }}
        />
        <p className="text-[16px] font-semibold text-[#333] mb-2">
          还没有故事素材
        </p>
        <p className="text-[13px] text-[#888] leading-relaxed mb-6">
          说一个今天发生的小事，
          Lingo 帮你变成口语素材
        </p>
        <button
          onClick={() => router.push('/recording')}
          className="btn-gradient h-[44px] px-6 text-[14px]"
        >
          <Mic2 size={15} className="text-[#555]" />
          去录一个故事
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-6 pb-8">
      {MY_STORIES.map(story => {
        const isSelected = selectedId === story.id
        return (
          <div
            key={story.id}
            onClick={() => setSelectedId(isSelected ? null : story.id)}
            className="bg-white rounded-[18px] overflow-hidden flex border border-black/[0.05] cursor-pointer transition-shadow duration-200"
            style={{
              boxShadow: isSelected
                ? '0 2px 16px rgba(212,135,90,0.12)'
                : '0 1px 8px rgba(0,0,0,0.05)',
            }}
          >
            {/* 左侧竖条：选中渐变，未选中透明 */}
            <div className="w-[4px] flex-shrink-0 self-stretch">
              {isSelected ? (
                <div
                  className="w-full h-full"
                  style={{ background: 'linear-gradient(to bottom, rgba(240,188,160,0.85), rgba(168,210,196,0.80))' }}
                />
              ) : (
                <div className="w-full h-full bg-transparent" />
              )}
            </div>

            <div className="flex-1 p-4">
              {/* 头部行 */}
              <div className="flex items-start justify-between mb-2">
                <p className="text-[15px] font-semibold text-[#111]">
                  {story.title}
                </p>
                <span className="text-[11px] text-[#BBBBBB] ml-2 mt-0.5 flex-shrink-0">
                  {story.date}
                </span>
              </div>

              {/* 预览文字 */}
              <p className="text-[13px] text-[#888] leading-relaxed mb-3 line-clamp-1">
                {story.preview}
              </p>

              {/* 元信息行 */}
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="text-[11px] font-semibold text-[#444] px-2 py-0.5 rounded-full"
                  style={GRADIENT_BORDER_STYLE}
                >
                  Band {story.band}
                </span>
                <span className="text-[11px] text-[#AAAAAA]">
                  匹配了 {story.matchCount} 道题
                </span>
              </div>

              {/* 操作行 */}
              <div className="flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); router.push('/article-view') }}
                  className="flex-1 h-[36px] rounded-full border border-black/[0.10] text-[12px] font-medium text-[#666] flex items-center justify-center gap-1"
                >
                  查看文章
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); router.push('/practice') }}
                  className="flex-1 h-[36px] rounded-full text-[12px] font-semibold text-[#444] flex items-center justify-center gap-1"
                  style={GRADIENT_BORDER_STYLE}
                >
                  开始练习
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {/* 新增素材入口 */}
      <button
        onClick={() => router.push('/')}
        className="w-full h-[50px] rounded-[16px] border border-dashed border-black/[0.12] flex items-center justify-center gap-2 text-[13px] text-[#AAAAAA]"
      >
        <Plus size={15} className="text-[#CCCCCC]" />
        录制新故事
      </button>
    </div>
  )
}

// ── 子组件：当季题库 Tab ──

function QuestionBankTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const [openParts, setOpenParts] = useState<string[]>(['Part 1'])

  const togglePart = (part: string) => {
    setOpenParts(prev =>
      prev.includes(part)
        ? prev.filter(p => p !== part)
        : [...prev, part]
    )
  }

  const partCounts: Record<string, number> = {
    'Part 1': QUESTIONS_BY_PART['Part 1'].length,
    'Part 2': QUESTIONS_BY_PART['Part 2'].length,
    'Part 3': QUESTIONS_BY_PART['Part 3'].length,
  }

  const hasStoryCount = (part: string) =>
    QUESTIONS_BY_PART[part].filter(q => q.hasStory).length

  const totalCount = Object.values(partCounts).reduce((a, b) => a + b, 0)

  return (
    <div className="flex flex-col pb-8">

      {/* 季度说明 */}
      <div className="px-6 mb-4">
        <p className="text-[13px] text-[#888]">
          2026年1–4月 · 共 {totalCount} 道真题
        </p>
      </div>

      {/* Part 分组 */}
      {(['Part 1', 'Part 2', 'Part 3'] as const).map(part => {
        const isOpen = openParts.includes(part)
        const questions = QUESTIONS_BY_PART[part]
        const withStory = hasStoryCount(part)

        return (
          <div key={part} className="mb-1">

            {/* Part 标题行 */}
            <button
              onClick={() => togglePart(part)}
              className="w-full flex items-center justify-between px-6 py-3.5 bg-bg-page"
            >
              <div className="flex items-center gap-3">
                <span className="text-[15px] font-semibold text-[#111]">
                  {part}
                </span>
                <span className="text-[12px] text-[#AAAAAA]">
                  {withStory}/{partCounts[part]} 有素材
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#F4F4F4] text-[#888]">
                  {partCounts[part]} 题
                </span>
                <ChevronDown
                  size={15}
                  className={`text-[#AAAAAA] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                />
              </div>
            </button>

            {/* 题目列表 */}
            {isOpen && (
              <div className="px-6 flex flex-col gap-2 pb-3 animate-fade-up">
                {questions.map(q => (
                  <div
                    key={q.id}
                    className={`
                      bg-white rounded-[16px] p-4
                      border border-black/[0.05]
                      shadow-[0_1px_6px_rgba(0,0,0,0.04)]
                      border-l-[3px]
                      ${q.hasStory
                        ? 'border-l-[rgba(168,210,196,0.70)]'
                        : 'border-l-transparent'
                      }
                    `}
                  >
                    {/* 有无素材指示 */}
                    <div className="flex items-center gap-1.5 mb-2">
                      {q.hasStory ? (
                        <>
                          <CheckCircle size={12} className="text-[#7BA699]" />
                          <span className="text-[11px] text-[#7BA699] font-medium">
                            已有素材
                          </span>
                          {q.storyTitle && (
                            <span className="text-[11px] text-[#AAAAAA]">
                              · {q.storyTitle}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <Circle size={12} className="text-[#CCCCCC]" />
                          <span className="text-[11px] text-[#CCCCCC]">
                            暂无素材
                          </span>
                        </>
                      )}
                    </div>

                    {/* 题目正文 */}
                    <p className="text-[14px] font-bold text-[#111] leading-snug mb-1">
                      {q.en}
                    </p>
                    <p className="text-[12px] text-[#AAAAAA] mb-3">
                      {q.zh}
                    </p>

                    {/* 操作 */}
                    {q.hasStory ? (
                      <button
                        onClick={() => router.push('/practice')}
                        className="h-[34px] px-4 rounded-full text-[12px] font-semibold text-[#444] flex items-center gap-1"
                        style={GRADIENT_BORDER_STYLE}
                      >
                        用素材练习
                        <ChevronRight size={12} />
                      </button>
                    ) : (
                      <button
                        onClick={() => router.push('/recording')}
                        className="h-[34px] px-4 rounded-full border border-black/[0.10] text-[12px] font-medium text-[#888] flex items-center gap-1"
                      >
                        <Plus size={12} />
                        去录一个素材
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── 主页面 ──

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
          {/* 渐变描边容器 */}
          <div className="flex-1" style={{ background: 'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80))', borderRadius: 16, padding: 1.5 }}>
            <div className="bg-white rounded-[14px] p-3.5">
              <p className="text-[24px] font-bold" style={{ color: '#C9905A' }}>
                {totalStories}
              </p>
              <p className="text-[11px] text-[#AAAAAA] mt-0.5">
                个故事素材
              </p>
            </div>
          </div>
          <div className="flex-1" style={{ background: 'linear-gradient(135deg, rgba(240,188,160,0.85), rgba(168,210,196,0.80))', borderRadius: 16, padding: 1.5 }}>
            <div className="bg-white rounded-[14px] p-3.5">
              <p className="text-[24px] font-bold" style={{ color: '#7BA699' }}>9</p>
              <p className="text-[11px] text-[#AAAAAA] mt-0.5">
                道题已练习
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="px-6 mb-4 relative z-10">
        <div className="bg-white rounded-[12px] p-1 flex border border-black/[0.05]">
          <button
            onClick={() => setActiveTab('stories')}
            className={`
              flex-1 h-[34px] rounded-[10px]
              text-[13px] font-medium
              transition-all duration-200
              flex items-center justify-center gap-1.5
              ${activeTab === 'stories' ? 'bg-[#F4F4F4] text-[#111]' : 'text-[#AAAAAA]'}
            `}
          >
            <Mic2 size={13} />
            我的素材
          </button>
          <button
            onClick={() => setActiveTab('bank')}
            className={`
              flex-1 h-[34px] rounded-[10px]
              text-[13px] font-medium
              transition-all duration-200
              flex items-center justify-center gap-1.5
              ${activeTab === 'bank' ? 'bg-[#F4F4F4] text-[#111]' : 'text-[#AAAAAA]'}
            `}
          >
            <BookOpen size={13} />
            当季题库
          </button>
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto relative z-10">
        {activeTab === 'stories'
          ? <MyStoriesTab router={router} />
          : <QuestionBankTab router={router} />
        }
      </div>

      <TabBar />
    </div>
  )
}
