/**
 * @module   QuestionBankMobile
 * @desc     当季题库（移动端）— TopBar + 维度设计/题目列表分段 Tab + 单列内容 + 底部 TabBar；改版前独立移动 UI
 * @author   LingoBridge
 * @created  2026-06-01
 */
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import RequireAccountGate from '@/components/RequireAccountGate'
import DimensionTab from './DimensionTabMobile'
import QuestionListTab from './QuestionListTabMobile'
import type { useQuestionBank } from './useQuestionBank'
import EmptyState from '@/components/EmptyState'
import Skeleton from '@/components/Skeleton'
import OfflineState from '@/components/OfflineState'

type ActiveTab = '维度设计' | '题目列表'
const TABS: ActiveTab[] = ['维度设计', '题目列表']

export default function QuestionBankMobile({ qb }: { qb: ReturnType<typeof useQuestionBank> }) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('维度设计')
  const router = useRouter()
  // 加载完成、无错误、且一条语料都没有 → 显示空态（替掉全 0 的雷达盘）
  const isEmpty = !qb.loading && !qb.error && qb.corpusCount === 0

  return (
    <div className="relative h-dvh overflow-hidden bg-bg-page flex flex-col">
      <TopBar title="当季题库" />

      <RequireAccountGate>
      {!isEmpty && (
        <div className="px-6 pt-4 pb-0 flex-shrink-0">
          <div className="flex rounded-[10px] p-[3px] bg-bg-muted">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 h-[34px] rounded-[8px] text-[13px] font-medium transition-colors duration-150 ${activeTab === tab ? 'bg-white text-v2-text-primary font-semibold shadow-sm' : 'text-v2-text-muted font-medium'}`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className="flex-1 min-h-0 overflow-y-auto px-6 pt-4 relative z-10"
        style={{ paddingBottom: 'calc(72px + env(safe-area-inset-bottom))' }}
      >
        {qb.loading && (
          <div className="flex flex-col gap-4" aria-busy="true">
            {/* 进度卡骨架 */}
            <div className="bg-white rounded-[16px] border border-black/[0.05] shadow-[0_1px_8px_rgba(0,0,0,0.06)] px-4 pt-4 pb-3">
              <div className="flex items-center justify-between mb-3">
                <Skeleton className="w-28 h-3.5" />
                <Skeleton className="w-16 h-4" />
              </div>
              <Skeleton className="w-full h-2 rounded-full" />
              <Skeleton className="w-2/5 h-3 mt-2.5" />
            </div>

            {/* 筛选 chips 骨架 */}
            <div className="flex gap-2">
              <Skeleton className="w-12 h-[26px] rounded-full" />
              <Skeleton className="w-16 h-[26px] rounded-full" />
              <Skeleton className="w-16 h-[26px] rounded-full" />
            </div>

            {/* 题目行骨架 ×4 */}
            <div className="flex flex-col gap-2">
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
            <p className="text-[13px] text-error text-center pt-16">{qb.error}</p>
          )
        )}
        {isEmpty && (
          <EmptyState
            title="还没有匹配的题目"
            subtitle="先去首页录一条故事，我们会自动帮你匹配雅思题"
            ctaLabel="去录制"
            onCta={() => router.push('/')}
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
            totalMapped={qb.totalMapped}
            totalMatched={qb.totalMatched}
            availableParts={qb.availableParts}
          />
        )}
      </div>

      </RequireAccountGate>

      <div className="relative z-20 flex-shrink-0"><TabBar /></div>
    </div>
  )
}
