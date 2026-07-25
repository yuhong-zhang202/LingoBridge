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

  // 题卡 Hero 数据（Anki 当季题卡入口）。无专用计数 RPC，故复用 fetchAnkiCards 拉当季 part1/part2
  // 两份列表后本地派生：道数 = 用户已建卡的 part1+part2 主题；待复习张数 = 其中 due_at 已到期。
  // ⚠️ 口径（S2，产品方拍板）：「待复习」只算【用户真正建过/答过】的卡，故用 scope='answered'（get_anki_cards
  //   只返回 is_answered 的卡，见 0039）——不含从没碰过的默认卡（默认卡 due_at 被 coalesce 成 now，若用 'all'
  //   会把每道没碰过的题都算「待复习」、ankiHasCards 恒 true、新用户空态永不触发）。新用户 0 已答卡 →
  //   ankiSeasonCount=0 → 下游 ankiHasCards=false → Hero 走空态跳 /question-bank。part3 是子题、不单列入口，排除。
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

    // 题卡 Hero 数据：拉当季【已答】part1 + part2 列表 → 本地派生道数/待复习张数/一句题面样本。
    // 失败静默降级为空态（Hero 仍显示，导题库），不阻塞素材库其余模块。
    void (async () => {
      try {
        const [p1, p2] = await Promise.all([
          fetchAnkiCards(1, 'answered'),
          fetchAnkiCards(2, 'answered'),
        ])
        const mains = [...p1, ...p2].filter(c => c.part !== 3) // part3 是子题、不单列入口
        const now = Date.now()
        setAnkiSeasonCount(mains.length)
        setAnkiDueCount(mains.filter(c => new Date(c.dueAt).getTime() <= now).length)
        const first = mains[0]
        setAnkiSample(first ? { part: first.part, text: first.questionText } : null)
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
