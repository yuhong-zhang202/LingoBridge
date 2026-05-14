'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Star, ArrowRight, Sparkles, ArrowLeft } from 'lucide-react'
import Button from '@/components/ui-v2/Button'
import Badge from '@/components/ui-v2/Badge'
import BottomNav from '@/components/ui-v2/BottomNav'
import StepProgress from '@/components/ui-v2/StepProgress'

const PART_COLORS: Record<string, string> = {
  'Part 1': '#7BA699',
  'Part 2': '#D4875A',
  'Part 3': '#9A7DB8',
}

const QUESTIONS = [
  {
    part: 'Part 1', hot: true,
    en: 'Do you often go to parks or outdoor spaces?',
    zh: '你经常去公园吗？',
    tags: ['公园', '自然', '放松'],
  },
  {
    part: 'Part 2', hot: true,
    en: 'Describe a place in nature you like to visit.',
    zh: '描述你喜欢的自然环境中的一个地方。',
    tags: ['户外', '情绪', '感受'],
  },
  {
    part: 'Part 1', hot: false,
    en: 'What do you do on weekends?',
    zh: '你周末都做些什么？',
    tags: ['周末', '休闲'],
  },
  {
    part: 'Part 3', hot: false,
    en: 'How has urbanization affected access to nature?',
    zh: '城镇化如何影响人们接触自然的机会？',
    tags: ['城市化', '社会话题'],
  },
]

const PARTS = ['全部', 'Part 1', 'Part 2', 'Part 3']
const STEPS = ['故事', '文章', '题目', '练习', '反馈']

export default function V2MatchPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('全部')

  const filtered =
    activeTab === '全部' ? QUESTIONS : QUESTIONS.filter(q => q.part === activeTab)

  return (
    <div className="min-h-screen bg-bg-base flex flex-col pb-[60px]">
      <div className="w-full flex items-center justify-between h-[56px] px-5">
        <button
          onClick={() => router.back()}
          className="w-[36px] h-[36px] rounded-full bg-bg-surface shadow-sm flex items-center justify-center"
        >
          <ArrowLeft size={16} className="text-v2-text-secondary" />
        </button>
        <span className="text-[15px] font-bold text-v2-text-primary">题目匹配</span>
        <div className="w-[36px]" />
      </div>

      <StepProgress steps={STEPS} current={2} />

      <div className="flex-1 overflow-y-auto px-5">
        {/* Story preview */}
        <div className="bg-bg-surface rounded-[14px] border border-black/[0.05] px-4 py-2.5 mb-5 flex items-center gap-2">
          <Sparkles size={13} className="text-v2-text-muted flex-shrink-0" />
          <span className="text-[12px] text-v2-text-secondary italic truncate">
            「上周末我去了附近的公园...」
          </span>
        </div>

        <h2 className="text-[20px] font-bold text-v2-text-primary mb-1">
          匹配到 {QUESTIONS.length} 道当季真题
        </h2>
        <p className="text-[12px] text-v2-text-muted mb-5">覆盖 Part 1 · Part 2 · Part 3</p>

        {/* Part filter */}
        <div className="flex gap-2 mb-5 overflow-x-auto v2-scrollbar-hide pb-1">
          {PARTS.map(p => (
            <button
              key={p}
              onClick={() => setActiveTab(p)}
              className={`flex-shrink-0 px-3.5 py-[5px] rounded-full text-[12px] font-medium transition-all duration-150 ${
                activeTab === p
                  ? 'bg-brand-primary text-white'
                  : 'bg-bg-muted text-v2-text-muted border border-black/[0.07]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Question cards */}
        <div className="flex flex-col gap-3 mb-6">
          {filtered.map((item, i) => (
            <div
              key={i}
              className="relative bg-bg-surface rounded-[20px] border border-black/[0.05] shadow-sm overflow-hidden"
            >
              <div
                className="absolute left-0 top-0 bottom-0 w-[4px]"
                style={{ background: PART_COLORS[item.part] }}
              />
              <div className="pl-5 pr-4 py-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <span
                    className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full text-white"
                    style={{ background: PART_COLORS[item.part] }}
                  >
                    {item.part}
                  </span>
                  {item.hot && <Badge variant="hot" label="当季热题" />}
                </div>
                <p className="text-[15px] font-bold text-v2-text-primary leading-snug">
                  {item.en}
                </p>
                <p className="text-[12px] text-v2-text-muted mt-0.5 mb-3">{item.zh}</p>
                <div className="flex gap-1.5 flex-wrap mb-3">
                  {item.tags.map(tag => (
                    <span
                      key={tag}
                      className="text-[10px] bg-bg-muted text-v2-text-secondary px-2 py-0.5 rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <button>
                    <Star size={15} className="text-[#CCCCCC]" />
                  </button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => router.push('/v2/practice-dialog')}
                  >
                    练习 <ArrowRight size={11} />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
