/**
 * @module   QuestionBankPage
 * @desc     当季题库主页面 — 维度设计 / 题目列表 Tab 切换，数据由 useQuestionBank 统一加载
 * @author   LingoBridge
 * @created  2026-06-01
 */
'use client'
import { useState } from 'react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import DimensionTab from './DimensionTab'
import QuestionListTab from './QuestionListTab'
import { useQuestionBank } from './useQuestionBank'

type ActiveTab = '维度设计' | '题目列表'
const TABS: ActiveTab[] = ['维度设计', '题目列表']

export default function QuestionBankPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('维度设计')
  const qb = useQuestionBank()

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <TopBar title="当季题库" />

      <div className="px-5 pt-4 pb-0 flex-shrink-0">
        <div className="flex rounded-[10px] p-[3px] bg-[#F4F4F4]">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 h-[34px] rounded-[8px] text-[13px] font-medium transition-colors duration-150 ${activeTab === tab ? 'bg-white text-[#111] font-semibold shadow-sm' : 'text-[#888] font-medium'}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-[72px] relative z-10">
        {qb.loading && (
          <p className="text-[13px] text-v2-text-muted text-center pt-16">加载中…</p>
        )}
        {qb.error && (
          <p className="text-[13px] text-error text-center pt-16">{qb.error}</p>
        )}
        {!qb.loading && !qb.error && activeTab === '维度设计' && (
          <DimensionTab
            scoreById={qb.scoreById}
            progressById={qb.progressById}
            corpusCount={qb.corpusCount}
            dimensionSummaries={qb.dimensionSummaries}
            totalMapped={qb.totalMapped}
            totalMatched={qb.totalMatched}
          />
        )}
        {!qb.loading && !qb.error && activeTab === '题目列表' && (
          <QuestionListTab
            mappedQuestions={qb.mappedQuestions}
            totalMapped={qb.totalMapped}
            totalMatched={qb.totalMatched}
            availableParts={qb.availableParts}
          />
        )}
      </div>

      <div className="relative z-20 flex-shrink-0"><TabBar /></div>
    </div>
  )
}
