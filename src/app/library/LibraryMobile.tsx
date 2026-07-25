/**
 * @module   LibraryMobile
 * @desc     素材库（移动端）— 积累主页 hub + 二级列表（复用 4 个 Tab 组件）；改版前独立移动 UI，仅移动端树使用
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Search, X, ChevronLeft, ChevronRight, Mic2, MessageSquareText, BookOpen, Volume2 } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import Card from '@/components/Card'
import Tag from '@/components/Tag'
import Skeleton from '@/components/Skeleton'
import OfflineState from '@/components/OfflineState'
import CollectedCardsTab from '@/app/library/CollectedCardsTab'
import MyStoriesTab from '@/components/library/MyStoriesTab'
import SavedWordsTab from '@/components/library/SavedWordsTab'
import PronunciationTab from '@/components/library/PronunciationTab'
import LoginPrompt from '@/app/profile/_components/LoginPrompt'
import useDebouncedValue from '@/hooks/useDebouncedValue'
import { getAccount } from '@/lib/auth'
import { GRADIENT_BORDER_STYLE, BRAND_GRADIENT } from '@/lib/constants'
import HeroHelpTip from './HeroHelpTip'
import { HERO_TITLE_DESC, HERO_PAIR_DESC, HERO_EMPTY_FALLBACK, HERO_HELP_TEXT } from './hero-copy'
import type { LibraryViewProps } from './types'

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

export default function LibraryMobile({ stories, cards, wordsCount, pronCount, dueCount, loading, error, onDeleteStory, ankiSeasonCount, ankiDueCount, ankiSample, ankiLoading }: LibraryViewProps) {
  const [view, setView] = useState<View>('hub')
  // 二级页内搜索（每个分类独立）：切页/返回即清空，防抖 300ms 下发给对应 tab 组件过滤
  const [mobileQuery, setMobileQuery] = useState('')
  const debouncedQuery = useDebouncedValue(mobileQuery, 300)
  // 空词立即置空（绕过防抖滞后）：切二级页/清空后新分类不会被上一个词短暂过滤
  const searchQuery = mobileQuery.trim() === '' ? '' : debouncedQuery
  const goView = (v: View) => { setView(v); setMobileQuery('') }

  // 匿名判定（与 settings/profile 同范式）：仅用于决定是否展示登录软引导卡。
  // 读取失败一律按「非匿名」降级 —— 宁可少打扰一次，也不给已登录用户误显引导。
  const [isAnon, setIsAnon] = useState(false)
  useEffect(() => {
    getAccount()
      .then(acct => setIsAnon(!!acct?.isAnonymous))
      .catch(() => setIsAnon(false))
  }, [])

  const totalCount = stories.length + cards.length + wordsCount + pronCount
  const matchedTotal = stories.reduce((sum, s) => sum + (s.matchedCount ?? 0), 0)
  const latestCard = cards[0]
  // 题卡 Hero：当季有题即导向刷题（设定是「所有题都能刷」，新用户也能直接刷、不再导去题库）；仅当季真 0 题
  // （off-season）才走空态。入口 href 恒指 /anki/review（review 页对 0 题自有空态，不给死胡同）。
  const ankiHasCards = ankiSeasonCount > 0

  return (
    <div
      className="relative flex flex-col bg-bg-page overflow-hidden"
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
      {view !== 'hub' ? (
        <>
          {/* 二级页返回栏 */}
          <div className="flex items-center justify-between h-[52px] px-5 relative z-10">
            <button
              onClick={() => goView('hub')}
              aria-label="返回积累主页"
              className="w-[30px] h-[30px] rounded-full bg-bg-surface shadow-sm flex items-center justify-center"
            >
              <ChevronLeft size={15} className="text-v2-text-secondary" />
            </button>
            <span className="text-[16px] font-semibold text-v2-text-primary">{VIEW_TITLE[view]}</span>
            <div className="w-[30px]" />
          </div>

          {/* 常驻搜索条（当前分类内搜索） */}
          <div className="px-5 pb-2 relative z-10">
            <div className="flex items-center gap-1.5 h-9 rounded-full bg-bg-muted px-3.5">
              <Search size={15} className="flex-shrink-0 text-v2-text-muted" />
              <input
                value={mobileQuery}
                onChange={e => setMobileQuery(e.target.value)}
                placeholder="搜索…"
                role="searchbox"
                aria-label={`搜索${VIEW_TITLE[view]}`}
                className="flex-1 min-w-0 bg-transparent text-[16px] text-v2-text-primary placeholder:text-v2-text-muted outline-none"
              />
              {mobileQuery && (
                <button
                  type="button"
                  onClick={() => setMobileQuery('')}
                  aria-label="清空搜索"
                  className="flex-shrink-0 active:opacity-60 transition-opacity"
                >
                  <X size={14} className="text-v2-text-muted" />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-6 relative z-10">
            {view === 'stories' && (
              loading
                ? (
                  <div className="flex flex-col gap-3 pt-3" aria-busy="true">
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
                  : <MyStoriesTab stories={stories} onDelete={onDeleteStory} searchQuery={searchQuery} />
            )}
            {view === 'cards' && <CollectedCardsTab cards={cards} searchQuery={searchQuery} />}
            {view === 'words' && <SavedWordsTab searchQuery={searchQuery} />}
            {view === 'pron'  && <PronunciationTab searchQuery={searchQuery} />}
          </div>
        </>
      ) : (
        <>
          <TopBar title="素材库" />

          {/* 移动端 hub */}
          <div className="flex-1 min-h-0 overflow-y-auto relative z-10" style={{ padding: '8px 24px 0' }}>

            {/* 1) 标题区 */}
            <div className="animate-fade-up" style={{ margin: '6px 2px 18px', animationDelay: '0.02s' }}>
              <h1 className="text-[23px] font-bold text-v2-text-primary tracking-[-0.3px]">素材积累</h1>
              <p className="text-[13px] text-v2-text-muted mt-[5px]">
                已攒下 <span className="text-brand-primary-dark font-semibold">{totalCount}</span> 条，慢慢成你自己的表达库
              </p>
            </div>

            {/* 1.5) 登录软引导：仅匿名且已攒下东西时出现。totalCount === 0 不放——
                没有素材可保存时谈「永久保存」只是噪音。titleAs 保持默认 'p'：本页已有 h1（素材积累）。 */}
            {isAnon && totalCount > 0 && (
              <LoginPrompt variant="slim" className="animate-fade-up mb-4" />
            )}

            {/* 2) 题卡 Hero（题卡首位·重点）—— 复用词组闪卡 Hero 的手写范式与常量
                （GRADIENT_BORDER_STYLE / SOFT / SOFT_SM / lib-deck-float / lib-hero-pulse），整体放大一档。
                reduced-motion 由 globals.css 全局关停（同词组 Hero，不逐元素处理）。
                TODO(桌面)：移动优先，桌面 hub（LibraryDesktop）暂未补题卡入口，待产品方看过位置后再做。 */}
            <Link
              href="/anki/review"
              aria-label={ankiLoading
                ? '题库速览，加载中'
                : ankiHasCards
                  ? `题库速览，当季 ${ankiSeasonCount} 张，待复习 ${ankiDueCount} 张，开始刷题卡`
                  : '题库速览，随时开始刷当季题卡'}
              className="block animate-fade-up"
              style={{ animationDelay: '0.06s' }}
            >
              <div
                className="rounded-[18px] p-[20px] pl-4 flex items-center gap-[18px] relative overflow-hidden active:scale-[0.99] transition-transform"
                style={{ ...GRADIENT_BORDER_STYLE, boxShadow: SOFT, marginBottom: 16 }}
              >
                {/* 右上暖光（轻柔脉动，同词组 Hero） */}
                <div
                  className="absolute w-[130px] h-[130px] rounded-full blur-[24px] pointer-events-none"
                  style={{
                    background: 'radial-gradient(circle, rgba(248,168,118,0.18), transparent 70%)',
                    top: -30, right: -30,
                    animation: 'lib-hero-pulse 3s ease-in-out infinite',
                  }}
                  aria-hidden="true"
                />

                {/* 题卡叠卡（放大 84×104，上下浮动）；正面显 Part N + 题面首行 */}
                <div
                  className="relative w-[84px] h-[104px] flex-shrink-0"
                  style={{ animation: 'lib-deck-float 4s ease-in-out infinite' }}
                  aria-hidden="true"
                >
                  <div
                    className="absolute w-[68px] h-[90px] rounded-[14px] bg-bg-muted"
                    style={{ boxShadow: SOFT_SM, top: 7, left: 8, transform: 'translate(-3px,3px) rotate(-9deg)' }}
                  />
                  <div
                    className="absolute w-[68px] h-[90px] rounded-[14px] bg-bg-muted"
                    style={{ boxShadow: SOFT_SM, top: 7, left: 8, transform: 'translate(4px,1px) rotate(5deg)' }}
                  />
                  <div
                    className="absolute w-[68px] h-[90px] rounded-[14px] bg-bg-surface flex flex-col items-center justify-center overflow-hidden px-2"
                    style={{ boxShadow: SOFT_SM, top: 7, left: 8, transform: 'rotate(-2deg)' }}
                  >
                    <span className="text-[9px] font-bold text-brand-primary-dark">Part {ankiSample?.part ?? 1}</span>
                    <div className="w-[24px] h-[3px] rounded-full my-1" style={{ background: BRAND_GRADIENT }} />
                    <span
                      className="text-[8.5px] leading-tight text-v2-text-secondary text-center break-words"
                      style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                    >
                      {ankiSample?.text ?? '当季题卡'}
                    </span>
                  </div>
                </div>

                {/* 右侧文字（主说明 + 计数 + 结对说明）；问号气泡讲不同模式下如何结对 */}
                <div className="flex-1 min-w-0 relative z-[1]">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[17px] font-bold text-v2-text-primary tracking-[-0.2px]">题库速览</h2>
                    <Tag label="当季·新" variant="green" />
                    <HeroHelpTip text={HERO_HELP_TEXT} />
                  </div>
                  {/* 主说明：这个入口是什么 */}
                  <p className="text-[13px] text-v2-text-secondary mt-[5px] leading-relaxed">{HERO_TITLE_DESC}</p>
                  {/* 计数：真实当季张数；0 / 取数失败退通用文案不带 0（当季恒有题，绝不显「暂无」） */}
                  <p className="text-[12px] text-v2-text-muted mt-[5px]">
                    {ankiLoading
                      ? '加载中…'
                      : ankiHasCards
                        ? <>当季 {ankiSeasonCount} 张 · 待复习 <span className="text-brand-primary-dark font-bold text-[15px]">{ankiDueCount}</span> 张</>
                        : HERO_EMPTY_FALLBACK}
                  </p>
                  {/* 结对说明：为什么把题目和语料结对 */}
                  <p className="text-[12px] text-v2-text-muted mt-2 leading-relaxed">{HERO_PAIR_DESC}</p>

                  <div
                    className="inline-flex items-center gap-[3px] mt-3 text-[13px] font-semibold rounded-full px-4 py-2"
                    style={GRADIENT_BORDER_STYLE}
                  >
                    <span className="text-v2-text-secondary">开始刷题卡</span>
                    <span className="text-brand-primary-dark">›</span>
                  </div>
                </div>
              </div>
            </Link>

            {/* 3) 复习闪卡 Hero */}
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

            {/* 4) 收藏卡片 */}
            <button
              type="button"
              onClick={() => goView('cards')}
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
                        <span className="flex-shrink-0 text-[10px] font-semibold rounded-full px-[7px] py-[2px] bg-bg-muted text-v2-text-secondary">你的话</span>
                        <span className="text-[12px] text-v2-text-secondary truncate flex-1">
                          {latestCard.originalSentence}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="flex-shrink-0 text-[10px] font-semibold rounded-full px-[7px] py-[2px] bg-tag-success-bg border border-tag-success-border text-tag-success-text">更地道</span>
                        <span className="text-[12px] text-v2-text-primary font-medium truncate flex-1">
                          {latestCard.aiOptimized}
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="text-[12px] text-v2-text-muted text-center py-[3px]">
                      练习后右滑卡片，改得更好的句子会出现在这里
                    </p>
                  )}
                </div>
              </div>
            </button>

            {/* 5) 词组 + 发音 2-up */}
            <div className="grid grid-cols-2 gap-[13px] animate-fade-up" style={{ animationDelay: '0.26s', marginBottom: 20 }}>
              <button
                type="button"
                onClick={() => goView('words')}
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
                onClick={() => goView('pron')}
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

            {/* 6) 我的语料 */}
            <button
              type="button"
              onClick={() => goView('stories')}
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
        </>
      )}

      <TabBar />
    </div>
  )
}
