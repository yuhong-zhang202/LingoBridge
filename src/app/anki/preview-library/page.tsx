/**
 * @module   anki/preview-library（⚠️ 临时预览页，仅供产品方本地看素材库全貌 + 题卡入口位置/大小，不接库、不上线）
 * @desc     本地 dev 用 mock 数据渲染真实素材库两套 UI（移动 <LibraryMobile> / 桌面 <LibraryDesktop>），
 *           按断点分发——和真实 library/page.tsx 完全一致（lg:hidden / hidden lg:block）。
 *           收藏/语料/词组/发音 + 题卡 Hero「当季 24 道·待复习 8 张」+ 一句真实题面预览。用完删。
 *           URL：/anki/preview-library（宽屏看桌面版，窄屏看移动版）。
 * @author   LingoBridge
 * @created  2026-07-24
 */
'use client'
import LibraryMobile from '@/app/library/LibraryMobile'
import LibraryDesktop from '@/app/library/LibraryDesktop'
import type { MyStory, CollectedCard } from '@/lib/types'

// mock 语料（带匹配数，喂 hub「我的语料」行的「已匹配 N 道题」）
const MOCK_STORIES: MyStory[] = [
  { id: 's1', inputType: 'voice', content: '上周和室友因为宿舍卫生分工吵了一架，后来我主动道歉。', createdAt: '2 天前', duration: undefined, matchedCount: 3, dimension: '人际羁绊' },
  { id: 's2', inputType: 'text', content: '喜欢一个人去家附近的公园湖边散步解压。', createdAt: '5 天前', duration: undefined, matchedCount: 2, dimension: undefined },
]

// mock 收藏卡（喂「收藏卡片」微预览）
const MOCK_CARDS: CollectedCard[] = [
  {
    id: 'c1', questionId: '', part: 'Part 2',
    topicEn: 'Describe a time you apologized to someone',
    originalSentence: 'I say sorry to my roommate about clean.',
    aiOptimized: 'I apologized to my roommate over how we split the dorm cleaning.',
    collectedAt: '2 天前', keywords: undefined,
  },
]

// mock 题卡 Hero 数据（题面取自 anki/preview 的真实生成示例）
const MOCK_ANKI_SAMPLE = { part: 2, text: 'Describe a time when you apologized to someone. You should say who you apologized to and how you felt afterwards.' }

export default function PreviewLibraryPage(): React.JSX.Element {
  const viewProps = {
    stories: MOCK_STORIES,
    cards: MOCK_CARDS,
    wordsCount: 12,
    pronCount: 7,
    dueCount: 5,
    loading: false,
    error: null,
    onDeleteStory: () => {},
    onRefresh: () => {},
    ankiSeasonCount: 24,
    ankiDueCount: 8,
    ankiSample: MOCK_ANKI_SAMPLE,
  }
  return (
    <div className="min-h-dvh bg-bg-page">
      <p className="text-center text-[12px] text-v2-text-muted py-2">⚠️ 临时预览 · 素材库全貌 + 题卡入口（mock 数据，非真实）· 宽屏=桌面版 / 窄屏=移动版</p>
      {/* 与真实 library/page.tsx 一致：按断点分发两套 UI */}
      <div className="lg:hidden"><LibraryMobile {...viewProps} /></div>
      <div className="hidden lg:block"><LibraryDesktop {...viewProps} /></div>
    </div>
  )
}
