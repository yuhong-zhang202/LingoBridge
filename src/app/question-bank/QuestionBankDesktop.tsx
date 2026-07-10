/**
 * @module   QuestionBankDesktop
 * @desc     当季题库（桌面端）— 顶部导航 + 面包屑页头 + 维度设计/题目列表 Tab；密面板风（对齐 questionbank v3）
 * @author   LingoBridge
 * @created  2026-06-01
 */
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import TopNav from '@/components/TopNav'
import ManageHeader, { MANAGE_CONTAINER } from '@/components/ManageHeader'
import RequireAccountGate from '@/components/RequireAccountGate'
import DimensionTab from './DimensionTab'
import QuestionListTab from './QuestionListTab'
import type { useQuestionBank } from './useQuestionBank'
import EmptyState from '@/components/EmptyState'
import Skeleton from '@/components/Skeleton'
import OfflineState from '@/components/OfflineState'

type ActiveTab = '维度设计' | '题目列表'
const TABS: ActiveTab[] = ['维度设计', '题目列表']

export default function QuestionBankDesktop({ qb }: { qb: ReturnType<typeof useQuestionBank> }) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('维度设计')
  const router = useRouter()
  // 加载完成、无错误、且一条语料都没有 → 显示空态（替掉全 0 的雷达盘）
  const isEmpty = !qb.loading && !qb.error && qb.corpusCount === 0

  return (
    <div className="min-h-screen bg-bg-page">
      <TopNav containerClassName={MANAGE_CONTAINER} />

      <RequireAccountGate>
        <main className={`${MANAGE_CONTAINER} pb-12`}>
          <ManageHeader
            title="当季题库"
            right={!isEmpty && (
              <div className="flex gap-[3px] p-[3px] bg-bg-inner rounded-[10px]">
                {TABS.map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    aria-pressed={activeTab === tab}
                    className={`text-[13px] px-[18px] py-[7px] rounded-[8px] transition-colors ${activeTab === tab ? 'bg-white text-v2-text-primary font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-v2-text-muted font-medium'}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            )}
          />

          {qb.loading && (
            <div className="flex flex-col gap-4">
              {/* 进度卡骨架 */}
              <div className="bg-white rounded-[16px] border border-black/[0.05] shadow-[0_1px_8px_rgba(0,0,0,0.06)] px-4 pt-4 pb-3">
                <div className="flex items-center justify-between mb-3">
                  <Skeleton className="w-28 h-3.5" />
                  <Skeleton className="w-16 h-4" />
                </div>
                <Skeleton className="w-full h-2 rounded-full" />
                <Skeleton className="w-2/5 h-3 mt-2.5" />
              </div>

              {/* 题目行骨架 ×4 */}
              <div className="grid grid-cols-2 gap-2.5">
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
        </main>
      </RequireAccountGate>
    </div>
  )
}
