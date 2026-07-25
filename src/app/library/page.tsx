/**
 * @module   LibraryPage
 * @desc     素材库入口 — 统一加载数据，按断点分发两套 UI：
 *           移动端(lg 以下)走改版前 hub + 二级列表，桌面端(lg 及以上)走密面板版
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { listMyCorpus, getCorpusPointCodes, deleteCorpus } from '@/lib/db/corpus'
import { getQuestionCountByObservations } from '@/lib/db/questions'
import { DIMENSION_LABEL } from '@/lib/constants'
import { useSavedPhrases, useSavedWords, useSavedPronunciations } from '@/hooks/library-data'
import { getDueCount } from '@/lib/db/phrase-cards'
import { fetchAnkiCards } from '@/lib/anki/cards-client'
import { formatRelativeTime } from '@/lib/utils'
import type { MyStory, CollectedCard, DimensionLabel } from '@/lib/types'
import type { AnkiHeroSample } from './types'
import LibraryMobile from './LibraryMobile'
import LibraryDesktop from './LibraryDesktop'

function codeToLabel(code: string): DimensionLabel | undefined {
  const prefix = code.split('_')[0] ?? ''
  if (prefix === 'EMO') return DIMENSION_LABEL.emotion
  if (prefix === 'REL') return DIMENSION_LABEL.relationship
  if (prefix === 'SPA') return DIMENSION_LABEL.space
  if (prefix === 'SPI') return DIMENSION_LABEL.spirit
  if (prefix === 'GRO') return DIMENSION_LABEL.growth
  if (prefix === 'VAL') return DIMENSION_LABEL.value
  return undefined
}

export default function LibraryPage() {
  const [stories, setStories]       = useState<MyStory[]>([])
  const [dueCount, setDueCount]     = useState(0)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)

  // 题卡 Hero 数据（Anki 当季题卡入口）。无专用计数 RPC，故复用 fetchAnkiCards 拉当季 part1/part2 的【全部】
  // 卡（scope='all'）后本地派生三口径（一次 all 拉取即够，请求数与改前的两次 answered 拉取相同、无新增 DB
  // 函数/端点）：
  //   - ankiSeasonCount = 当季可刷主题总数（part1+part2 所有题，含用户没碰过的默认卡）——设定是「所有题都能刷」，
  //     新用户也能直接刷；
  //   - ankiDueCount    = 用户【已答】卡里到期的张数（只数 isAnswered 卡、按其真实 due_at；默认卡 due_at 被
  //     coalesce 成 now 且 isAnswered=false，滤掉即等价于旧 scope='answered' 口径，不回归）；
  //   - ankiSample      = 已答卡首题优先，否则当季首题；仅当季真 0 题才为 null（空态不显预览）。
  // part3 是子题、不单列入口，排除。
  const [ankiSeasonCount, setAnkiSeasonCount] = useState(0)
  const [ankiDueCount, setAnkiDueCount]       = useState(0)
  const [ankiSample, setAnkiSample]           = useState<AnkiHeroSample | null>(null)

  // 三类收藏：SWR 单源（各自首拉顺带触发一次幂等迁移）
  const { phrases, isLoading: phrasesLoading } = useSavedPhrases()
  const { words } = useSavedWords()
  const { pronunciations } = useSavedPronunciations()
  const wordsCount = words.length
  const pronCount = pronunciations.length

  // 语料卡收藏映射成展示用 CollectedCard
  const cards = useMemo<CollectedCard[]>(
    () => phrases.map((p) => ({
      id: p.id,
      questionId: '',
      part: `Part ${p.part}` as CollectedCard['part'],
      topicEn: p.questionEn,
      originalSentence: p.original,
      aiOptimized: p.optimized,
      collectedAt: formatRelativeTime(p.createdAt),
      keywords: undefined,
    })),
    [phrases],
  )

  // 拉取「我的语料」并计算每条的匹配题数/主维度（初次加载与批量删除后刷新共用）
  const fetchStories = useCallback(async (): Promise<MyStory[]> => {
    const corpus = await listMyCorpus()
    return Promise.all(
      corpus.map(async (c) => {
        let matchedCount = 0
        let dimension: MyStory['dimension'] = undefined
        try {
          const { codes, primaryCode } = await getCorpusPointCodes(c.id)
          matchedCount = await getQuestionCountByObservations(codes)
          dimension = primaryCode ? codeToLabel(primaryCode) : undefined
        } catch (err: unknown) {
          console.warn('[LibraryPage] 计算语料匹配数失败，保留默认值', err)
        }
        return {
          id: c.id,
          inputType: c.source,
          content: c.cleanedText ?? c.rawText,
          createdAt: formatRelativeTime(c.createdAt),
          duration: undefined,
          matchedCount,
          dimension,
        }
      })
    )
  }, [])

  useEffect(() => {
    // 待复习数（异步）
    getDueCount()
      .then(setDueCount)
      .catch(e => console.warn('[LibraryPage] 获取待复习数失败', e))

    // 题卡 Hero 数据：拉当季【全部】part1 + part2 列表 → 本地派生当季总道数 / 已答到期张数 / 一句题面样本。
    // 失败静默降级为空态（Hero 仍显示），不阻塞素材库其余模块。
    void (async () => {
      try {
        const [p1, p2] = await Promise.all([
          fetchAnkiCards(1, 'all'),
          fetchAnkiCards(2, 'all'),
        ])
        const mains = [...p1, ...p2].filter(c => c.part !== 3) // part3 是子题、不单列入口
        const answeredMains = mains.filter(c => c.isAnswered)   // 待复习口径只算已答卡（保留旧 scope='answered' 语义）
        const now = Date.now()
        setAnkiSeasonCount(mains.length)                        // 当季可刷主题总数（所有 part1+2 题）
        setAnkiDueCount(answeredMains.filter(c => new Date(c.dueAt).getTime() <= now).length)
        const sample = answeredMains[0] ?? mains[0]             // 已答首题优先，否则当季首题
        setAnkiSample(sample ? { part: sample.part, text: sample.questionText } : null)
      } catch (e) {
        console.warn('[LibraryPage] 获取题卡概况失败，Hero 走空态', e)
      }
    })()

    // 我的语料：Supabase 异步读
    fetchStories()
      .then(setStories)
      .catch((e: unknown) => {
        console.error('[LibraryPage] 加载语料失败', e)
        setError('加载语料失败，请重试')
      })
      .finally(() => setLoading(false))
  }, [fetchStories])

  const onDeleteStory = useCallback((id: string) => {
    setStories(prev => prev.filter(s => s.id !== id))
    deleteCorpus(id).catch(e => console.error('[LibraryPage] 删除语料失败', e))
  }, [])

  // 批量删除后静默重拉（不翻 loading，避免 MyStoriesTab 连同确认框/结果 Toast 一起被卸载）
  const onRefresh = useCallback(() => {
    fetchStories()
      .then(setStories)
      .catch(e => console.error('[LibraryPage] 刷新语料失败', e))
  }, [fetchStories])

  // 收藏卡与语料任一未就绪都算加载中，避免收藏 tab 先闪空态再填充
  const viewProps = { stories, cards, wordsCount, pronCount, dueCount, loading: loading || phrasesLoading, error, onDeleteStory, onRefresh, ankiSeasonCount, ankiDueCount, ankiSample }

  return (
    <>
      <div className="lg:hidden"><LibraryMobile {...viewProps} /></div>
      <div className="hidden lg:block"><LibraryDesktop {...viewProps} /></div>
    </>
  )
}
