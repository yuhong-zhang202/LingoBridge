/**
 * @module   QuestionBankPage
 * @desc     当季题库主页面 — 维度设计 / 题目列表 Tab 切换
 * @author   LingoBridge
 * @created  2026-06-01
 */
'use client'
import { useState } from 'react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import DimensionTab from './DimensionTab'
import QuestionListTab from './QuestionListTab'

type ActiveTab = '维度设计' | '题目列表'
const TABS: ActiveTab[] = ['维度设计', '题目列表']

export default function QuestionBankPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('维度设计')

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <TopBar title="当季题库" />

      <div className="px-5 pt-4 pb-0 flex-shrink-0">
        <div className="flex rounded-[10px] p-[3px] bg-[#F4F4F4]">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`
                flex-1 h-[34px] rounded-[8px] text-[13px] font-medium transition-colors duration-150
                ${activeTab === tab ? 'bg-white text-[#111] font-semibold shadow-sm' : 'text-[#888] font-medium'}
              `}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-[72px] relative z-10">
        {activeTab === '维度设计' ? <DimensionTab /> : <QuestionListTab />}
      </div>

      <div className="relative z-20 flex-shrink-0"><TabBar /></div>
    </div>
  )
}
