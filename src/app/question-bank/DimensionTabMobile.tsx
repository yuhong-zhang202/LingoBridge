/**
 * @module   DimensionTabMobile
 * @desc     维度设计 Tab（移动端）— 雷达图 + 统计 + 六维度折叠面板；改版前独立移动 UI，仅移动端树使用
 * @author   LingoBridge
 * @created  2026-06-01
 */
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, CheckCircle2, Circle } from 'lucide-react'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import Chip from '@/components/Chip'
import QuotaReached from '@/components/QuotaReached'
import { countReviewPracticeThisMonth, IELTS_MONTHLY_LIMIT } from '@/lib/db/practice-sessions'
import { getAccount } from '@/lib/auth'
import type { DimensionLabel as Dimension, DimensionId, QBDimensionSummary } from '@/lib/types'
import RadarChart from './RadarChart'
import SegmentDots from './SegmentDots'

const SOFT    = '0 8px 24px -8px rgba(180,120,70,0.16), 0 2px 8px rgba(120,90,60,0.05)'
const SOFT_SM = '0 4px 16px -6px rgba(180,120,70,0.12), 0 1px 5px rgba(120,90,60,0.04)'

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
  const [open, setOpen] = useState<Dimension | null>(null)
  const [sel, setSel] = useState<Dimension>('情绪内核')   // 桌面端「按维度看题目」选中维度
  const [reviewQuotaShown, setReviewQuotaShown] = useState(false)

  /** 复练入口拦截：登录用户超过月度额度 → 弹 QuotaReached 雅思变体覆盖层 */
  async function gotoPractice(qid: string): Promise<void> {
    try {
      const acct = await getAccount()
      const loggedIn = !!acct && !acct.isAnonymous && !!acct.email
      if (loggedIn) {
        const n = await countReviewPracticeThisMonth()
        if (n >= IELTS_MONTHLY_LIMIT) { setReviewQuotaShown(true); return }
      }
    } catch { /* 静默 */ }
    router.push(`/analysis?questionId=${qid}&storyId=1&review=1`)
  }
  const dimsCov = dimensionSummaries.filter((d) => (progressById[DIM_EN[d.dimension]]?.lit ?? 0) > 0).length
  const sorted = [...dimensionSummaries].sort((a, b) => (progressById[DIM_EN[b.dimension]]?.lit ?? 0) - (progressById[DIM_EN[a.dimension]]?.lit ?? 0))

  return (
    <div>
      {/* 桌面端：雷达总览卡 + 各维度覆盖排行卡 两栏（参照 web.html dim-overview） */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start">
      {/* 概览卡 */}
      <div
        className="rounded-[16px] px-[18px] pt-[18px] pb-4"
        style={{ ...GRADIENT_BORDER_STYLE, boxShadow: SOFT, marginBottom: 18 }}
      >
        <h2 className="text-[16px] font-bold text-v2-text-primary tracking-[-0.2px]">故事版图</h2>
        <p className="text-[12px] text-v2-text-muted mt-1 mb-[15px]">点亮的面越多，能聊的题越广</p>
        <RadarChart dimensions={dimensionSummaries.map(d => ({ name: d.dimension, value: scoreById[DIM_EN[d.dimension]] ?? 0 }))} />
        <div className="border-t border-black/[0.04] mt-2 pt-3 flex items-center justify-between">
          <div className="text-center flex-1">
            <p className="text-[18px] font-semibold text-v2-text-primary">{corpusCount}</p>
            <p className="text-[10px] text-v2-text-muted">条语料</p>
          </div>
          <div className="w-px h-7 bg-black/[0.06]" />
          <div className="text-center flex-1">
            <p className="text-[18px] font-semibold text-v2-text-primary">{dimsCov}<span className="text-[11px] font-normal text-v2-text-muted"> / 6</span></p>
            <p className="text-[10px] text-v2-text-muted">维度覆盖</p>
          </div>
          <div className="w-px h-7 bg-black/[0.06]" />
          <div className="text-center flex-1">
            <p className="text-[18px] font-semibold text-v2-text-primary">{totalMatched}<span className="text-[11px] font-normal text-v2-text-muted"> / {totalMapped}</span></p>
            <p className="text-[10px] text-v2-text-muted">题目匹配</p>
          </div>
        </div>
      </div>

      {/* 各维度覆盖 · 从多到少 —— 桌面端专属右栏 */}
      <div className="hidden lg:block bg-bg-surface rounded-[16px] px-[18px] pt-[18px] pb-4" style={{ boxShadow: SOFT_SM, marginBottom: 18 }}>
        <p className="text-[13px] font-semibold text-v2-text-secondary mb-3">各维度覆盖 · 从多到少</p>
        <div className="flex flex-col gap-3">
          {sorted.map((d, idx) => {
            const id = DIM_EN[d.dimension]
            const lit = progressById[id]?.lit ?? 0
            const total = progressById[id]?.total ?? 0
            const cov = total ? lit / total : 0
            const isLeast = idx === sorted.length - 1 && lit === 0
            return (
              <div key={d.dimension} className="flex items-center gap-2.5">
                <span className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${lit > 0 ? 'bg-brand-primary' : 'bg-v2-text-muted'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-v2-text-primary">{d.dimension}</div>
                  {isLeast ? (
                    <div className="text-[11px] text-v2-text-muted mt-1">还几乎空白 · 下次从这儿讲一个故事 →</div>
                  ) : (
                    <div className="h-1.5 rounded-full bg-bg-muted mt-1.5 overflow-hidden">
                      <div className="h-full rounded-full bg-brand-primary" style={{ width: `${Math.max(4, Math.round(cov * 100))}%` }} />
                    </div>
                  )}
                </div>
                <span className="text-[12px] text-v2-text-secondary flex-shrink-0">{lit} / {total}</span>
              </div>
            )
          })}
        </div>
      </div>
      </div>

      {/* 移动端：六个维度可折叠卡（桌面端改用下面的「按维度看题目」选择器 + 面板） */}
      <div className="lg:hidden">
      {/* 分组小标题 */}
      <p
        className="text-[12px] font-semibold text-v2-text-muted tracking-[0.4px]"
        style={{ margin: '0 2px 12px' }}
      >
        六个维度
      </p>

      {/* 维度卡列表 */}
      <div className="flex flex-col gap-[11px]">
        {sorted.map(summary => {
          const dim = summary.dimension
          const dimId = DIM_EN[dim]
          const lit = progressById[dimId]?.lit ?? 0
          const total = progressById[dimId]?.total ?? 0
          const hasMatch = lit > 0
          const isOpen = open === dim

          if (!hasMatch) {
            return (
              <div
                key={dim}
                className="bg-white/[0.55] rounded-[16px] flex items-center gap-[11px] px-[15px] py-[14px]"
              >
                <div className="w-[7px] h-[7px] rounded-full bg-v2-text-muted flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-v2-text-muted">{dim}</p>
                  <p className="text-[11px] text-v2-text-muted mt-[1px]">{DIM_DESC[dim]}</p>
                </div>
                <Chip
                  variant="gradient"
                  onClick={() => router.push('/')}
                  className="text-[11px] px-3 gap-[3px] flex-shrink-0"
                >
                  讲述
                  <ChevronRight size={12} className="text-brand-primary-dark" />
                </Chip>
              </div>
            )
          }

          return (
            <div
              key={dim}
              className="bg-bg-surface rounded-[16px] overflow-hidden"
              style={{ boxShadow: SOFT_SM }}
            >
              <button
                className="w-full flex items-center gap-[11px] px-[15px] py-[14px]"
                onClick={() => setOpen(isOpen ? null : dim)}
              >
                <div className="w-[7px] h-[7px] rounded-full bg-brand-primary flex-shrink-0" />
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-[14px] font-semibold text-v2-text-primary">{dim}</p>
                  <p className="text-[11px] text-v2-text-muted mt-[1px]">{DIM_DESC[dim]}</p>
                </div>
                <span className="text-[12px] font-semibold text-v2-text-secondary">{lit}/{total}</span>
                <ChevronDown size={14} className={`text-v2-text-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
              </button>

              <div style={{ padding: '0 15px 13px 41px' }}>
                <SegmentDots total={12} filled={Math.max(1, Math.round((lit / total) * 12))} />
              </div>

              {isOpen && [...summary.questions]
                .sort((a, b) => Number(b.matched) - Number(a.matched))
                .map(q => (
                  <div key={q.id} className="flex items-center gap-2.5 px-4 py-2.5 border-t border-black/[0.04]">
                    {q.matched
                      ? <CheckCircle2 size={14} className="text-brand-accent flex-shrink-0" />
                      : <Circle size={14} className="text-v2-text-muted flex-shrink-0" />}
                    <p className={`flex-1 text-[12px] leading-snug ${q.matched ? 'text-v2-text-primary' : 'text-v2-text-muted'}`}>{q.displayText}</p>
                    {q.matched && (
                      <Chip
                        variant="gradient"
                        size="sm"
                        onClick={() => void gotoPractice(q.id)}
                        className="font-medium flex-shrink-0"
                      >
                        练习
                      </Chip>
                    )}
                  </div>
                ))}
            </div>
          )
        })}
      </div>
      </div>

      {/* 桌面端：按维度看题目 —— chip 选择器 + 单维度题目面板（参照 web.html DimTab 下半部） */}
      <div className="hidden lg:block">
        <p className="text-[13px] font-semibold text-v2-text-secondary mb-3">按维度看题目</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {dimensionSummaries.map(s => (
            <Chip key={s.dimension} variant="ghost" active={sel === s.dimension} onClick={() => setSel(s.dimension)}>
              {s.dimension}
            </Chip>
          ))}
        </div>
        {(() => {
          const sum = dimensionSummaries.find(s => s.dimension === sel) ?? dimensionSummaries[0]
          if (!sum) return null
          const id = DIM_EN[sum.dimension]
          const lit = progressById[id]?.lit ?? 0
          const total = progressById[id]?.total ?? 0
          const done = sum.questions.filter(q => q.matched)
          const todo = sum.questions.filter(q => !q.matched)
          const remain = Math.max(0, total - lit)
          const segFilled = Math.max(lit > 0 ? 1 : 0, Math.round(12 * (total ? lit / total : 0)))
          return (
            <div className="bg-bg-surface rounded-[16px] px-[22px] pt-[18px] pb-2" style={{ boxShadow: SOFT_SM }}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-[16px] font-bold text-v2-text-primary">{sum.dimension}</div>
                  <div className="text-[12px] text-v2-text-muted mt-1">{DIM_DESC[sum.dimension]}</div>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <div className="text-[11px] text-v2-text-muted">已收集</div>
                  <div className="text-[16px] font-semibold text-v2-text-primary">{lit} / {total}</div>
                  <div className="mt-1.5"><SegmentDots total={12} filled={segFilled} /></div>
                </div>
              </div>
              {done.map(q => (
                <div key={q.id} className="flex items-center gap-2.5 py-2.5 border-t border-black/[0.04]">
                  <CheckCircle2 size={16} className="text-brand-accent flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-v2-text-primary leading-snug">{q.displayText}</div>
                    {q.displayTextZh && <div className="text-[11px] text-v2-text-muted mt-0.5">{q.displayTextZh}</div>}
                  </div>
                  <Chip variant="gradient" size="sm" onClick={() => void gotoPractice(q.id)} className="font-medium flex-shrink-0">练习</Chip>
                </div>
              ))}
              {todo.map(q => (
                <div key={q.id} className="flex items-center gap-2.5 py-2.5 border-t border-black/[0.04]">
                  <Circle size={16} className="text-v2-text-muted flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-v2-text-muted leading-snug">{q.displayText}</div>
                    {q.displayTextZh && <div className="text-[11px] text-v2-text-muted mt-0.5">{q.displayTextZh}</div>}
                  </div>
                  <span className="text-[12px] text-v2-text-muted flex-shrink-0">还没讲到</span>
                </div>
              ))}
              <div className="text-[12px] text-v2-text-muted text-center pt-3 pb-1.5 border-t border-black/[0.04]">
                还有 <b className="text-v2-text-secondary">{remain}</b> 道 · 讲更多故事来点亮 →
              </div>
            </div>
          )
        })()}
      </div>

      {reviewQuotaShown && (
        <QuotaReached variant="ielts" asOverlay onClose={() => setReviewQuotaShown(false)} />
      )}
    </div>
  )
}
