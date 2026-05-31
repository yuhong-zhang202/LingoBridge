'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import { ARTICLE_TEXT, WORD_DEFINITIONS as DEFINITIONS } from '@/data/article'

const ORIGINAL_STORY = `上周末我去了附近的公园，空气很好，心情也轻松了很多。待了很长时间，感觉充了电一样。`

function clean(word: string) {
  return word.replace(/[.,!?;:'"]/g, '').toLowerCase()
}

export default function ArticleViewPage() {
  const router = useRouter()
  const [activeWord, setActiveWord] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(ARTICLE_TEXT)

  const tokens = editContent.split(' ')

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">

      {/* 顶部导航 */}
      <div className="flex items-center justify-between h-[52px] px-5 relative z-10">
        <button
          onClick={() => router.back()}
          className="w-[30px] h-[30px] rounded-full bg-white shadow-sm flex items-center justify-center active:scale-[0.97] transition-transform"
        >
          <ChevronLeft size={15} className="text-[#333]" />
        </button>
        <span className="text-[16px] font-semibold text-[#111]">我的口语素材</span>
        <button
          onClick={() => {
            if (isEditing) setIsEditing(false)
            else setIsEditing(true)
          }}
          className="flex items-center gap-1 px-3 py-1 rounded-[10px] text-[13px] active:scale-[0.97] transition-transform duration-150"
          style={{ backgroundColor: '#F0EDE9', color: '#C9905A' }}
        >
          {isEditing ? '✓ 保存' : '✎ 编辑'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-[88px] relative z-10">

        {/* Band 标签 + 故事标题 */}
        <div className="flex items-center gap-2 mb-4">
          <span
            className="text-[12px] font-semibold text-[#444] px-3 py-1 rounded-full"
            style={GRADIENT_BORDER_STYLE}
          >
            Band 6.0
          </span>
          <span className="text-[12px] text-[#AAAAAA]">公园的周末</span>
        </div>

        {/* 文章卡片 */}
        <div className="card p-5 mb-5">
          {isEditing ? (
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              className="w-full text-[18px] text-[#1A1A1A] leading-[1.7] bg-transparent outline-none resize-none"
              style={{ minHeight: 160 }}
              autoFocus
            />
          ) : (
            <p className="text-[18px] text-[#1A1A1A] leading-[1.7] mb-4">
              {tokens.map((token, i) => {
                const key = clean(token)
                const def = DEFINITIONS[key]
                const isActive = activeWord === key
                const suffix = token.match(/[.,!?;:'"]+$/)?.[0] ?? ''
                const word = suffix ? token.slice(0, -suffix.length) : token

                if (!def) {
                  return <span key={i}>{token} </span>
                }

                return (
                  <span key={i} className="relative inline">
                    <span
                      onClick={() => setActiveWord(isActive ? null : key)}
                      className="cursor-pointer rounded px-[2px]"
                      style={{ background: 'rgba(168,210,196,0.25)' }}
                    >
                      {word}
                    </span>
                    {suffix}
                    {' '}
                    {isActive && (
                      <span
                        className="absolute z-20 whitespace-nowrap rounded-[10px] px-3 py-2 text-left"
                        style={{
                          bottom: '100%',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          marginBottom: 8,
                          background: '#1A1A1A',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                        }}
                      >
                        <span className="block text-[11px] text-white/60 mb-0.5">
                          {def.phonetic}
                        </span>
                        <span className="block text-[12px] text-white">
                          {def.meaning}
                        </span>
                        {/* 小三角 */}
                        <span
                          className="absolute left-1/2 -translate-x-1/2"
                          style={{
                            bottom: -5,
                            width: 0,
                            height: 0,
                            borderLeft: '5px solid transparent',
                            borderRight: '5px solid transparent',
                            borderTop: '5px solid #1A1A1A',
                          }}
                        />
                      </span>
                    )}
                  </span>
                )
              })}
            </p>
          )}

          {/* 分割线 */}
          <div className="h-px bg-black/[0.06] mb-3" />

          {/* 原始故事 */}
          <p className="text-[11px] font-medium text-[#CCCCCC] uppercase tracking-wide mb-2">
            原始故事
          </p>
          <p className="text-[14px] text-[#888] leading-relaxed">
            {ORIGINAL_STORY}
          </p>
        </div>
      </div>

      {/* 固定底部操作栏 */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] flex items-center justify-between px-6 bg-bg-page border-t border-black/[0.05] z-20"
        style={{
          paddingTop: 14,
          paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
        }}
      >
        <button
          className="flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-medium active:scale-[0.97] transition-transform duration-150"
          style={{ backgroundColor: '#F0EDE9', color: '#C9905A' }}
        >
          ▶ 朗读全文
        </button>
        <button
          onClick={() => router.push('/practice')}
          className="flex items-center gap-1.5 px-5 py-2.5 rounded-full text-[14px] font-semibold text-[#444] active:scale-[0.97] transition-transform duration-150"
          style={GRADIENT_BORDER_STYLE}
        >
          去练习 →
        </button>
      </div>
    </div>
  )
}
