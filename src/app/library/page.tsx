/**
 * @module   LibraryPage
 * @desc     素材库 — 积累主页 hub（v8）+ 二级列表（复用 4 个 Tab 组件）
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Search, ChevronLeft, ChevronRight, Mic2, MessageSquareText, BookOpen, Volume2 } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import Card from '@/components/Card'
import Skeleton from '@/components/Skeleton'
import OfflineState from '@/components/OfflineState'
import CollectedCardsTab from '@/components/library/CollectedCardsTab'
import RequireAccountGate from '@/components/RequireAccountGate'
import MyStoriesTab from '@/components/library/MyStoriesTab'
import SavedWordsTab from '@/components/library/SavedWordsTab'
import PronunciationTab from '@/components/library/PronunciationTab'
import { listMyCorpus, getCorpusPointCodes, deleteCorpus } from '@/lib/db/corpus'
import { getQuestionCountByObservations } from '@/lib/db/questions'
import { DIMENSION_LABEL, GRADIENT_BORDER_STYLE, BRAND_GRADIENT } from '@/lib/constants'
import { getSavedPhrases, getSavedWords, getSavedPronunciations } from '@/lib/storage'
import { getDueCount } from '@/lib/db/phrase-cards'
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

type View = 'hub' | 'stories' | 'cards' | 'words' | 'pron'

const VIEW_TITLE: Record<Exclude<View, 'hub'>, string> = {
  stories: '我的语料',
  cards:   '收藏卡片',
  words:   '词组收藏',
  pron:    '发音',
}

// 柔光投影常量（v8 hub 复用）
const SOFT = '0 8px 24px -8px rgba(180,120,70,0.16), 0 2px 8px rgba(120,90,60,0.05)'
const SOFT_SM = '0 4px 16px -6px rgba(180,120,70,0.12), 0 1px 5px rgba(120,90,60,0.04)'

export default function LibraryPage() {
  const [view, setView]           = useState<View>('hub')
  const [dtab, setDtab]           = useState<'cards' | 'phrases' | 'pron' | 'stories'>('cards')   // 桌面端 inline tab
  const [stories, setStories]     = useState<MyStory[]>([])
  const [cards, setCards]         = useState<CollectedCard[]>([])
  const [wordsCount, setWordsCount] = useState(0)
  const [pronCount, setPronCount]   = useState(0)
  const [dueCount, setDueCount]     = useState(0)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

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

  const totalCount = stories.length + cards.length + wordsCount + pronCount
  const matchedTotal = stories.reduce((sum, s) => sum + (s.matchedCount ?? 0), 0)
  const latestCard = cards[0]

  return (
    <div
      className="relative flex flex-col bg-bg-page overflow-hidden lg:pl-[256px]"
      style={{ height: '100dvh', paddingBottom: 'calc(56px + env(safe-area-inset-bottom))' }}
    >
      <style>{`
        @keyframes lib-hero-pulse {
          0%, 100% { transform: scale(1); opacity: 0.35; }
          50%      { transform: scale(1.08); opacity: 0.6; }
        }
        @keyframes lib-deck-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-5px); }
        }
      `}</style>
      <RequireAccountGate>
      {view !== 'hub' ? (
        <>
          {/* 二级页返回栏 */}
          <div className="flex items-center justify-between h-[52px] px-5 relative z-10">
            <button
              onClick={() => setView('hub')}
              aria-label="返回积累主页"
              className="w-[30px] h-[30px] rounded-full bg-bg-surface shadow-sm flex items-center justify-center"
            >
              <ChevronLeft size={15} className="text-v2-text-secondary" />
            </button>
            <span className="text-[15px] font-semibold text-v2-text-primary">{VIEW_TITLE[view]}</span>
            <div className="w-[30px]" />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-6 relative z-10">
            {view === 'stories' && (
              loading
                ? (
                  <div className="flex flex-col gap-3 pt-3">
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
                )
                : error
                  ? (typeof navigator !== 'undefined' && !navigator.onLine
                      ? <OfflineState onRetry={() => window.location.reload()} />
                      : <p className="text-[13px] text-error text-center pt-16">{error}</p>)
                  : <MyStoriesTab stories={stories} onDelete={(id) => {
                      setStories(prev => prev.filter(s => s.id !== id))
                      deleteCorpus(id).catch(e => console.error('[LibraryPage] 删除语料失败', e))
                    }} />
            )}
            {view === 'cards' && <CollectedCardsTab cards={cards} />}
            {view === 'words' && <SavedWordsTab />}
            {view === 'pron'  && <PronunciationTab />}
          </div>
        </>
      ) : (
        <>
          <TopBar title="素材库" right={<Search size={18} className="text-v2-text-muted" />} />

          {/* 移动端 hub（桌面端用下面的 inline 布局，故 lg:hidden） */}
          <div className="flex-1 min-h-0 overflow-y-auto relative z-10 lg:hidden" style={{ padding: '8px 22px 0' }}>

            {/* 1) 标题区 */}
            <div className="animate-fade-up" style={{ margin: '6px 2px 18px', animationDelay: '0.02s' }}>
              <h1 className="text-[23px] font-bold text-v2-text-primary tracking-[-0.3px]">素材积累</h1>
              <p className="text-[13px] text-v2-text-muted mt-[5px]">
                已攒下 <span className="text-brand-primary-dark font-semibold">{totalCount}</span> 条，慢慢成你自己的表达库
              </p>
            </div>

            {/* 2) 复习闪卡 Hero */}
            <Link href="/review" className="block animate-fade-up" style={{ animationDelay: '0.10s' }}>
              <div
                className="rounded-[16px] p-[18px] pl-4 flex items-center gap-[18px] relative overflow-hidden active:scale-[0.99] transition-transform"
                style={{ ...GRADIENT_BORDER_STYLE, boxShadow: SOFT, marginBottom: 16 }}
              >
                {/* 右上暖光（更淡更小 + 轻柔脉动） */}
                <div
                  className="absolute w-[130px] h-[130px] rounded-full blur-[24px] pointer-events-none"
                  style={{
                    background: 'radial-gradient(circle, rgba(248,168,118,0.18), transparent 70%)',
                    top: -30, right: -30,
                    animation: 'lib-hero-pulse 3s ease-in-out infinite',
                  }}
                  aria-hidden="true"
                />

                {/* 闪卡叠卡（上下浮动） */}
                <div
                  className="relative w-[74px] h-[92px] flex-shrink-0"
                  style={{ animation: 'lib-deck-float 4s ease-in-out infinite' }}
                  aria-hidden="true"
                >
                  <div
                    className="absolute w-[60px] h-[80px] rounded-[13px] bg-bg-muted"
                    style={{ boxShadow: SOFT_SM, top: 6, left: 7, transform: 'translate(-3px,3px) rotate(-9deg)' }}
                  />
                  <div
                    className="absolute w-[60px] h-[80px] rounded-[13px] bg-bg-muted"
                    style={{ boxShadow: SOFT_SM, top: 6, left: 7, transform: 'translate(4px,1px) rotate(5deg)' }}
                  />
                  <div
                    className="absolute w-[60px] h-[80px] rounded-[13px] bg-bg-surface flex flex-col items-center justify-center overflow-hidden px-1.5"
                    style={{ boxShadow: SOFT_SM, top: 6, left: 7, transform: 'rotate(-2deg)' }}
                  >
                    <span className="text-[10px] leading-tight font-bold text-v2-text-primary text-center break-words">wind down</span>
                    <div
                      className="w-[24px] h-[3px] rounded-full my-1"
                      style={{ background: BRAND_GRADIENT }}
                    />
                    <span className="text-[8.5px] text-v2-text-muted text-center">放松下来</span>
                  </div>
                </div>

                {/* 右侧文字 */}
                <div className="flex-1 relative z-[1]">
                  <h2 className="text-[16px] font-bold text-v2-text-primary tracking-[-0.2px]">词组闪卡</h2>
                  <p className="text-[13px] text-v2-text-secondary mt-[5px]">
                    今日待复习 <span className="text-brand-primary-dark font-bold text-[15px]">{dueCount}</span> 张 · 5 分钟记得更牢
                  </p>
                  <div
                    className="inline-flex items-center gap-[3px] mt-3 text-[13px] font-semibold rounded-full px-4 py-2"
                    style={GRADIENT_BORDER_STYLE}
                  >
                    <span className="text-v2-text-secondary">开始复习</span>
                    <span className="text-brand-primary-dark">›</span>
                  </div>
                </div>
              </div>
            </Link>

            {/* 3) 收藏卡片 */}
            <button
              type="button"
              onClick={() => setView('cards')}
              className="w-full text-left block animate-fade-up"
              style={{ animationDelay: '0.18s' }}
            >
              <div
                className="rounded-[16px] p-4 bg-bg-surface active:scale-[0.99] transition-transform"
                style={{ boxShadow: SOFT, marginBottom: 14 }}
              >
                <div className="flex items-center gap-[13px] mb-[13px]">
                  {/* 图标块（橙云） */}
                  <div className="relative w-[46px] h-[46px] rounded-[14px] flex items-center justify-center flex-shrink-0">
                    <div
                      className="absolute inset-[-4px] rounded-full blur-[9px] opacity-[0.55] pointer-events-none"
                      style={{ background: 'radial-gradient(circle, rgba(248,168,118,0.95) 0%, rgba(248,168,118,0) 70%)' }}
                      aria-hidden="true"
                    />
                    <MessageSquareText size={21} className="text-v2-text-secondary relative z-[2]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[15px] font-semibold text-v2-text-primary">收藏卡片</h3>
                    <p className="text-[12px] text-v2-text-muted mt-[2px]">练习里你说过、改得更好的句子</p>
                  </div>
                  <span className="flex-shrink-0 self-start mt-0.5 mr-9 text-[19px] font-bold text-v2-text-primary">{cards.length}</span>
                </div>

                {/* 微预览：有卡片显示最近一条；无卡片显示空状态提示 */}
                <div className="bg-bg-page rounded-[14px] px-[13px] py-[11px]">
                  {latestCard ? (
                    <>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="flex-shrink-0 text-[10px] font-semibold rounded-full px-[7px] py-[2px] bg-bg-muted text-v2-text-muted">你的话</span>
                        <span className="text-[12px] text-v2-text-secondary truncate flex-1">
                          {latestCard.originalSentence}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="flex-shrink-0 text-[10px] font-semibold rounded-full px-[7px] py-[2px] bg-[#EDF6EB] border border-[#C0DDB9] text-[#3D7A38]">更地道</span>
                        <span className="text-[12px] text-v2-text-primary font-medium truncate flex-1">
                          {latestCard.aiOptimized}
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="text-[12px] text-v2-text-muted text-center py-[3px]">
                      练习后左滑卡片，改得更好的句子会出现在这里
                    </p>
                  )}
                </div>
              </div>
            </button>

            {/* 4) 词组 + 发音 2-up */}
            <div className="grid grid-cols-2 gap-[13px] animate-fade-up" style={{ animationDelay: '0.26s', marginBottom: 20 }}>
              <button
                type="button"
                onClick={() => setView('words')}
                className="rounded-[16px] p-4 bg-bg-surface flex items-center gap-3 active:scale-[0.97] transition-transform text-left"
                style={{ boxShadow: SOFT_SM }}
              >
                <div className="relative w-[42px] h-[42px] rounded-[12px] flex items-center justify-center flex-shrink-0">
                  <div
                    className="absolute inset-[-4px] rounded-full blur-[9px] opacity-[0.55] pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(145,200,122,0.95) 0%, rgba(145,200,122,0) 70%)' }}
                    aria-hidden="true"
                  />
                  <BookOpen size={20} className="text-v2-text-secondary relative z-[2]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-v2-text-secondary">词组收藏</p>
                  <p className="text-[18px] font-bold text-v2-text-primary leading-none mt-1">{wordsCount}</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setView('pron')}
                className="rounded-[16px] p-4 bg-bg-surface flex items-center gap-3 active:scale-[0.97] transition-transform text-left"
                style={{ boxShadow: SOFT_SM }}
              >
                <div className="relative w-[42px] h-[42px] rounded-[12px] flex items-center justify-center flex-shrink-0">
                  <div
                    className="absolute inset-[-4px] rounded-full blur-[9px] opacity-[0.55] pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(246,196,108,0.90) 0%, rgba(246,196,108,0) 70%)' }}
                    aria-hidden="true"
                  />
                  <Volume2 size={20} className="text-v2-text-secondary relative z-[2]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-v2-text-secondary">发音</p>
                  <p className="text-[18px] font-bold text-v2-text-primary leading-none mt-1">{pronCount}</p>
                </div>
              </button>
            </div>

            {/* 5) 我的语料 */}
            <button
              type="button"
              onClick={() => setView('stories')}
              className="w-full flex items-center gap-[11px] px-[14px] py-[13px] rounded-[16px] bg-white/55 active:bg-white/90 animate-fade-up text-left"
              style={{ animationDelay: '0.34s' }}
            >
              <div className="w-[30px] h-[30px] rounded-[9px] bg-bg-muted flex items-center justify-center text-v2-text-muted flex-shrink-0">
                <Mic2 size={15} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-v2-text-secondary">我的语料</p>
                <p className="text-[11px] text-v2-text-muted mt-[0.5px]">已匹配 {matchedTotal} 道题 · 可回看与重练</p>
              </div>
              <span className="text-[13px] font-semibold text-v2-text-muted">{stories.length}</span>
              <ChevronRight size={16} className="text-v2-text-muted" />
            </button>
          </div>

          {/* 桌面端 inline 素材库（参照 web.html LibraryCollections）：标题 + 今日复习 hero + tab + 2 栏卡片网格 */}
          <div className="hidden lg:block flex-1 min-h-0 overflow-y-auto px-10 pt-6 pb-10 max-w-[1100px] w-full mx-auto relative z-10">
            <div className="mb-5">
              <h1 className="text-[23px] font-bold text-v2-text-primary tracking-[-0.3px]">我的素材库</h1>
              <p className="text-[13px] text-v2-text-muted mt-1">语料、收藏卡片、词组与发音，集中在这里管理和复习。</p>
            </div>

            {/* 今日复习 hero —— 复用 /review 入口 */}
            <Link href="/review" className="block mb-6">
              <div className="rounded-[16px] px-[22px] py-5 flex items-center gap-5 active:scale-[0.99] transition-transform" style={{ ...GRADIENT_BORDER_STYLE, boxShadow: SOFT }}>
                <div className="flex-1 min-w-0">
                  <span className="text-[12px] font-semibold text-brand-primary-dark">今日复习</span>
                  <p className="text-[18px] font-bold text-v2-text-primary mt-1">
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
              </div>
            </Link>

            {/* tab 条 */}
            <div className="flex gap-6 mb-5 border-b border-black/[0.06]">
              {([['cards', '收藏卡片', cards.length], ['phrases', '词组收藏', wordsCount], ['pron', '发音', pronCount], ['stories', '我的语料', stories.length]] as const).map(([id, label, ct]) => (
                <button
                  key={id}
                  onClick={() => setDtab(id)}
                  className={`pb-2.5 -mb-px flex items-center gap-1.5 text-[14px] font-medium border-b-2 transition-colors ${dtab === id ? 'text-v2-text-primary border-brand-primary' : 'text-v2-text-muted border-transparent hover:text-v2-text-secondary'}`}
                >
                  {label}<span className="text-[12px] text-v2-text-muted">{ct}</span>
                </button>
              ))}
            </div>

            {/* 当前 tab 内容（复用现有子组件，列表在 lg 下两栏） */}
            {dtab === 'cards' && <CollectedCardsTab cards={cards} />}
            {dtab === 'phrases' && <SavedWordsTab />}
            {dtab === 'pron' && <PronunciationTab />}
            {dtab === 'stories' && <MyStoriesTab stories={stories} onDelete={(id) => {
              setStories(prev => prev.filter(s => s.id !== id))
              deleteCorpus(id).catch(e => console.error('[LibraryPage] 删除语料失败', e))
            }} />}
          </div>
        </>
      )}
      </RequireAccountGate>

      <TabBar />
    </div>
  )
}
