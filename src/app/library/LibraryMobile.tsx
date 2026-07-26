/**
 * @module   LibraryMobile
 * @desc     素材库（移动端）— 积累主页 hub + 二级列表（复用 4 个 Tab 组件）；改版前独立移动 UI，仅移动端树使用
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Search, X, ChevronLeft, Mic2, MessageSquareText, BookOpen, Volume2 } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import Tag from '@/components/Tag'
import CollectedCardsTab from '@/app/library/CollectedCardsTab'
import CorpusMatchesTab from '@/app/library/CorpusMatchesTab'
import SavedWordsTab from '@/components/library/SavedWordsTab'
import PronunciationTab from '@/components/library/PronunciationTab'
import LoginPrompt from '@/app/profile/_components/LoginPrompt'
import useDebouncedValue from '@/hooks/useDebouncedValue'
import { getAccount } from '@/lib/auth'
import { GRADIENT_BORDER_STYLE, BRAND_GRADIENT } from '@/lib/constants'
import HeroHelpTip from './HeroHelpTip'
import { HERO_TITLE_DESC_MOBILE, HERO_PAIR_DESC_MOBILE, HERO_EMPTY_FALLBACK, HERO_HELP_TEXT } from './hero-copy'
import type { LibraryViewProps } from './types'

type View = 'hub' | 'stories' | 'cards' | 'words' | 'pron'

const VIEW_TITLE: Record<Exclude<View, 'hub'>, string> = {
  stories: '语料匹配',
  cards:   '收藏卡片',
  words:   '词组收藏',
  pron:    '发音',
}

// 柔光投影常量（v8 hub 复用）
const SOFT = '0 8px 24px -8px rgba(180,120,70,0.16), 0 2px 8px rgba(120,90,60,0.05)'
const SOFT_SM = '0 4px 16px -6px rgba(180,120,70,0.12), 0 1px 5px rgba(120,90,60,0.04)'

export default function LibraryMobile({ stories, cards, wordsCount, pronCount, dueCount, pairCount, ankiSeasonCount, ankiDueCount, ankiSample, ankiLoading }: LibraryViewProps) {
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
            {view === 'stories' && <CorpusMatchesTab searchQuery={searchQuery} />}
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
            <div className="animate-fade-up" style={{ margin: '6px 2px 16px', animationDelay: '0.02s' }}>
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

            {/* 2) 题库速览（主行动·首位）—— deck 卡轮廓：[deck 左] | [右列 标题行/计数/CTA]。
                容器是 div（非 Link），零嵌套交互：标题行含可点问号 HeroHelpTip 在任何 Link 外；
                主体命中区（计数 + 两句说明）一枚 Link；CTA 一枚真实 Link 胶囊，两者平级。
                deck 缩到 74×92 与词组闪卡统一、作 aria-hidden 装饰。
                reduced-motion 由 globals.css 全局关停（同词组 Hero，不逐元素处理）。 */}
            <div className="animate-fade-up" style={{ animationDelay: '0.06s' }}>
              <div
                className="rounded-[16px] p-4 relative overflow-hidden"
                style={{ ...GRADIENT_BORDER_STYLE, boxShadow: SOFT, marginBottom: 12 }}
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

                {/* 主体行：[deck 左] | [右列] */}
                <div className="flex items-start gap-4 relative z-[1]">
                  {/* 题卡叠卡（74×92，上下浮动）；正面显 Part N + 题面首行，装饰不入 Link */}
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
                      <span className="text-[9px] font-bold text-brand-primary-dark">Part {ankiSample?.part ?? 1}</span>
                      <div className="w-[24px] h-[3px] rounded-full my-1" style={{ background: BRAND_GRADIENT }} />
                      <span
                        className="text-[8.5px] leading-tight text-v2-text-secondary text-center break-words"
                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      >
                        {ankiSample?.text ?? '当季题卡'}
                      </span>
                    </div>
                  </div>

                  {/* 右列：标题行 / 主体 Link / CTA Link 三块平级、互不嵌套 */}
                  <div className="flex-1 min-w-0">
                    {/* 1) 标题行（Link 外：HeroHelpTip 是可点气泡，嵌 Link 内即交互嵌套） */}
                    <div className="flex items-center gap-2">
                      <h2 className="text-[16px] font-bold text-v2-text-primary tracking-[-0.2px]">题库速览</h2>
                      <Tag label="当季·新" variant="green" />
                      <HeroHelpTip text={HERO_HELP_TEXT} />
                    </div>

                    {/* 2) 主体命中区：计数 + 两句说明，一枚 Link */}
                    <Link
                      href="/anki/review"
                      aria-label={ankiLoading
                        ? '题库速览，加载中'
                        : ankiHasCards
                          ? isAnon
                            ? `题库速览，当季 ${ankiSeasonCount} 张，开始刷题卡`
                            : `题库速览，当季 ${ankiSeasonCount} 张，待复习 ${ankiDueCount} 张，开始刷题卡`
                          : '题库速览，随时开始刷当季题卡'}
                      className="block mt-1.5"
                    >
                      {/* 计数：真实当季张数；匿名不显「待复习」段（due 队列只含已答卡，匿名恒空）；
                          0 / 取数失败退通用文案不带 0（当季恒有题，绝不显「暂无」） */}
                      <p className="text-[12px] text-v2-text-muted">
                        {ankiLoading
                          ? '加载中…'
                          : ankiHasCards
                            ? isAnon
                              ? <>当季 {ankiSeasonCount} 张</>
                              : <>当季 {ankiSeasonCount} 张 · 待复习 <span className="text-brand-primary-dark font-bold text-[15px]">{ankiDueCount}</span> 张</>
                            : HERO_EMPTY_FALLBACK}
                      </p>
                      {/* 说明文案（移动端短版）：入口是什么 + 结对价值；操作指引在标题旁问号气泡 */}
                      <p className="text-[13px] text-v2-text-secondary leading-relaxed mt-1.5">{HERO_TITLE_DESC_MOBILE}</p>
                      <p className="text-[13px] text-v2-text-secondary leading-relaxed mt-1">{HERO_PAIR_DESC_MOBILE}</p>
                    </Link>

                    {/* 3) CTA：一枚真实 Link 胶囊（命中区 ≥44px），与主体 Link 平级 */}
                    <Link
                      href="/anki/review"
                      className="inline-flex self-start items-center gap-[3px] min-h-[44px] px-[18px] rounded-full text-[13px] font-semibold mt-3 active:scale-[0.97] transition-transform"
                      style={GRADIENT_BORDER_STYLE}
                    >
                      <span className="text-v2-text-secondary">开始刷题卡</span>
                      <span className="text-brand-primary-dark">›</span>
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* 3) 复习闪卡 Hero */}
            <Link href="/review" className="block animate-fade-up" style={{ animationDelay: '0.10s' }}>
              <div
                className="rounded-[16px] p-4 flex items-center gap-4 relative overflow-hidden active:scale-[0.99] transition-transform"
                style={{ ...GRADIENT_BORDER_STYLE, boxShadow: SOFT, marginBottom: 12 }}
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
                    className="inline-flex items-center gap-[3px] min-h-[44px] mt-3 text-[13px] font-semibold rounded-full px-4 py-2"
                    style={GRADIENT_BORDER_STYLE}
                  >
                    <span className="text-v2-text-secondary">开始复习</span>
                    <span className="text-brand-primary-dark">›</span>
                  </div>
                </div>
              </div>
            </Link>

            {/* 素材仓「我的素材」：四入口收敛成 2×2 等大瓦片（方向 B）。
                收藏卡片去掉原「你的话→更地道」预览（B 方案取舍，产品方已知情）。
                四格各自平级 button、互不嵌套、命中区 ≥44px，计数读真实值。 */}
            <p className="text-[12px] font-medium text-v2-text-muted ml-0.5 mt-3 mb-2.5 animate-fade-up" style={{ animationDelay: '0.14s' }}>我的素材</p>
            <div className="grid grid-cols-2 gap-3 animate-fade-up" style={{ animationDelay: '0.18s', marginBottom: 20 }}>
              {/* ① 收藏卡片（橙云 · 消息图标） */}
              <button
                type="button"
                onClick={() => goView('cards')}
                className="p-4 rounded-[16px] bg-bg-surface flex items-center gap-3 active:scale-[0.97] transition-transform text-left"
                style={{ boxShadow: SOFT_SM }}
              >
                <div className="relative w-[42px] h-[42px] rounded-[12px] flex items-center justify-center flex-shrink-0">
                  <div
                    className="absolute inset-[-4px] rounded-full blur-[9px] opacity-[0.55] pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(248,168,118,0.95) 0%, rgba(248,168,118,0) 70%)' }}
                    aria-hidden="true"
                  />
                  <MessageSquareText size={20} className="text-v2-text-secondary relative z-[2]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-v2-text-secondary">收藏卡片</p>
                  <p className="text-[18px] font-bold text-v2-text-primary leading-none mt-1">{cards.length}</p>
                </div>
              </button>

              {/* ② 词组收藏（绿云 · book 图标） */}
              <button
                type="button"
                onClick={() => goView('words')}
                className="p-4 rounded-[16px] bg-bg-surface flex items-center gap-3 active:scale-[0.97] transition-transform text-left"
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

              {/* ③ 发音（橙黄云 · Volume 图标） */}
              <button
                type="button"
                onClick={() => goView('pron')}
                className="p-4 rounded-[16px] bg-bg-surface flex items-center gap-3 active:scale-[0.97] transition-transform text-left"
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

              {/* ④ 语料匹配（accent 云 · Mic 图标）；瓦片形态下去掉原副标题/ChevronRight，只留 图标+名+计数 */}
              <button
                type="button"
                onClick={() => goView('stories')}
                className="p-4 rounded-[16px] bg-bg-surface flex items-center gap-3 active:scale-[0.97] transition-transform text-left"
                style={{ boxShadow: SOFT_SM }}
              >
                <div className="relative w-[42px] h-[42px] rounded-[12px] flex items-center justify-center flex-shrink-0">
                  <div
                    className="absolute inset-[-4px] rounded-full blur-[9px] opacity-[0.55] pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(123,166,153,0.90) 0%, rgba(123,166,153,0) 70%)' }}
                    aria-hidden="true"
                  />
                  <Mic2 size={20} className="text-v2-text-secondary relative z-[2]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-v2-text-secondary">语料匹配</p>
                  <p className="text-[18px] font-bold text-v2-text-primary leading-none mt-1">{pairCount}</p>
                </div>
              </button>
            </div>
          </div>
        </>
      )}

      <TabBar />
    </div>
  )
}
