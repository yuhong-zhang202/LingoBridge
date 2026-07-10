/**
 * @module   LibraryDesktop
 * @desc     素材库（桌面端）— 顶部导航 + 面包屑页头 + 今日复习 hero + 四类 Tab + 2 列卡片网格。密面板风（对齐题库 v3）。
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { Suspense, useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search, Trash2 } from 'lucide-react'
import TopNav from '@/components/TopNav'
import ManageHeader, { MANAGE_CONTAINER } from '@/components/ManageHeader'
import RequireAccountGate from '@/components/RequireAccountGate'
import Card from '@/components/Card'
import Skeleton from '@/components/Skeleton'
import EmptyState from '@/components/EmptyState'
import OfflineState from '@/components/OfflineState'
import IconButton from '@/components/IconButton'
import Toast from '@/components/Toast'
import SearchBox from '@/components/library/SearchBox'
import useDebouncedValue from '@/hooks/useDebouncedValue'
import CollectedCardsTab from '@/app/library/CollectedCardsTab'
import SavedWordsTab from '@/components/library/SavedWordsTab'
import PronunciationTab from '@/components/library/PronunciationTab'
import MyStoriesTab from '@/components/library/MyStoriesTab'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import type { LibraryViewProps } from './types'

type Tab = 'cards' | 'phrases' | 'pron' | 'stories'
const TAB_IDS: readonly Tab[] = ['cards', 'phrases', 'pron', 'stories']

/** 已接入多选删除的 tab：其垃圾桶走 Portal 槽（由 tab 组件渲染工具栏）；其余 tab 垃圾桶弹占位 Toast。后续批次接入 pron/stories 时加到这里即可。 */
const SELECTABLE_TABS: readonly Tab[] = ['cards', 'phrases', 'pron', 'stories']

/** useSearchParams 需在 Suspense 内；本页 page.tsx 不便改，故边界内建于此。 */
export default function LibraryDesktop(props: LibraryViewProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg-page" />}>
      <LibraryDesktopContent {...props} />
    </Suspense>
  )
}

function LibraryDesktopContent({ stories, cards, wordsCount, pronCount, dueCount, loading, error, onDeleteStory, onRefresh }: LibraryViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  // tab 由 URL 派生（?tab=phrases 等；缺省 → cards），刷新/分享保持
  const tab: Tab = TAB_IDS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'cards'

  const totalCount = stories.length + cards.length + wordsCount + pronCount
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
    { id: 'stories', label: '我的语料', count: stories.length },
  ] as const

  return (
    <div className="min-h-screen bg-bg-page">
      <TopNav containerClassName={MANAGE_CONTAINER} />

      <RequireAccountGate>
        <main className={`${MANAGE_CONTAINER} pb-12`}>
          <ManageHeader
            title="我的素材库"
            subtitle={`已攒下 ${totalCount} 条，慢慢成你自己的表达库`}
          />

          {/* 今日复习 hero —— 复用 /review 入口 */}
          <Link href="/review" className="block">
            <Card variant="gradient" className="px-[22px] py-[18px] flex items-center gap-5 active:scale-[0.99] transition-transform">
              <div className="flex-1 min-w-0">
                <span className="text-[12px] font-semibold text-brand-primary-dark">今日复习 · 词组闪卡</span>
                <p className="text-[17px] font-bold text-v2-text-primary mt-1">
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
            </Card>
          </Link>

          {/* 四类 Tab 分段切换 + 右侧「选择」工具栏槽（同一行，右对齐） */}
          <div className="flex items-center justify-between gap-3 my-5">
            <div className="flex gap-[3px] p-[3px] bg-bg-inner rounded-[10px] w-fit max-w-full overflow-x-auto">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => selectTab(t.id)}
                  aria-pressed={tab === t.id}
                  className={`flex items-center gap-1.5 text-[13px] px-[16px] py-[7px] rounded-[8px] whitespace-nowrap transition-colors ${tab === t.id ? 'bg-white text-v2-text-primary font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-v2-text-muted font-medium'}`}
                >
                  {t.label}
                  {searching && t.id === tab && activeCounts ? (
                    <span className="text-[12px] text-v2-text-secondary">
                      {activeCounts.matched}<span className="text-v2-text-muted">/{activeCounts.total}</span>
                    </span>
                  ) : (
                    <span className="text-[12px] text-v2-text-muted">{t.count}</span>
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
          {tab === 'stories' && (
            loading ? (
              // 加载态容器挂 aria-busy（不 hidden 才能被播报）；骨架为 Card+Skeleton、无文本，SR 不会读出内容
              <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-3" aria-busy="true">
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
            ) : error ? (
              typeof navigator !== 'undefined' && !navigator.onLine
                ? <OfflineState onRetry={() => window.location.reload()} />
                // 错误文案需带下一步动作（复用 EmptyState 的重试 CTA）
                : <EmptyState title="语料没加载出来" subtitle={error} ctaLabel="重试" onCta={() => window.location.reload()} orbSize={100} />
            ) : (
              <MyStoriesTab stories={stories} onDelete={onDeleteStory} onRefresh={onRefresh} toolbarSlotRef={toolbarSlotRef} onSelectingChange={setActiveSelecting} searchQuery={searchQuery} onSearchCountsChange={setActiveCounts} />
            )
          )}
        </main>
      </RequireAccountGate>

      {/* 占位提示 Toast（搜索 / 其他 tab 多选删除「即将上线」）；与 CollectedCardsTab 的 UndoToast 锚点不同，不冲突 */}
      <Toast message={hint} onDismiss={() => setHint(null)} />
    </div>
  )
}
