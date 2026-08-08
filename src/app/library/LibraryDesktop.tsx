/**
 * @module   LibraryDesktop
 * @desc     素材库（桌面端）— 顶部导航 + 面包屑页头 + 今日复习 hero + 四类 Tab + 2 列卡片网格。密面板风（对齐题库 v3）。
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { Suspense, useState, useRef, useEffect } from 'react'
import ProgressLink from '@/components/ProgressLink'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search, Trash2 } from 'lucide-react'
import TopNav from '@/components/TopNav'
import ManageHeader, { MANAGE_CONTAINER } from '@/components/ManageHeader'
import FeedbackButton from '@/components/FeedbackButton'
import Card from '@/components/Card'
import Tag from '@/components/Tag'
import IconButton from '@/components/IconButton'
import Toast from '@/components/Toast'
import SearchBox from '@/components/library/SearchBox'
import LoginPrompt from '@/app/profile/_components/LoginPrompt'
import useDebouncedValue from '@/hooks/useDebouncedValue'
import { getAccount } from '@/lib/auth'
import CollectedCardsTab from '@/app/library/CollectedCardsTab'
import SavedWordsTab from '@/components/library/SavedWordsTab'
import PronunciationTab from '@/components/library/PronunciationTab'
import MyCorpusTab from '@/app/library/MyCorpusTab'
import { GRADIENT_BORDER_STYLE, BRAND_GRADIENT } from '@/lib/constants'
import HeroHelpTip from './HeroHelpTip'
import { HERO_TITLE_DESC, HERO_PAIR_DESC, HERO_EMPTY_FALLBACK, HERO_HELP_TEXT } from './hero-copy'
import type { LibraryViewProps } from './types'

type Tab = 'cards' | 'phrases' | 'pron' | 'stories'

// 题卡叠卡柔光投影：与移动端（LibraryMobile）SOFT_SM 同值。桌面叠卡静态、不迁移动端浮动动效，故只取此一个常量、不散写内联。
const DECK_SHADOW = '0 4px 16px -6px rgba(180,120,70,0.12), 0 1px 5px rgba(120,90,60,0.04)'
const TAB_IDS: readonly Tab[] = ['cards', 'phrases', 'pron', 'stories']

/** 「工具栏走 Portal 槽」的 tab：四个 tab 均由各自组件把多选删除工具栏 Portal 到右侧槽（搜索图标右边）。
 *  我的语料（stories）的删除语义 = 删语料（deleteCorpus，解绑退回分析），与其余三 tab 的删收藏并列、都真删。
 *  未列入的 tab 会退到占位「多选删除即将上线」Toast（当前四个全接入，占位分支保留作兜底、实际走不到）。 */
const SELECTABLE_TABS: readonly Tab[] = ['cards', 'phrases', 'pron', 'stories']

/** useSearchParams 需在 Suspense 内；本页 page.tsx 不便改，故边界内建于此。 */
export default function LibraryDesktop(props: LibraryViewProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg-page" />}>
      <LibraryDesktopContent {...props} />
    </Suspense>
  )
}

function LibraryDesktopContent({ cards, wordsCount, pronCount, dueCount, corpusCount, onCorpusCountChange, ankiSeasonCount, ankiDueCount, ankiSample, ankiLoading }: LibraryViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  // tab 由 URL 派生（?tab=phrases 等；缺省 → cards），刷新/分享保持
  const tab: Tab = TAB_IDS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'cards'

  // 「已攒下 N 条」：语料条数直接用 corpusCount（与下方 tab 胶囊同一个数，删语料后一起回落）
  const totalCount = corpusCount + cards.length + wordsCount + pronCount
  // 题卡复习入口：当季有题即导刷题（设定「所有题都能刷」，新用户也能直接刷、不再导去题库）；仅当季真 0 题
  // 才空态。入口 href 恒指 /anki/review（review 页对 0 题自有空态）。与移动端 Hero 同范式。
  const ankiHasCards = ankiSeasonCount > 0
  // 匿名判定（与 settings/profile 同范式）：仅用于决定是否展示登录软引导卡。
  // 读取失败一律按「非匿名」降级 —— 宁可少打扰一次，也不给已登录用户误显引导。
  const [isAnon, setIsAnon] = useState(false)
  useEffect(() => {
    getAccount()
      .then(acct => setIsAnon(!!acct?.isAnonymous))
      .catch(() => setIsAnon(false))
  }, [])
  // 当前 tab 的多选工具栏 Portal 落点：与 tab 栏同一行右对齐（工具栏状态仍归各 tab 组件所有）
  const toolbarSlotRef = useRef<HTMLDivElement | null>(null)
  // 当前活跃 tab 是否处于选择模式（由各 tab 组件通知）：用于禁用同排搜索图标
  const [activeSelecting, setActiveSelecting] = useState(false)
  // 占位提示 Toast（未接入 tab 的多选删除「即将上线」）
  const [hint, setHint] = useState<string | null>(null)
  // 搜索：是否展开输入框 + 实时输入 + 300ms 防抖后下发给当前 tab 过滤（本批切 tab 即清空）。
  // 初值从 URL 回填：带 ?q= 进来时直接展开并填入（刷新/分享保持搜索态）。
  const initialQuery = params.get('q') ?? ''
  const [searchOpen, setSearchOpen] = useState(initialQuery !== '')
  const [rawQuery, setRawQuery] = useState(initialQuery)
  const debouncedQuery = useDebouncedValue(rawQuery, 300)
  // 搜索关闭时（含切 tab）立即下发空串，绕过防抖滞后，避免新 tab 被上一个查询短暂过滤
  const searchQuery = searchOpen ? debouncedQuery : ''
  const searching = searchQuery.trim() !== ''
  // 当前 tab 上报的实时（匹配数, 总数）——搜索时用于把当前 tab 胶囊显示成「匹配/总数」
  const [activeCounts, setActiveCounts] = useState<{ matched: number; total: number } | null>(null)

  // 防抖后的查询同步进 URL（?q=）；关闭搜索时清掉。从 params 读当前值 + 相等即跳过 → 写回后再触发的这轮
  // 因 cur===want 直接 return，断掉回环；且始终基于 params 重建，保留 ?tab= 不被覆盖。
  useEffect(() => {
    const want = searchOpen ? debouncedQuery.trim() : ''
    if ((params.get('q') ?? '') === want) return
    const p = new URLSearchParams(params.toString())
    if (want) p.set('q', want)
    else p.delete('q')
    const qs = p.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [debouncedQuery, searchOpen, params, pathname, router])

  const closeSearch = () => { setSearchOpen(false); setRawQuery('') }   // ?q= 由上面 effect 随 searchOpen=false 清除
  const selectTab = (id: Tab) => {
    setActiveSelecting(false)
    setSearchOpen(false)
    setRawQuery('')
    // 切 tab：写 ?tab=（默认 cards 清 param）并清 ?q=，基于 params 单次 replace（q-effect 随后见 q 已空即 no-op）
    const p = new URLSearchParams(params.toString())
    p.delete('q')
    if (id === 'cards') p.delete('tab')
    else p.set('tab', id)
    const qs = p.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
  const isSelectableTab = SELECTABLE_TABS.includes(tab)

  const TABS = [
    { id: 'cards',   label: '收藏卡片', count: cards.length },
    { id: 'phrases', label: '词组收藏', count: wordsCount },
    { id: 'pron',    label: '发音',     count: pronCount },
    { id: 'stories', label: '我的语料', count: corpusCount },
  ] as const

  return (
    <div className="min-h-screen bg-bg-page">
      <TopNav containerClassName={MANAGE_CONTAINER} />

      <main className={`${MANAGE_CONTAINER} pb-12`}>
        <ManageHeader
          title="我的素材库"
          subtitle={`已攒下 ${totalCount} 条，慢慢成你自己的表达库`}
          breadcrumbRight={<FeedbackButton />}
        />

        {/* 登录软引导：仅匿名且已攒下东西时出现。totalCount === 0 不放——
            没有素材可保存时谈「永久保存」只是噪音。titleAs 保持默认 'p'：本页已有 h1（ManageHeader）。 */}
        {isAnon && totalCount > 0 && (
          <LoginPrompt variant="slim" className="mb-4" />
        )}

        {/* 题卡复习入口（hub 区第一张卡）—— 与移动端「题卡 Hero」同范式镜像。交互结构（修嵌套交互）：
            卡片本体不再整卡包 Link——标题行（含可点问号气泡 HeroHelpTip）在 Link 外；主体命中区（叠卡 + 计数 +
            说明）是一枚大 Link；右侧一枚真实 Link CTA 胶囊（开始刷题卡 → /anki/review；「今日复习」入口收进
            review 页一级筛选，不在 Hero 另开）。叠卡桌面静态、不迁移动端浮动动效（密面板风更克制）。
            href 恒指 /anki/review（review 页对 0 题自有空态）。 */}
        <Card variant="gradient" className="px-[26px] py-[22px] mb-4">
          {/* 标题行（Link 外：HeroHelpTip 是可点气泡，嵌 Link 内是交互嵌套） */}
          <div className="flex items-center gap-2">
            <h2 className="text-[1.25rem] font-bold text-v2-text-primary tracking-[-0.2px]">题库速览</h2>
            <Tag label="当季·新" variant="green" />
            <HeroHelpTip text={HERO_HELP_TEXT} />
          </div>

          <div className="flex items-center gap-7 mt-2">
            {/* 主体命中区：叠卡 + 计数行 + 两句说明，一枚大 Link */}
            <ProgressLink
              href="/anki/review"
              aria-label={ankiLoading
                ? '题库速览，加载中'
                : ankiHasCards
                  ? isAnon
                    ? `题库速览，当季 ${ankiSeasonCount} 张，开始刷题卡`
                    : `题库速览，当季 ${ankiSeasonCount} 张，待复习 ${ankiDueCount} 张，开始刷题卡`
                  : '题库速览，随时开始刷当季题卡'}
              className="flex flex-1 min-w-0 items-center gap-7 active:scale-[0.99] transition-transform focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:outline-offset-2"
            >
              {/* 左段·叠卡视觉（两张背卡错位旋转 + 一张正面卡显 Part N + 分隔线 + 题面 3 行截断） */}
              <div className="relative w-[96px] h-[120px] flex-shrink-0" aria-hidden="true">
                <div
                  className="absolute w-[78px] h-[102px] rounded-[14px] bg-bg-muted"
                  style={{ boxShadow: DECK_SHADOW, top: 9, left: 9, transform: 'translate(-3px,3px) rotate(-9deg)' }}
                />
                <div
                  className="absolute w-[78px] h-[102px] rounded-[14px] bg-bg-muted"
                  style={{ boxShadow: DECK_SHADOW, top: 9, left: 9, transform: 'translate(4px,1px) rotate(5deg)' }}
                />
                <div
                  className="absolute w-[78px] h-[102px] rounded-[14px] bg-bg-surface flex flex-col items-center justify-center overflow-hidden px-2"
                  style={{ boxShadow: DECK_SHADOW, top: 9, left: 9, transform: 'rotate(-2deg)' }}
                >
                  <span className="text-[0.625rem] font-bold text-brand-primary-dark">Part {ankiSample?.part ?? 1}</span>
                  <div className="w-[26px] h-[3px] rounded-full my-1" style={{ background: BRAND_GRADIENT }} />
                  <span
                    className="text-[0.625rem] leading-tight text-v2-text-secondary text-center break-words"
                    style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                  >
                    {ankiSample?.text ?? '当季题卡'}
                  </span>
                </div>
              </div>

              {/* 中段·文案（计数 + 说明文案）；标题行已移出到 Link 外 */}
              <div className="flex-1 min-w-0">
                {/* 计数：真实当季张数；匿名不显「待复习」段（due 队列只含已答卡，匿名恒空）；
                    0 / 取数失败退通用文案不带 0（当季恒有题，绝不显「暂无」） */}
                <p className="text-[0.75rem] text-v2-text-muted">
                  {ankiLoading
                    ? '加载中…'
                    : ankiHasCards
                      ? isAnon
                        ? <>当季 {ankiSeasonCount} 张</>
                        : <>当季 {ankiSeasonCount} 张 · 待复习 <span className="text-brand-primary-dark font-bold text-[0.9375rem]">{ankiDueCount}</span> 张</>
                      : HERO_EMPTY_FALLBACK}
                </p>
                {/* 说明文案（紧跟计数行、Hero 卡内）：入口是什么 + 结对价值；操作指引在标题旁问号气泡 */}
                <p className="text-[0.8125rem] text-v2-text-secondary leading-relaxed mt-3">{HERO_TITLE_DESC}</p>
                <p className="text-[0.8125rem] text-v2-text-secondary leading-relaxed mt-2">{HERO_PAIR_DESC}</p>
              </div>
            </ProgressLink>

            {/* 右段·CTA：一枚真实 Link 胶囊（命中区 ≥44px） */}
            <div className="flex flex-col items-stretch flex-shrink-0">
              <ProgressLink
                href="/anki/review"
                className="inline-flex items-center justify-center gap-[3px] min-h-[44px] rounded-full px-6 py-3 text-[0.875rem] font-medium active:scale-[0.97] transition-transform focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:outline-offset-2"
                style={GRADIENT_BORDER_STYLE}
              >
                <span className="text-v2-text-secondary">开始刷题卡</span>
                <span className="text-brand-primary-dark">›</span>
              </ProgressLink>
            </div>
          </div>
        </Card>

        {/* 今日复习 hero —— 复用 /review 入口 */}
        <ProgressLink href="/review" className="block focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:outline-offset-2">
          <Card variant="gradient" className="px-[22px] py-[18px] flex items-center gap-5 active:scale-[0.99] transition-transform">
            <div className="flex-1 min-w-0">
              <span className="text-[0.75rem] font-semibold text-brand-primary-dark">今日复习 · 词组闪卡</span>
              <p className="text-[1.0625rem] font-bold text-v2-text-primary mt-1">
                {dueCount > 0
                  ? <><span className="text-brand-primary-dark">{dueCount}</span> 张词卡，等你翻一翻</>
                  : '今天没有要复习的卡'}
              </p>
              <p className="text-[0.8125rem] text-v2-text-secondary mt-1">把收藏的词组记牢——一天几张，不费劲。</p>
            </div>
            <span className="inline-flex items-center gap-[3px] rounded-full px-5 py-2.5 text-[0.875rem] font-medium flex-shrink-0" style={GRADIENT_BORDER_STYLE}>
              <span className="text-v2-text-secondary">开始复习</span>
              <span className="text-brand-primary-dark">›</span>
            </span>
          </Card>
        </ProgressLink>

        {/* 四类 Tab 分段切换 + 右侧「选择」工具栏槽（同一行，右对齐） */}
        <div className="flex items-center justify-between gap-3 my-5">
          <div className="flex gap-[3px] p-[3px] bg-bg-muted rounded-[10px] w-fit max-w-full overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => selectTab(t.id)}
                aria-pressed={tab === t.id}
                className={`flex items-center gap-1.5 text-[0.8125rem] px-[16px] py-[7px] rounded-[8px] whitespace-nowrap transition-colors ${tab === t.id ? 'bg-white text-v2-text-primary font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-v2-text-muted font-medium'}`}
              >
                {t.label}
                {searching && t.id === tab && activeCounts ? (
                  <span className="text-[0.75rem] text-v2-text-secondary">
                    {activeCounts.matched}<span className="text-v2-text-muted">/{activeCounts.total}</span>
                  </span>
                ) : (
                  <span className="text-[0.75rem] text-v2-text-muted">{t.count}</span>
                )}
              </button>
            ))}
          </div>
          {/* 右侧：搜索框/搜索图标 + 垃圾桶/工具栏槽。三态：选择模式→搜索禁用+工具栏；搜索展开→输入框+垃圾桶并存；默认→图标+垃圾桶 */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {searchOpen && !activeSelecting ? (
              <SearchBox value={rawQuery} onChange={setRawQuery} onClose={closeSearch} />
            ) : (
              <IconButton
                icon={Search}
                label="搜索"
                disabled={activeSelecting}
                onClick={() => setSearchOpen(true)}
              />
            )}
            {isSelectableTab ? (
              /* 已接入多选的 tab：对应 tab 组件把「选择」/工具栏 Portal 到这里 */
              <div ref={toolbarSlotRef} className="flex items-center gap-2" />
            ) : (
              /* 未接入 tab：多选删除尚未实现，点击弹占位 Toast */
              <IconButton icon={Trash2} label="选择" onClick={() => setHint('多选删除即将上线')} />
            )}
          </div>
        </div>

        {/* 当前 Tab 内容（复用现有子组件，列表在 lg 下两栏） */}
        {tab === 'cards'   && <CollectedCardsTab cards={cards} toolbarSlotRef={toolbarSlotRef} onSelectingChange={setActiveSelecting} searchQuery={searchQuery} onSearchCountsChange={setActiveCounts} />}
        {tab === 'phrases' && <SavedWordsTab toolbarSlotRef={toolbarSlotRef} onSelectingChange={setActiveSelecting} searchQuery={searchQuery} onSearchCountsChange={setActiveCounts} />}
        {tab === 'pron'    && <PronunciationTab toolbarSlotRef={toolbarSlotRef} onSelectingChange={setActiveSelecting} searchQuery={searchQuery} onSearchCountsChange={setActiveCounts} />}
        {/* 我的语料 tab（一条语料一张卡，绑的题收在卡内 + 多选删语料）：自持数据/加载/筛选/空态；
            桌面多选删除工具栏 Portal 到右侧槽，删语料即解绑（绑定题卡退回题目分析、卡背清空，走 0060 事务型 RPC）。 */}
        {tab === 'stories' && <MyCorpusTab toolbarSlotRef={toolbarSlotRef} onSelectingChange={setActiveSelecting} searchQuery={searchQuery} onSearchCountsChange={setActiveCounts} onCountChange={onCorpusCountChange} />}
      </main>

      {/* 占位提示 Toast（搜索 / 其他 tab 多选删除「即将上线」）；与 CollectedCardsTab 的 UndoToast 锚点不同，不冲突 */}
      <Toast message={hint} onDismiss={() => setHint(null)} />
    </div>
  )
}
