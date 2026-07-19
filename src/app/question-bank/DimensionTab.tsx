/**
 * @module   DimensionTab
 * @desc     维度设计 Tab — 故事版图密面板（放大雷达 + 六维度 2 列卡片选择器 + 底部统计细条）
 *           + 整行「选中维度详情」（题目 2 列）。对齐 questionbank v3；数据由 useQuestionBank 传入。
 * @author   LingoBridge
 * @created  2026-06-01
 */
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Radar, CheckCircle2, Circle, ChevronRight } from 'lucide-react'
import Card from '@/components/Card'
import Chip from '@/components/Chip'
import QuotaReached from '@/components/QuotaReached'
import { countReviewPracticeThisMonth, IELTS_MONTHLY_LIMIT } from '@/lib/db/practice-sessions'
import { listCorpusByQuestion } from '@/lib/db/matches'
import { getAccount } from '@/lib/auth'
import type { DimensionLabel as Dimension, DimensionId, QBDimensionSummary } from '@/lib/types'
import RadarChart from './RadarChart'
import SegmentDots from './SegmentDots'

const DIM_EN: Record<Dimension, DimensionId> = {
  '情绪内核': 'emotion', '人际羁绊': 'relationship', '空间感知': 'space',
  '精神栖所': 'spirit', '成长演进': 'growth', '价值底色': 'value',
}

const DIM_DESC: Record<Dimension, string> = {
  '情绪内核': '如何与自己相处',
  '人际羁绊': '与他人的联结',
  '成长演进': '你如何蜕变',
  '空间感知': '与空间、远行的关系',
  '精神栖所': '书影音与心头之物',
  '价值底色': '你看重什么',
}

interface Props {
  scoreById: Partial<Record<DimensionId, number>>
  progressById: Partial<Record<DimensionId, { lit: number; total: number }>>
  corpusCount: number
  dimensionSummaries: QBDimensionSummary[]
  totalMapped: number
  totalMatched: number
}

export default function DimensionTab({ scoreById, progressById, corpusCount, dimensionSummaries, totalMapped, totalMatched }: Props) {
  const router = useRouter()
  const [sel, setSel] = useState<Dimension | null>(null)
  const [reviewQuotaShown, setReviewQuotaShown] = useState(false)

  /**
   * 复练入口：先拦月度额度（登录用户超额 → 弹 QuotaReached 雅思变体覆盖层），
   * 再带上该题匹配度最高的一条本人语料跳分析页。
   * storyId 必须是真实 corpus UUID —— 曾硬编码 "1"，服务端 assertCorpusOwner 一律 403，
   * 分析页收到 403 会 router.push('/') 弹回首页，用户看到的是首页的额度提示，误以为雅思额度满了。
   * 取不到语料（理论上 matched=true 必有，防御性兜底）就不带 storyId，走通用分析而非再撞 403。
   */
  async function gotoPractice(qid: string): Promise<void> {
    let storyId: string | null = null
    try {
      const acct = await getAccount()
      const loggedIn = !!acct && !acct.isAnonymous && !!acct.email
      if (loggedIn) {
        const n = await countReviewPracticeThisMonth()
        if (n >= IELTS_MONTHLY_LIMIT) { setReviewQuotaShown(true); return }
      }
      // listCorpusByQuestion 已按 high→mid→low 排序、同档新→旧，取首条即最贴合的语料
      storyId = (await listCorpusByQuestion(qid))[0]?.id ?? null
    } catch { /* 静默：取不到语料就走通用分析 */ }
    const story = storyId ? `&storyId=${encodeURIComponent(storyId)}` : ''
    router.push(`/analysis?questionId=${encodeURIComponent(qid)}${story}&review=1`)
  }

  const dimsCov = dimensionSummaries.filter((d) => (progressById[DIM_EN[d.dimension]]?.lit ?? 0) > 0).length
  // 覆盖从多到少：既是雷达右侧网格的排序，也决定默认选中（最有内容的维度）
  const sorted = [...dimensionSummaries].sort((a, b) => (progressById[DIM_EN[b.dimension]]?.lit ?? 0) - (progressById[DIM_EN[a.dimension]]?.lit ?? 0))
  const selDim: Dimension | undefined = sel ?? sorted[0]?.dimension ?? dimensionSummaries[0]?.dimension
  const detail = dimensionSummaries.find((s) => s.dimension === selDim)

  return (
    <div>
      {/* 故事版图：雷达(放大) + 六维度(2 列卡片选择器) + 底部统计细条 */}
      <Card variant="gradient" className="px-[22px] py-5 mb-5">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-brand-primary inline-flex"><Radar size={18} /></span>
          <h2 className="text-[16px] font-bold tracking-[-0.2px] text-v2-text-primary">故事版图</h2>
        </div>
        <p className="text-[12px] text-v2-text-muted mb-4">点亮的面越多，能聊的题越广</p>

        <div className="flex flex-col lg:flex-row gap-5 lg:gap-[26px] lg:items-stretch">
          <div className="flex items-center justify-center flex-shrink-0 py-1">
            <RadarChart size={280} dimensions={dimensionSummaries.map(d => ({ name: d.dimension, value: scoreById[DIM_EN[d.dimension]] ?? 0 }))} />
          </div>

          <div className="hidden lg:block w-px self-stretch bg-black/[0.06] my-1" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-1 content-center">
            {sorted.map((d, idx) => {
              const dim = d.dimension
              const lit = progressById[DIM_EN[dim]]?.lit ?? 0
              const total = progressById[DIM_EN[dim]]?.total ?? 0
              const cov = total ? lit / total : 0
              const isLeast = idx === sorted.length - 1 && lit === 0
              const selected = dim === selDim
              return (
                /* stretched-button：覆盖按钮承担「选中维度」，「讲述」Chip 为其兄弟节点而非后代，
                   避免交互元素嵌套（WCAG 4.1.2）。内容层 pointer-events-none 让点击穿透到覆盖按钮。 */
                <div
                  key={dim}
                  className={`relative text-left rounded-[11px] px-[14px] py-[13px] min-h-[84px] border transition-colors ${selected ? 'bg-bg-muted border-transparent' : 'bg-bg-surface border-black/[0.05] hover:bg-bg-muted'}`}
                >
                  <button
                    type="button"
                    onClick={() => setSel(dim)}
                    aria-pressed={selected}
                    aria-label={`查看${dim}详情`}
                    className="absolute inset-0 rounded-[11px] cursor-pointer"
                  />
                  <div className="relative z-10 pointer-events-none">
                    <div className="flex items-center gap-[9px]">
                      <span className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${lit > 0 ? 'bg-brand-primary' : 'bg-v2-text-muted'}`} />
                      <span className={`flex-1 text-[14px] font-semibold ${lit > 0 ? 'text-v2-text-primary' : 'text-v2-text-secondary'}`}>{dim}</span>
                      <span className="text-[12px] font-medium text-v2-text-secondary">{lit} / {total}</span>
                    </div>
                    <div className="pl-4 mt-[3px]">
                      {isLeast ? (
                        <p className="text-[11px] text-v2-text-muted leading-[1.4]">还几乎空白 · 下次从这儿讲一个故事 →</p>
                      ) : (
                        <p className="text-[11.5px] text-v2-text-muted">{DIM_DESC[dim]}</p>
                      )}
                      {lit > 0 ? (
                        <div className="h-[5px] rounded-[3px] bg-bg-muted mt-[9px] overflow-hidden">
                          <div className="h-full rounded-[3px] bg-brand-primary" style={{ width: `${Math.max(4, Math.round(cov * 100))}%` }} />
                        </div>
                      ) : (
                        <Chip
                          variant="gradient"
                          size="sm"
                          onClick={() => router.push('/')}
                          className="mt-2.5 gap-[3px] font-medium pointer-events-auto"
                        >
                          讲述
                          <ChevronRight size={12} className="text-brand-primary-dark" />
                        </Chip>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex items-center border-t border-black/[0.05] mt-[18px] pt-[14px]">
          <div className="flex-1 text-center">
            <div className="text-[19px] font-bold text-v2-text-primary">{corpusCount}</div>
            <div className="text-[11px] text-v2-text-muted mt-0.5">条语料</div>
          </div>
          <div className="w-px h-[30px] bg-black/[0.06]" />
          <div className="flex-1 text-center">
            <div className="text-[19px] font-bold text-v2-text-primary">{dimsCov}<small className="text-[11px] font-normal text-v2-text-muted"> / 6</small></div>
            <div className="text-[11px] text-v2-text-muted mt-0.5">维度覆盖</div>
          </div>
          <div className="w-px h-[30px] bg-black/[0.06]" />
          <div className="flex-1 text-center">
            <div className="text-[19px] font-bold text-v2-text-primary">{totalMatched}<small className="text-[11px] font-normal text-v2-text-muted"> / {totalMapped}</small></div>
            <div className="text-[11px] text-v2-text-muted mt-0.5">题目匹配</div>
          </div>
        </div>
      </Card>

      {/* 选中维度详情：整行，题目 2 列 */}
      {detail && (() => {
        const lit = progressById[DIM_EN[detail.dimension]]?.lit ?? 0
        const total = progressById[DIM_EN[detail.dimension]]?.total ?? 0
        const done = detail.questions.filter(q => q.matched)
        const todo = detail.questions.filter(q => !q.matched)
        const remain = Math.max(0, total - lit)
        const segFilled = Math.max(lit > 0 ? 1 : 0, Math.round(12 * (total ? lit / total : 0)))
        // 题目少时右列会空一半：≤2 道用单列，卡片高度自然收紧
        const oneColumn = done.length + todo.length <= 2
        return (
          <Card className="px-[22px] py-5 mb-14">
            <div className="flex items-start justify-between mb-1.5">
              <div>
                <div className="text-[17px] font-bold text-v2-text-primary">{detail.dimension}</div>
                <div className="text-[12.5px] text-v2-text-muted mt-[3px]">{DIM_DESC[detail.dimension]}</div>
              </div>
              <div className="text-right flex-shrink-0 ml-4">
                <div className="text-[11px] text-v2-text-muted">已收集</div>
                <div className="text-[16px] font-semibold text-v2-text-primary">{lit} / {total}</div>
                <div className="mt-2 flex justify-end"><SegmentDots total={12} filled={segFilled} /></div>
              </div>
            </div>

            <div className={`grid grid-cols-1 gap-x-[30px] mt-1 ${oneColumn ? 'lg:grid-cols-1' : 'lg:grid-cols-2'}`}>
              {done.map(q => (
                <div key={q.id} className="flex items-center gap-[11px] py-[11px] border-t border-black/[0.05]">
                  <CheckCircle2 size={16} className="text-brand-accent flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] text-v2-text-primary leading-[1.35]">{q.displayText}</div>
                    <div className="text-[11.5px] text-v2-text-muted mt-0.5">{[q.displayTextZh, `Part ${q.part}`].filter(Boolean).join(' · ')}</div>
                  </div>
                  <Chip variant="gradient" size="sm" onClick={() => void gotoPractice(q.id)} className="font-medium flex-shrink-0">练习</Chip>
                </div>
              ))}
              {todo.map(q => (
                <div key={q.id} className="flex items-center gap-[11px] py-[11px] border-t border-black/[0.05]">
                  <Circle size={16} className="text-v2-text-muted flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] text-v2-text-muted leading-[1.35]">{q.displayText}</div>
                    <div className="text-[11.5px] text-v2-text-muted mt-0.5">{[q.displayTextZh, `Part ${q.part}`].filter(Boolean).join(' · ')}</div>
                  </div>
                  <Chip variant="gradient" size="sm" onClick={() => router.push('/')} className="font-medium flex-shrink-0">
                    讲述
                  </Chip>
                </div>
              ))}
            </div>

            <div className="text-[12px] text-v2-text-muted text-center pt-[14px] pb-0.5 mt-1.5 border-t border-black/[0.05]">
              还有 <b className="text-v2-text-secondary font-semibold">{remain}</b> 道 · 讲更多故事来点亮 →
            </div>
          </Card>
        )
      })()}

      {reviewQuotaShown && (
        <QuotaReached variant="ielts" asOverlay onClose={() => setReviewQuotaShown(false)} />
      )}
    </div>
  )
}
