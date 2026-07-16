/**
 * @module   MatchingDesktop
 * @desc     题目匹配页桌面视图（master 档 master-detail）—— FlowShellDesktop 沉浸外壳内：
 *           顶部横跨两栏的定调开场（匹配计数 + 识别维度 + 副维度降级说明），下方左「题目列表」（Part 筛选 +
 *           高/中/低三组全量、列表内部滚动）+ 右「选中题详情」（随 selectedId 实时刷新，含匹配原因）。
 *           noMatch 时不套两栏、focus 档居中复用 NoMatchView。桌面独有：↑↓ 切题 / Enter·→ 分析 / Esc 退出、
 *           行 hover 高亮、右栏 CTA 浮起。逻辑由 page.tsx 外壳经 props 下发。
 * @author   LingoBridge
 * @created  2026-07-09
 */
'use client'
import { useEffect, useRef } from 'react'
import Card from '@/components/Card'
import Chip from '@/components/Chip'
import Tag from '@/components/Tag'
import PartTag from '@/components/PartTag'
import Skeleton from '@/components/Skeleton'
import EmptyState from '@/components/EmptyState'
import OfflineState from '@/components/OfflineState'
import GradientButton from '@/components/GradientButton'
import NoMatchView from '@/components/matching/NoMatchView'
import { SCORE_HIGH, SCORE_MID, BRAND_GRADIENT_VERTICAL } from '@/lib/constants'
import type { MatchingViewProps, FunnelQuestion } from './types'

/** 舞台最小高度：满屏减去外壳 72px 顶栏 */
const STAGE = 'min-h-[calc(100vh-72px)]'

/** 选中行左侧竖条渐变：全站复用的品牌竖向渐变 */
const SELECTED_BAR = BRAND_GRADIENT_VERTICAL

type Tier = 'high' | 'mid' | 'low'
function tierOf(score?: number): Tier {
  const s = score ?? 100
  if (s >= SCORE_HIGH) return 'high'
  if (s >= SCORE_MID) return 'mid'
  return 'low'
}

/** 分组标题行：label + 横线（沿用移动端 GroupHeader 高/中/低样式） */
function GroupHeader({ label, count, variant }: { label: string; count: number; variant: Tier }) {
  const textClass =
    variant === 'high' ? 'text-brand-accent font-semibold'
    : variant === 'mid' ? 'text-v2-text-secondary font-medium'
    : 'text-v2-text-muted font-medium'
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={`text-[11px] ${textClass}`}>{label} · {count} 道</span>
      <div className="flex-1 h-px bg-black/[0.05]" />
    </div>
  )
}

/** 匹配档位徽标 */
function TierBadge({ tier }: { tier: Tier }) {
  const map = {
    high: { label: '高匹配', cls: 'text-brand-accent bg-brand-accent/10 border-brand-accent/25' },
    mid:  { label: '中匹配', cls: 'text-v2-text-secondary bg-black/[0.04] border-black/[0.08]' },
    low:  { label: '低匹配', cls: 'text-v2-text-muted bg-black/[0.03] border-black/[0.06]' },
  }[tier]
  return <span className={`text-[11px] font-medium px-[9px] py-[3px] rounded-full border ${map.cls}`}>{map.label}</span>
}

/** 左栏紧凑可点题目行 —— 视觉 DNA 对齐 MatchedQuestionCard，但行内不放 CTA（CTA 归右栏） */
function QuestionRow({ q, isHigh, selected, onSelect }: {
  q: FunnelQuestion; isHigh: boolean; selected: boolean; onSelect: () => void
}) {
  const enText = q.part === 2 ? (q.cue_card_title ?? q.question_text) : q.question_text
  const zhText = q.part === 2 ? (q.cue_card_title_zh ?? '') : (q.question_text_zh ?? '')
  const needSwitch = !q.isPrimaryMatch && !isHigh
  return (
    <button
      onClick={onSelect}
      data-qid={q.id}
      aria-pressed={selected}
      className={`group w-full text-left bg-white rounded-[14px] overflow-hidden flex border border-black/[0.05] transition-[box-shadow,transform] duration-200 ${
        selected
          ? 'shadow-[0_2px_16px_rgba(212,135,90,0.12)]'
          : 'shadow-[0_1px_8px_rgba(0,0,0,0.06)] hover:shadow-[0_2px_14px_rgba(0,0,0,0.09)] hover:-translate-y-[1px]'
      }`}
    >
      {/* 左侧竖条：选中显示渐变，未选中 hover 时透出淡暖橙 */}
      <div className="w-[4px] flex-shrink-0 self-stretch">
        {selected
          ? <div className="w-full h-full" style={{ background: SELECTED_BAR }} />
          : <div className="w-full h-full bg-transparent group-hover:bg-brand-primary/25 transition-colors" />}
      </div>
      <div className="flex-1 p-3.5 min-w-0">
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <PartTag label={`Part ${q.part}`} />
          <Tag variant="green" label={q.dimension} />
          {q.is_new && <Tag variant="green" label="新题" />}
          {needSwitch && (
            <span className="text-[10px] font-medium px-[8px] py-[3px] rounded-full text-brand-primary-dark bg-brand-primary/10 border border-brand-primary/30">
              需切换角度
            </span>
          )}
        </div>
        <p className="text-[14px] font-bold text-v2-text-primary leading-snug truncate">{enText}</p>
        {zhText && <p className="text-[12px] text-v2-text-muted mt-0.5 truncate">{zhText}</p>}
      </div>
    </button>
  )
}

/** 右栏选中题详情 */
function DetailPane({ q, onPractice }: { q: FunnelQuestion | null; onPractice: (id: string) => void }) {
  if (!q) {
    return (
      <Card className="flex items-center justify-center px-8 py-16 text-center">
        <p className="text-[13px] text-v2-text-muted">从左侧选择一道题查看详情</p>
      </Card>
    )
  }
  const enText = q.part === 2 ? (q.cue_card_title ?? q.question_text) : q.question_text
  const zhText = q.part === 2 ? (q.cue_card_title_zh ?? '') : (q.question_text_zh ?? '')
  const tier = tierOf(q.relevanceScore)
  // matched_point 可能是观察点 code（如 EMO_04）——含小写/中文才当可读名展示，否则只留维度，不露 code
  const obs = /[a-z一-鿿]/.test(q.matched_point) ? q.matched_point : null
  return (
    // 详情=内容高的阅读卡（在 flex-col 右栏内自然取内容高、不被拉满、消除空洞）；长文案才封顶 max-h 卡内滚动、CTA 常驻
    <Card className="max-h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <PartTag label={`Part ${q.part}`} />
          <Tag variant="green" label={q.dimension} />
          {q.is_new && <Tag variant="green" label="新题" />}
          <span className="ml-auto"><TierBadge tier={tier} /></span>
        </div>
        <p className="text-[20px] font-bold text-v2-text-primary leading-snug mb-1.5">{enText}</p>
        {zhText && <p className="text-[14px] text-v2-text-muted mb-6">{zhText}</p>}

        <div className="border-t border-black/[0.05] pt-5">
          <p className="text-[11px] font-semibold tracking-[0.04em] text-v2-text-muted mb-1.5">识别维度{obs ? ' · 观察点' : ''}</p>
          <p className="text-[14px] text-v2-text-secondary leading-relaxed">{q.dimension}{obs ? ` · ${obs}` : ''}</p>
        </div>

        {q.relevanceReason && (
          <div className="mt-5 border-t border-black/[0.05] pt-5">
            <p className="text-[11px] font-semibold tracking-[0.04em] text-v2-text-muted mb-1.5">为什么这道题适合你</p>
            <p className="text-[14px] text-v2-text-secondary leading-relaxed">{q.relevanceReason}</p>
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-black/[0.05] px-7 py-5 flex justify-end">
        <GradientButton
          onClick={() => onPractice(q.id)}
          className="flex items-center gap-1.5 px-7 py-3 rounded-full text-[15px] font-medium transition-[transform,box-shadow] duration-200 hover:-translate-y-[2px] hover:shadow-[0_8px_22px_rgba(0,0,0,0.09)]"
        >
          题目分析 →
        </GradientButton>
      </div>
    </Card>
  )
}

export default function MatchingDesktop({
  result, loading, error, totalVisible, availableTabs, activeTab, filtered,
  highGroup, midGroup, lowGroup, noneVisible, globalNoneVisible, selectedId,
  onSelectTab, onSelect, onPractice, onRetry, onExit,
}: MatchingViewProps & { globalNoneVisible: boolean }) {

  const hasList = !loading && !error && !!result && !result.noMatch && !globalNoneVisible
  // 有序可导航列表：高→中→低（与左栏展示顺序一致）
  const ordered = [...highGroup, ...midGroup, ...lowGroup]
  const selected = result ? (result.questions.find(q => q.id === selectedId) ?? null) : null

  // 筛选联动：切 Part 后若选中题不在筛选结果里，自动选中第一题，右栏不空。
  // 仅桌面断点生效——两视图同时挂载，matchMedia 守卫避免在移动端改写共享 selectedId。
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia('(min-width: 1024px)').matches) return
    if (!result || result.noMatch || globalNoneVisible || filtered.length === 0) return
    if (!filtered.some(q => q.id === selectedId)) onSelect(filtered[0].id)
  }, [filtered, selectedId, result, globalNoneVisible, onSelect])

  // 键盘：↑↓ 切题、Enter/→ 进入分析、Esc 退出（仅桌面断点、有列表时才挂）
  const latest = useRef({ ordered, selectedId, onSelect, onPractice, onExit })
  latest.current = { ordered, selectedId, onSelect, onPractice, onExit }
  useEffect(() => {
    if (!hasList) return
    const onKey = (e: KeyboardEvent) => {
      if (!window.matchMedia('(min-width: 1024px)').matches) return
      const t = e.target as HTMLElement | null
      const { ordered, selectedId, onSelect, onPractice, onExit } = latest.current
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // 方向键无原生按钮动作，始终用于列表切题（即使焦点在筛选 Chip/行上）
        e.preventDefault()
        if (ordered.length === 0) return
        const idx = ordered.findIndex(q => q.id === selectedId)
        const nextIdx = e.key === 'ArrowDown'
          ? Math.min(ordered.length - 1, idx < 0 ? 0 : idx + 1)
          : Math.max(0, idx < 0 ? 0 : idx - 1)
        const nextId = ordered[nextIdx].id
        onSelect(nextId)
        // 选中项滚进可视区（列表内部滚动容器）；减弱动效时用瞬时滚动
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        document.querySelector(`[data-qid="${nextId}"]`)?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
      } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
        // Enter 交还给聚焦的原生控件（筛选 Chip / 列表行 / 按钮）自行激活；→ 无原生动作，照常进入分析
        if (e.key === 'Enter' && t?.closest('button, a, [role="button"]')) return
        if (selectedId) { e.preventDefault(); onPractice(selectedId) }
      } else if (e.key === 'Escape') {
        onExit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasList])

  if (loading) {
    return (
      <div className={`${STAGE} flex flex-col items-center px-8 py-8`} aria-busy="true">
        <div className="w-full max-w-[1040px]" aria-hidden="true">
          <Skeleton className="w-2/5 h-[24px]" />
          <Skeleton className="w-1/3 h-3 mt-3" />
          <div className="flex gap-6 mt-8">
            <div className="w-[360px] shrink-0 flex flex-col gap-2.5">
              <div className="flex gap-2 mb-2">
                <Skeleton className="w-12 h-[26px] rounded-full" />
                <Skeleton className="w-16 h-[26px] rounded-full" />
              </div>
              {[0, 1, 2, 3].map(i => (
                <Skeleton key={i} className="w-full h-[86px] rounded-[14px]" />
              ))}
            </div>
            <Skeleton className="flex-1 h-[420px] rounded-[16px]" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`${STAGE} flex items-center justify-center px-8`}>
        {typeof navigator !== 'undefined' && !navigator.onLine ? (
          <OfflineState onRetry={onRetry} />
        ) : (
          <EmptyState
            title="题目没匹配出来"
            subtitle="刚才好像没连上，点下面再试一次就好。"
            ctaLabel="重试"
            onCta={onRetry}
            orbSize={100}
          />
        )}
      </div>
    )
  }

  if (!result) return <div className={STAGE} />

  // noMatch（真没题）与 globalNoneVisible（有题但全部低分被隐藏）统一：不套 master-detail，居中复用 NoMatchView
  if (result.noMatch || globalNoneVisible) {
    return (
      <div className={`${STAGE} flex items-center justify-center px-8`}>
        <div className="w-full max-w-[600px]">
          <NoMatchView
            primaryDimension={result.primary?.dimension ?? ''}
            primaryPointName={result.primary?.pointName ?? ''}
            variant={result.noMatch ? 'noMatch' : 'lowScore'}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-72px)] flex flex-col items-center px-8 py-8 overflow-hidden">
      <div className="w-full max-w-[1040px] flex-1 min-h-0 flex flex-col">

        {/* 顶部定调开场（横跨两栏） */}
        <div className="shrink-0 mb-5">
          <h2 className="text-[22px] font-bold text-v2-text-primary">匹配到 {totalVisible} 道当季真题</h2>
          {result.primary && (
            <p className="text-[13px] text-v2-text-muted mt-1">
              识别维度：{result.primary.dimension} · {result.primary.pointName}
              {result.secondary && ` ／ ${result.secondary.dimension} · ${result.secondary.pointName}`}
            </p>
          )}
          {result.matchedViaSecondary && result.secondary && (
            <Card className="px-4 py-3 mt-3">
              <p className="text-[13px] text-v2-text-primary leading-snug mb-1">暂时没匹配到完全契合的雅思真题</p>
              <p className="text-[12px] text-v2-text-secondary leading-relaxed">
                不过把重点放在{' '}
                <span className="text-brand-primary-dark font-medium">
                  {result.secondary.dimension} · {result.secondary.pointName}
                </span>
                {' '}这个方向上，这些题目同样值得练
              </p>
            </Card>
          )}
        </div>

        {/* 两栏 master-detail：左列表 + 右详情，各自内部滚动 */}
        <div className="flex-1 min-h-0 flex gap-6">

          {/* 左·题目列表 */}
          <div className="w-[360px] shrink-0 flex flex-col min-h-0">
            <div className="flex gap-2 flex-wrap mb-4 shrink-0">
              {availableTabs.map((p) => (
                <Chip key={p} onClick={() => onSelectTab(p)} variant="ghost" active={activeTab === p}>
                  {p}
                </Chip>
              ))}
            </div>
            {/* 列表多时在左栏内部滚动，不撑高页面 */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-1.5 flex flex-col gap-5">
              {highGroup.length > 0 && (
                <div>
                  <GroupHeader label="高匹配" count={highGroup.length} variant="high" />
                  <div className="flex flex-col gap-2.5">
                    {highGroup.map((q) => (
                      <QuestionRow key={q.id} q={q} isHigh selected={selectedId === q.id} onSelect={() => onSelect(q.id)} />
                    ))}
                  </div>
                </div>
              )}
              {midGroup.length > 0 && (
                <div>
                  <GroupHeader label="中匹配" count={midGroup.length} variant="mid" />
                  <div className="flex flex-col gap-2.5">
                    {midGroup.map((q) => (
                      <QuestionRow key={q.id} q={q} isHigh={false} selected={selectedId === q.id} onSelect={() => onSelect(q.id)} />
                    ))}
                  </div>
                </div>
              )}
              {lowGroup.length > 0 && (
                <div>
                  <GroupHeader label="低匹配" count={lowGroup.length} variant="low" />
                  <div className="flex flex-col gap-2.5">
                    {lowGroup.map((q) => (
                      <QuestionRow key={q.id} q={q} isHigh={false} selected={selectedId === q.id} onSelect={() => onSelect(q.id)} />
                    ))}
                  </div>
                </div>
              )}
              {noneVisible && (
                <div className="text-center text-[13px] text-v2-text-muted py-10">该 Part 暂无匹配题目</div>
              )}
            </div>
          </div>

          {/* 右·选中题详情（随 selectedId 实时刷新，内容高、纵向居中于列表高度） */}
          <div className="flex-1 min-h-0 flex flex-col justify-center">
            <DetailPane q={selected} onPractice={onPractice} />
          </div>
        </div>

        {/* 极简键盘提示 */}
        <p className="shrink-0 mt-4 text-center text-[12px] text-v2-text-muted">↑↓ 切题 · Enter 分析 · Esc 退出</p>
      </div>
    </div>
  )
}
