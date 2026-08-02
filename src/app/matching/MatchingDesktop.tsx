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
import LowMatchView from '@/components/matching/LowMatchView'
import MatchingProgress from '@/components/matching/MatchingProgress'
import AnkiBookmarkButton, { type AnkiSaveState } from '@/components/anki/AnkiBookmarkButton'
import { SCORE_HIGH, BRAND_GRADIENT_VERTICAL } from '@/lib/constants'
import type { MatchingViewProps, FunnelQuestion } from './types'

/** 舞台最小高度：满屏减去外壳 72px 顶栏 */
const STAGE = 'min-h-[calc(100vh-72px)]'

/** 选中行左侧竖条渐变：全站复用的品牌竖向渐变 */
const SELECTED_BAR = BRAND_GRADIENT_VERTICAL

/**
 * 档位（只有两档：< SCORE_MID 的候选根本不会进 ordered，见 page.tsx 分组）。
 * 不用 `score ?? 100` 兜底：未打分的候选在 page.tsx 就被滤掉了，这里再给个默认分
 * 等于把「我们不知道它贴不贴合」当成 100 分——正是产品不变式 2 要根除的那个模式。
 * 真的收到 undefined 说明上游分组坏了，按 mid 保守处理并留证，不静默假装它是高匹配。
 */
type Tier = 'high' | 'mid'
function tierOf(score?: number): Tier {
  if (score === undefined) {
    console.error('[MatchingDesktop] 收到未打分候选，上游分组应已滤除', { score })
    return 'mid'
  }
  return score >= SCORE_HIGH ? 'high' : 'mid'
}

/** 分组标题行：label + 横线（沿用移动端 GroupHeader 高/中样式） */
function GroupHeader({ label, count, variant }: { label: string; count: number; variant: Tier }) {
  const textClass =
    variant === 'high' ? 'text-brand-accent font-semibold'
    : variant === 'mid' ? 'text-v2-text-secondary font-medium'
    : 'text-v2-text-muted font-medium'
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={`text-[0.6875rem] ${textClass}`}>{label} · {count} 道</span>
      <div className="flex-1 h-px bg-black/[0.05]" />
    </div>
  )
}

/** 匹配档位徽标 */
function TierBadge({ tier }: { tier: Tier }) {
  const map = {
    high: { label: '高匹配', cls: 'text-brand-accent bg-brand-accent/10 border-brand-accent/25' },
    mid:  { label: '中匹配', cls: 'text-v2-text-secondary bg-black/[0.04] border-black/[0.08]' },
  }[tier]
  return <span className={`text-[0.6875rem] font-medium px-[9px] py-[3px] rounded-full border ${map.cls}`}>{map.label}</span>
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
            <span className="text-[0.625rem] font-medium px-[8px] py-[3px] rounded-full text-brand-primary-dark bg-brand-primary/10 border border-brand-primary/30">
              需切换角度
            </span>
          )}
        </div>
        <p className="text-[0.875rem] font-bold text-v2-text-primary leading-snug truncate">{enText}</p>
        {zhText && <p className="text-[0.75rem] text-v2-text-muted mt-0.5 truncate">{zhText}</p>}
      </div>
    </button>
  )
}

/** 右栏选中题详情 */
function DetailPane({ q, onPractice, saveState, onSave }: {
  q: FunnelQuestion | null
  onPractice: (id: string) => void
  saveState: AnkiSaveState
  onSave: () => void
}) {
  if (!q) {
    return (
      <Card className="flex items-center justify-center px-8 py-16 text-center">
        <p className="text-[0.8125rem] text-v2-text-muted">从左侧选择一道题查看详情</p>
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
          <span className="ml-auto flex items-center gap-1.5">
            <TierBadge tier={tier} />
            {/* 存对子书签（TierBadge 行最右）：已存显「已存题卡」绿 Tag，未存/存中显 40×40 图标按钮 */}
            <AnkiBookmarkButton state={saveState} onSave={onSave} savedTag />
          </span>
        </div>
        <p className="text-[1.25rem] font-bold text-v2-text-primary leading-snug mb-1.5">{enText}</p>
        {zhText && <p className="text-[0.875rem] text-v2-text-muted mb-6">{zhText}</p>}

        <div className="border-t border-black/[0.05] pt-5">
          <p className="text-[0.6875rem] font-semibold tracking-[0.04em] text-v2-text-muted mb-1.5">识别维度{obs ? ' · 观察点' : ''}</p>
          <p className="text-[0.875rem] text-v2-text-secondary leading-relaxed">{q.dimension}{obs ? ` · ${obs}` : ''}</p>
        </div>

        {q.relevanceReason && (
          <div className="mt-5 border-t border-black/[0.05] pt-5">
            <p className="text-[0.6875rem] font-semibold tracking-[0.04em] text-v2-text-muted mb-1.5">为什么这道题适合你</p>
            <p className="text-[0.875rem] text-v2-text-secondary leading-relaxed">{q.relevanceReason}</p>
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-black/[0.05] px-7 py-5 flex justify-end">
        <GradientButton
          onClick={() => onPractice(q.id)}
          className="flex items-center gap-1.5 px-7 py-3 rounded-full text-[0.9375rem] font-medium transition-[transform,box-shadow] duration-200 hover:-translate-y-[2px] hover:shadow-[0_8px_22px_rgba(0,0,0,0.09)]"
        >
          题目分析 →
        </GradientButton>
      </div>
    </Card>
  )
}

export default function MatchingDesktop({
  result, loading, error, dailyLimitHit, totalVisible, availableTabs, activeTab, filtered,
  highGroup, midGroup, noneVisible, globalNoneVisible, rankingDegraded, lowShown, selectedId, savedIds, savingId,
  onSelectTab, onSelect, onPractice, onSavePair, onRetry, onExit,
}: MatchingViewProps & { globalNoneVisible: boolean; rankingDegraded: boolean; lowShown: FunnelQuestion[] }) {

  const hasList = !loading && !error && !dailyLimitHit && !!result && !result.noMatch && !globalNoneVisible
  // 有序可导航列表：高→中→低（与左栏展示顺序一致）
  const ordered = [...highGroup, ...midGroup]
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
        {/* 分阶段进度：匹配要跑 20–47 秒真实模型调用，光一块不动的骨架屏用户无从判断是在跑还是卡死 */}
        <div className="w-full max-w-[1040px] mb-6">
          <MatchingProgress />
        </div>
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

  // 当日上限（429）：排在 error 之前，且不给「重试」——重试只会再撞 429，把用户锁进死循环。
  if (dailyLimitHit) {
    return (
      <div className={`${STAGE} flex items-center justify-center px-8`}>
        <EmptyState
          title="操作太频繁，今天先歇歇吧"
          subtitle="明天会自动恢复。已经匹配过的题目仍然可以打开。"
          ctaLabel="回首页"
          onCta={onExit}
          orbSize={100}
          alert
          ctaVariant="text"
        />
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

  // 空态四支互斥（顺序即优先级，见 page.tsx 决策树）：真没题 A 类 → 机制①降级 → B 类低相关 → 正常 master-detail。
  // 降级支【优先于】B 类，且兜住「globalNoneVisible 但无低分可展示」这一等价于机制①的组合，杜绝「文案+零张卡」空洞。
  const isNoMatch = result.noMatch
  const isDegraded = !result.noMatch && (rankingDegraded || (globalNoneVisible && lowShown.length === 0))
  const isLowMatch = !result.noMatch && !isDegraded && globalNoneVisible   // 走到这里 lowShown.length>0 必然成立

  // A 类·真没题：不套 master-detail，居中复用 NoMatchView 换故事引导（一字不动）
  if (isNoMatch) {
    return (
      <div className={`${STAGE} flex items-center justify-center px-8`}>
        <div className="w-full max-w-[600px]">
          <NoMatchView
            primaryDimension={result.primary?.dimension ?? ''}
            primaryPointName={result.primary?.pointName ?? ''}
            variant="noMatch"
          />
        </div>
      </div>
    )
  }

  // 机制①降级·重排一分没产出（无分可展示）：居中给「重试」复用 onRetry；不走 NoMatchView 换故事、不套两栏
  if (isDegraded) {
    return (
      <div className={`${STAGE} flex items-center justify-center px-8`}>
        <EmptyState
          title="排序暂时不可用"
          subtitle="题目匹配好了，但排序没算出来。点下面重试一下就好。"
          ctaLabel="重试"
          onCta={onRetry}
          orbSize={100}
        />
      </div>
    )
  }

  // B 类·低相关兜底：居中单列 max-w-[600px]（不走 master-detail——右栏 TierBadge 会给 <60 分算出「中匹配」自打脸）。
  // 内容可达 5 张卡，故顶对齐 + 可滚动，不纵向居中。
  if (isLowMatch) {
    return (
      <div className={`${STAGE} flex flex-col items-center px-8 py-8 overflow-y-auto`}>
        <div className="w-full max-w-[600px]">
          <LowMatchView
            primary={result.primary}
            secondary={result.secondary}
            lowShown={lowShown}
            selectedId={selectedId}
            savedIds={savedIds}
            savingId={savingId}
            onToggleSelect={onSelect}
            onPractice={onPractice}
            onSavePair={onSavePair}
            onExit={onExit}
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
          <h2 className="text-[1.375rem] font-bold text-v2-text-primary">匹配到 {totalVisible} 道当季真题</h2>
          {result.primary && (
            <p className="text-[0.8125rem] text-v2-text-muted mt-1">
              识别维度：{result.primary.dimension} · {result.primary.pointName}
              {result.secondary && ` ／ ${result.secondary.dimension} · ${result.secondary.pointName}`}
            </p>
          )}
          {result.matchedViaSecondary && result.secondary && (
            <Card className="px-4 py-3 mt-3">
              <p className="text-[0.8125rem] text-v2-text-primary leading-snug mb-1">暂时没匹配到完全契合的雅思真题</p>
              <p className="text-[0.75rem] text-v2-text-secondary leading-relaxed">
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
              {noneVisible && (
                <div className="text-center text-[0.8125rem] text-v2-text-muted py-10">该 Part 暂无匹配题目</div>
              )}
            </div>
          </div>

          {/* 右·选中题详情（随 selectedId 实时刷新，内容高、纵向居中于列表高度） */}
          <div className="flex-1 min-h-0 flex flex-col justify-center">
            <DetailPane
              q={selected}
              onPractice={onPractice}
              saveState={selected ? (savingId === selected.id ? 'saving' : savedIds.has(selected.id) ? 'saved' : 'idle') : 'idle'}
              onSave={() => { if (selected) onSavePair(selected.id) }}
            />
          </div>
        </div>

        {/* 极简键盘提示 */}
        <p className="shrink-0 mt-4 text-center text-[0.75rem] text-v2-text-muted">↑↓ 切题 · Enter 分析 · Esc 退出</p>
      </div>
    </div>
  )
}
