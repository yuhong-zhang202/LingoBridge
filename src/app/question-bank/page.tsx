/**
 * @module   QuestionBankPage
 * @desc     当季题库主页面 — 维度设计 / 题目列表 Tab 切换，数据由 useQuestionBank 统一加载
 * @author   LingoBridge
 * @created  2026-06-01
 */
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import RequireAccountGate from '@/components/RequireAccountGate'
import DimensionTab from './DimensionTab'
import QuestionListTab from './QuestionListTab'
import { useQuestionBank } from './useQuestionBank'
import EmptyState from '@/components/EmptyState'

type ActiveTab = '维度设计' | '题目列表'
const TABS: ActiveTab[] = ['维度设计', '题目列表']

export default function QuestionBankPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('维度设计')
  const qb = useQuestionBank()
  const router = useRouter()
  // 加载完成、无错误、且一条语料都没有 → 显示空态（替掉全 0 的雷达盘）
  const isEmpty = !qb.loading && !qb.error && qb.corpusCount === 0

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <TopBar title="当季题库" />

      <RequireAccountGate>
      {!isEmpty && (
        <div className="px-5 pt-4 pb-0 flex-shrink-0">
          <div className="flex rounded-[10px] p-[3px] bg-bg-inner">
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

      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-[72px] relative z-10">
        {qb.loading && (
          <p className="text-[13px] text-v2-text-muted text-center pt-16">加载中…</p>
        )}
        {qb.error && (
          <p className="text-[13px] text-error text-center pt-16">{qb.error}</p>
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
