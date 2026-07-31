/**
 * @module   LibraryPage
 * @desc     素材库入口 — 统一加载数据，按断点分发两套 UI：
 *           移动端(lg 以下)走改版前 hub + 二级列表，桌面端(lg 及以上)走密面板版
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { listMyCorpus, getCorpusPointCodes } from '@/lib/db/corpus'
import { getQuestionCountByObservations } from '@/lib/db/questions'
import { DIMENSION_LABEL } from '@/lib/constants'
import { useSavedPhrases, useSavedWords, useSavedPronunciations } from '@/hooks/library-data'
import { getDueCount } from '@/lib/db/phrase-cards'
import { fetchAnkiSummary } from '@/lib/anki/cards-client'
import { ensureSession } from '@/lib/supabase'
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
  // 当季对子数（corpusId 非空且已答的卡）：首屏从下方 anki「全部」拉取派生（无新增请求）、与「语料匹配」tab
  // 的 answered 口径一致，供 tab 胶囊 / hub 徽标显示。进过 tab 后由 CorpusMatchesTab 经 onCorpusCountChange
  // 回上报最新 pairs.length（删对子即回落，无需刷新）；未进过 tab 则沿用此首屏派生值（hub 一进来即有数）。
  const [pairCount, setPairCount]   = useState(0)

  // 题卡 Hero 数据（Anki 当季题卡入口）。⚠️ 性能：改前为「fetchAnkiCards(1,'all')+fetchAnkiCards(2,'all')
  // 拉当季全部 ~686 张卡（连 analysis 全文 ~1.3MB）到浏览器再 .length/.filter」，只为算这几个数字，慢在下载。
  // 现改调 GET /api/anki/summary —— 服务端（Zeabur香港↔Supabase新加坡内网快链）算好只回 ~200 字节：
  //   - ankiSeasonCount = 当季全部可刷卡片总数（part1+part2+part2 带的 part3 子卡，含默认卡）= 牌堆「全部」张数；
  //   - ankiDueCount    = 已答主卡里到期张数（口径同旧 scope='answered' 到期过滤，不回归）；
  //   - ankiSample      = 已答卡首题优先，否则当季首题；仅当季真 0 题才为 null；
  //   - pairCount       = 当季已绑语料且已答的对子数（供语料匹配 tab 徽标基数，口径不变）。
  // 计数口径与旧前端派生逐条一致（见 summary/route.ts）。
  const [ankiSeasonCount, setAnkiSeasonCount] = useState(0)
  const [ankiDueCount, setAnkiDueCount]       = useState(0)
  const [ankiSample, setAnkiSample]           = useState<AnkiHeroSample | null>(null)
  // 题卡 Hero 加载态：初值 true，异步拉取 finally 置 false。Hero 据此分流（加载中→「加载中…」，
  // 完成有题→真实当季张数，完成/失败 0 题→通用「当季题卡 · 随时刷」不带 0，绝不显「当季暂无题卡」——
  // 当季恒有题，0 只可能是取数失败），避免拉取返回前 count=0 被误判成空态。
  const [ankiLoading, setAnkiLoading]         = useState(true)

  // 三类收藏：SWR 单源（各自首拉顺带触发一次幂等迁移）
  const { phrases } = useSavedPhrases()
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
      note: p.note,
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

    // 题卡 Hero 概况：调 summary 端点，服务端算好几个计数只回 ~200 字节（见上方 ⚠️ 与 summary/route.ts）。
    // 失败静默降级为空态（Hero 仍显示），不阻塞素材库其余模块。
    void (async () => {
      try {
        // 先确保匿名会话（token）就位：GET /api/anki/summary 对匿名放行、但仍需带 Bearer token，
        // 否则常并发早于 listMyCorpus/getDueCount 内部建会话 → 401 降级空态 → Hero 误显「当季暂无题卡」。
        await ensureSession()
        const s = await fetchAnkiSummary()
        setAnkiSeasonCount(s.seasonCount)
        setAnkiDueCount(s.dueCount)
        setPairCount(s.pairCount)
        setAnkiSample(s.sample)
      } catch (e) {
        console.warn('[LibraryPage] 获取题卡概况失败，Hero 走空态', e)
      } finally {
        setAnkiLoading(false)
      }
    })()

    // 我的语料：Supabase 异步读，仅用于 hub「已攒下 N 条」总计（语料匹配 tab 已改为自持对子数据，不再依赖此列表）
    fetchStories()
      .then(setStories)
      .catch((e: unknown) => console.error('[LibraryPage] 加载语料失败', e))
  }, [fetchStories])

  const viewProps = { stories, cards, wordsCount, pronCount, dueCount, pairCount, onCorpusCountChange: setPairCount, ankiSeasonCount, ankiDueCount, ankiSample, ankiLoading }

  return (
    <>
      <div className="lg:hidden"><LibraryMobile {...viewProps} /></div>
      <div className="hidden lg:block"><LibraryDesktop {...viewProps} /></div>
    </>
  )
}
