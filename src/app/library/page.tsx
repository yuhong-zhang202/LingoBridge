/**
 * @module   LibraryPage
 * @desc     素材库入口 — 统一加载数据，按断点分发两套 UI：
 *           移动端(lg 以下)走改版前 hub + 二级列表，桌面端(lg 及以上)走密面板版
 * @author   LingoBridge
 * @created  2026-05-20
 */
'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { listMyCorpus } from '@/lib/db/corpus'
import { useSavedPhrases, useSavedWords, useSavedPronunciations } from '@/hooks/library-data'
import { getDueCount } from '@/lib/db/phrase-cards'
import { fetchAnkiSummary } from '@/lib/anki/cards-client'
import { ensureSession } from '@/lib/supabase'
import { formatRelativeTime } from '@/lib/utils'
import type { CollectedCard } from '@/lib/types'
import type { AnkiHeroSample } from './types'
import LibraryMobile from './LibraryMobile'
import LibraryDesktop from './LibraryDesktop'

export default function LibraryPage() {
  const [dueCount, setDueCount]     = useState(0)
  // 语料条数：素材库首屏唯一需要的语料信息 —— 页头「已攒下 N 条」的加数 + 「我的语料」入口计数，两处同一个数。
  // 首屏取 listMyCorpus() 的行数；进过 tab 后由 MyCorpusTab 经 onCorpusCountChange 回上报最新语料数
  // （删语料即回落，无需刷新）。
  // ⚠️ 2026-08-08 前这里取的是 /api/anki/summary 的 pairCount（对子数），与页头口径不同 —— 别改回去。
  // ⚠️ 首屏只要这一个数：本页曾把整份语料列表（含逐条 matchedCount / dimension）拉进来，
  //    为此每条语料要多发 2 个请求（getCorpusPointCodes + getQuestionCountByObservations），
  //    而唯一消费它们的 MyStoriesTab 早已是零引用孤儿 —— 那 2N 个请求算出的东西一个字都没显示出去。
  //    2026-08-08 连同该组件一并删除。要恢复「已匹配 N 道题」展示，见 my-corpus.test.tsx 顶部说明。
  const [corpusCount, setCorpusCount] = useState(0)

  // 题卡 Hero 数据（Anki 当季题卡入口）。⚠️ 性能：改前为「fetchAnkiCards(1,'all')+fetchAnkiCards(2,'all')
  // 拉当季全部 ~686 张卡（连 analysis 全文 ~1.3MB）到浏览器再 .length/.filter」，只为算这几个数字，慢在下载。
  // 现改调 GET /api/anki/summary —— 服务端（Zeabur香港↔Supabase新加坡内网快链）算好只回 ~200 字节：
  //   - ankiSeasonCount = 当季全部可刷卡片总数（part1+part2+part2 带的 part3 子卡，含默认卡）= 牌堆「全部」张数；
  //   - ankiDueCount    = 已答主卡里到期张数（口径同旧 scope='answered' 到期过滤，不回归）；
  //   - ankiSample      = 已答卡首题优先，否则当季首题；仅当季真 0 题才为 null；
  //   - pairCount       = 当季已绑语料且已答的对子数。⚠️ 2026-08-08 起前端不再消费该字段：
  //     「我的语料」tab 的计数口径已改为语料数（见下方 corpusCount）。端点仍返回它，未动。
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

  /** 首屏语料计数：只数 listMyCorpus() 的行数，一个请求，不再逐条派生任何东西。 */
  const fetchCorpusCount = useCallback(async (): Promise<number> => {
    const corpus = await listMyCorpus()
    return corpus.length
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
        setAnkiSample(s.sample)
      } catch (e) {
        console.warn('[LibraryPage] 获取题卡概况失败，Hero 走空态', e)
      } finally {
        setAnkiLoading(false)
      }
    })()

    // 我的语料：Supabase 异步读，用于 hub「已攒下 N 条」总计 + 语料入口卡计数（同一个数，口径必然一致）。
    // 「我的语料」tab 自持一份数据（它还要并发拉对子），此处只负责首屏这个数字。
    fetchCorpusCount()
      .then(setCorpusCount)
      .catch((e: unknown) => console.error('[LibraryPage] 加载语料计数失败', e))
  }, [fetchCorpusCount])

  const viewProps = { cards, wordsCount, pronCount, dueCount, corpusCount, onCorpusCountChange: setCorpusCount, ankiSeasonCount, ankiDueCount, ankiSample, ankiLoading }

  return (
    <>
      <div className="lg:hidden"><LibraryMobile {...viewProps} /></div>
      <div className="hidden lg:block"><LibraryDesktop {...viewProps} /></div>
    </>
  )
}
