'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Volume2, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'
import { GRADIENT_BORDER_STYLE_FULL as GRADIENT_BORDER } from '@/lib/constants'
import { ARTICLE_TEXT } from '@/data/article'

const BANDS = [
  { value: '5.5', label: '简单流畅，日常表达' },
  { value: '6.0', label: '结构完整，用词准确' },
  { value: '6.5', label: '逻辑清晰，词汇丰富' },
  { value: '7.0', label: '地道表达，接近母语' },
]

const BAND_MAP: Record<string, string> = {
  '5.5': '简单流畅，日常表达',
  '6.0': '结构完整，用词准确',
  '6.5': '逻辑清晰，词汇丰富',
  '7.0': '地道表达，接近母语',
}

export default function ArticlePage() {
  const router = useRouter()
  const [selected, setSelected] = useState('6.0')
  const [bandOpen, setBandOpen] = useState(false)
  const [generated, setGenerated] = useState(true)
  const [showOriginal, setShowOriginal] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(ARTICLE_TEXT)

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <div className="ambient-light" />
      <TopBar title="生成口语文章" />
      <StepBar currentStep="article" />

      <div className="flex-1 overflow-y-auto px-6 pb-8 relative z-10">

        {/* Band 选择 Accordion */}
        {!bandOpen ? (
          /* 收起状态 */
          <button
            onClick={() => setBandOpen(true)}
            className="w-full flex items-center justify-between bg-white rounded-[14px] px-4 py-3.5 border border-black/[0.07] transition-all duration-200"
          >
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-medium text-[#AAAAAA] uppercase tracking-wide">
                目标等级
              </span>
              <div
                className="flex items-center gap-2 px-2.5 py-1 rounded-full"
                style={GRADIENT_BORDER}
              >
                <span className="text-[13px] font-bold text-[#333]">
                  Band {selected}
                </span>
              </div>
              <span className="text-[12px] text-[#888]">
                {BAND_MAP[selected]}
              </span>
            </div>
            <ChevronDown size={15} className="text-[#AAAAAA]" />
          </button>
        ) : (
          /* 展开状态 */
          <div className="rounded-[16px] border border-black/[0.07] overflow-hidden bg-white">
            {/* 展开头部 */}
            <button
              onClick={() => setBandOpen(false)}
              className="w-full flex items-center justify-between px-4 py-3.5 border-b border-black/[0.05]"
            >
              <span className="text-[13px] font-medium text-[#333]">
                选择目标等级
              </span>
              <ChevronUp size={15} className="text-[#AAAAAA]" />
            </button>

            {/* 选项列表 */}
            <div className="flex flex-col accordion-open">
              {BANDS.map((b, index) => {
                const active = selected === b.value
                const isLast = index === BANDS.length - 1
                return (
                  <button
                    key={b.value}
                    onClick={() => {
                      setSelected(b.value)
                      setBandOpen(false)
                    }}
                    className={`
                      flex items-center gap-3
                      px-4 py-3
                      transition-colors duration-150
                      ${!isLast ? 'border-b border-black/[0.04]' : ''}
                      ${active ? 'bg-[#FAFAFA]' : 'bg-white'}
                    `}
                  >
                    <div
                      className="w-[26px] h-[26px] rounded-full flex items-center justify-center flex-shrink-0 text-[12px] font-bold"
                      style={active ? GRADIENT_BORDER : {
                        background: '#F4F4F4', color: '#888',
                      }}
                    >
                      {b.value}
                    </div>
                    <div className="flex-1 text-left">
                      <span className="text-[14px] font-semibold text-[#111]">
                        Band {b.value}
                      </span>
                      <span className="text-[12px] text-[#888] ml-2">
                        {b.label}
                      </span>
                    </div>
                    {active && (
                      <div
                        className="w-[16px] h-[16px] rounded-full flex items-center justify-center"
                        style={GRADIENT_BORDER}
                      >
                        <div className="w-[6px] h-[6px] rounded-full bg-[#555]" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* 生成按钮 */}
        <button
          onClick={() => setGenerated(true)}
          className="btn-gradient w-full h-[46px] mb-6 mt-3"
        >
          <Sparkles size={15} className="text-[#555]" />
          生成我的口语文章
        </button>

        {/* 文章展示区 */}
        {generated && (
          <div className="animate-fade-up">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-black/[0.06]" />
              <span className="text-[11px] text-[#CCCCCC] whitespace-nowrap">
                AI 已生成你的 Band {selected} 文章
              </span>
              <div className="flex-1 h-px bg-black/[0.06]" />
            </div>

            <div className="card p-5 mb-5">
              {/* 卡片顶行 */}
              <div className="flex items-center justify-between mb-4">
                <span
                  className="text-[12px] font-semibold text-[#444] px-3 py-1 rounded-full"
                  style={GRADIENT_BORDER}
                >
                  Band {selected}
                </span>
                <div className="flex items-center gap-2">
                  <button className="w-[30px] h-[30px] rounded-full bg-[#F4F4F4] flex items-center justify-center">
                    <Volume2 size={13} className="text-[#888]" />
                  </button>
                  <button
                    onClick={() => setIsEditing(!isEditing)}
                    className="flex items-center gap-1 px-3 py-1 rounded-[10px] text-[13px] active:scale-[0.97] transition-transform duration-150"
                    style={{ backgroundColor: '#EEF7F3', color: '#5A9E8A' }}
                  >
                    {isEditing ? '✓ 保存' : '✎ 编辑'}
                  </button>
                </div>
              </div>

              {/* 文章正文 */}
              {isEditing ? (
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="w-full text-[17px] text-[#111] leading-[1.9] bg-transparent outline-none resize-none mb-4"
                  style={{ minHeight: 140 }}
                  autoFocus
                />
              ) : (
                <p className="text-[17px] text-[#111] leading-[1.9] mb-4">
                  {editContent.split(' ').map((word, i) =>
                    word === 'genuinely' ? (
                      <span key={i} className="relative inline-block">
                        <span className="bg-[rgba(168,210,196,0.22)] rounded px-[2px]">
                          {word}{' '}
                        </span>
                        <span className="absolute left-0 top-full mt-1 bg-white rounded-xl px-2.5 py-1.5 z-10 text-[11px] text-[#666] shadow-md whitespace-nowrap border border-black/[0.05]">
                          /ˈdʒenjuɪnli/ · 真正地
                        </span>
                      </span>
                    ) : (
                      <span key={i}>{word} </span>
                    )
                  )}
                </p>
              )}

              {/* 查看原始故事 */}
              <button
                onClick={() => setShowOriginal(!showOriginal)}
                className="flex items-center gap-1.5 text-[12px] text-[#AAAAAA]"
              >
                <ChevronDown
                  size={13}
                  className={`transition-transform ${showOriginal ? 'rotate-180' : ''}`}
                />
                查看你的原始故事
              </button>

              {showOriginal && (
                <div className="surface px-3 py-2.5 mt-3">
                  <p className="text-[13px] text-[#888] leading-relaxed">
                    我今天去了一个公园，感觉非常开心。空气很好，待了挺长时间...
                  </p>
                </div>
              )}
            </div>

            {/* 层级1：主操作 - 开始练习 */}
            <button
              onClick={() => router.push('/matching')}
              className="btn-gradient w-full h-[50px] text-[15px]"
            >
              开始练习 →
            </button>

            {/* 层级2：弱操作 - 重新生成 */}
            <button className="w-full text-center text-[12px] text-[#CCCCCC] mt-1 py-1">
              重新生成
            </button>

            <div className="mb-8" />
          </div>
        )}
      </div>
    </div>
  )
}
