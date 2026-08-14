/**
 * @module   QuestionBankDesktop
 * @desc     当季题库（桌面端）— 顶部导航 + 面包屑页头 + 维度设计/题目列表 Tab；密面板风（对齐 questionbank v3）
 * @author   LingoBridge
 * @created  2026-06-01
 */
'use client'
import { Suspense } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useNav } from '@/components/NavProgress'
import TopNav from '@/components/TopNav'
import ManageHeader, { MANAGE_CONTAINER } from '@/components/ManageHeader'
import FeedbackButton from '@/components/FeedbackButton'
import DimensionTab from './DimensionTab'
import QuestionListTab from './QuestionListTab'
import type { useQuestionBank } from './useQuestionBank'
import EmptyState from '@/components/EmptyState'
import Skeleton from '@/components/Skeleton'
import OfflineState from '@/components/OfflineState'
import { useTabView } from '@/hooks/useTabView'
import { toQuestionBankTabId, type QuestionBankTab } from '@/lib/tab-view'

// 埋点映射表就按这个联合类型建，故这里【引用而不是另抄一份】：改动 tab 内部值会当场 tsc 报错。
// 🔴 这两个中文串是界面文案，绝不许原样上报（映射成 qbank_* 枚举，见 lib/tab-view 顶注）。
type ActiveTab = QuestionBankTab
const TABS: ActiveTab[] = ['维度设计', '题目列表']
// tab ↔ URL slug（维度设计为默认，不写 param 保持 URL 清爽）
const TAB_SLUG: Record<ActiveTab, string> = { 维度设计: 'dimension', 题目列表: 'list' }
const SLUG_TAB: Record<string, ActiveTab> = { dimension: '维度设计', list: '题目列表' }

/** useSearchParams 需在 Suspense 内；本页 page.tsx 不便改，故边界内建于此。 */
export default function QuestionBankDesktop(props: { qb: ReturnType<typeof useQuestionBank> }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg-page" />}>
      <QuestionBankDesktopContent {...props} />
    </Suspense>
  )
}

function QuestionBankDesktopContent({ qb }: { qb: ReturnType<typeof useQuestionBank> }) {
  const router = useRouter()
  const { navigate } = useNav() // 空态「去录制」跳首页走 navigate 亮进度条；tab 同步仍用 router.replace（不卸载页）
  const pathname = usePathname()
  const params = useSearchParams()
  // tab 由 URL 派生（?tab=list → 题目列表；缺省 → 维度设计），刷新/分享保持
  const activeTab: ActiveTab = SLUG_TAB[params.get('tab') ?? ''] ?? '维度设计'
  // page.tab_view 埋点：默认 tab（维度设计）在挂载时也报一条 ⇒ qbank_dimension 天然偏高，
  // 且【加载中/出错/无语料空态也会计一条】（上报早于 qb 返回）—— 两条口径见 event-schema 的 TAB_ID。
  // side='desktop'：本页与 QuestionBankMobile 【同时挂载】，靠断点闸掉不可见的那棵树。
  useTabView(toQuestionBankTabId(activeTab), 'desktop')
  const setActiveTab = (tab: ActiveTab) => {
    const p = new URLSearchParams(params.toString())
    if (tab === '维度设计') p.delete('tab')   // 默认态清 param
    else p.set('tab', TAB_SLUG[tab])
    const qs = p.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
  // 加载完成、无错误、且一条语料都没有 → 显示空态（替掉全 0 的雷达盘）
  const isEmpty = !qb.loading && !qb.error && qb.corpusCount === 0

  return (
    <div className="min-h-screen bg-bg-page">
      <TopNav containerClassName={MANAGE_CONTAINER} />

      <main className={`${MANAGE_CONTAINER} pb-12`}>
        <ManageHeader
          title="当季题库"
          breadcrumbRight={<FeedbackButton />}
          titleRight={
            // 切换器只在有语料时出现；空/加载/错误态整个插槽不渲染（反馈入口在 breadcrumbRight，不受此条件影响）
            !isEmpty ? (
              <div className="flex gap-[3px] p-[3px] bg-bg-muted rounded-[10px]">
                {TABS.map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    aria-pressed={activeTab === tab}
                    className={`text-[0.8125rem] px-[18px] py-[7px] rounded-[8px] transition-colors ${activeTab === tab ? 'bg-white text-v2-text-primary font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-v2-text-muted font-medium'}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            ) : undefined
          }
        />

        {qb.loading && (
          // aria-busy 挂在未 hidden 的容器上才会被播报；骨架内容各自 aria-hidden
          <div className="flex flex-col gap-4" aria-busy="true">
            {/* 进度卡骨架 */}
            <div className="bg-white rounded-[16px] border border-black/[0.05] shadow-[0_1px_8px_rgba(0,0,0,0.06)] px-4 pt-4 pb-3" aria-hidden="true">
              <div className="flex items-center justify-between mb-3">
                <Skeleton className="w-28 h-3.5" />
                <Skeleton className="w-16 h-4" />
              </div>
              <Skeleton className="w-full h-2 rounded-full" />
              <Skeleton className="w-2/5 h-3 mt-2.5" />
            </div>

            {/* 题目行骨架 ×4 */}
            <div className="grid grid-cols-2 gap-2.5" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-[14px] border border-black/[0.05] shadow-[0_1px_6px_rgba(0,0,0,0.05)] px-[14px] py-[12px] flex items-center gap-[10px]">
                  <div className="flex-1">
                    <Skeleton className="w-12 h-[16px] rounded-full" />
                    <Skeleton className="w-[80%] h-3 mt-2" />
                  </div>
                  <Skeleton className="w-12 h-7 rounded-full flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}
        {qb.error && (
          typeof navigator !== 'undefined' && !navigator.onLine ? (
            <OfflineState onRetry={() => window.location.reload()} />
          ) : (
            // 错误文案需带下一步动作（复用 EmptyState 的重试 CTA，与 matching 页一致）
            <EmptyState
              title="题库没加载出来"
              subtitle={qb.error}
              ctaLabel="重试"
              onCta={() => window.location.reload()}
              orbSize={100}
            />
          )
        )}
        {isEmpty && (
          <EmptyState
            title="还没有匹配的题目"
            subtitle="先去首页录一条故事，我们会自动帮你匹配雅思题"
            ctaLabel="去录制"
            onCta={() => navigate('/')}
          />
        )}
        {!isEmpty && !qb.loading && !qb.error && activeTab === '维度设计' && (
          <DimensionTab
            scoreById={qb.scoreById}
            progressById={qb.progressById}
            corpusCount={qb.corpusCount}
            dimensionSummaries={qb.dimensionSummaries}
            totalMapped={qb.totalMapped}
            totalMatched={qb.totalMatched}
          />
        )}
        {!isEmpty && !qb.loading && !qb.error && activeTab === '题目列表' && (
          <QuestionListTab
            mappedQuestions={qb.mappedQuestions}
            offseasonQuestions={qb.offseasonQuestions}
            totalMapped={qb.totalMapped}
            totalMatched={qb.totalMatched}
            availableParts={qb.availableParts}
          />
        )}
      </main>
    </div>
  )
}
