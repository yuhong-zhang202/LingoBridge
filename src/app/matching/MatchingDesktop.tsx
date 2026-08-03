/**
 * @module   MatchingDesktop
 * @desc     题目匹配页桌面视图 —— 【统一骨架】：从进入匹配页到结果到齐，页面结构一次都不重建。
 *           四个槽全程存在：① 状态化标题 + 识别维度副行 ② 状态说明卡 ③ 两栏（左列表 / 右面板）④ 键盘提示。
 *           八种状态只换槽内内容（骨架卡变真卡、标题数字变化、说明卡换措辞），绝不整页互换。
 *
 *   为什么这样改：产品方实测时页面在等待中显示「匹配到 0 道当季真题」+ 空白左栏约 50 秒，
 *   随后整页跳变成另一套版式。旧代码有四个 `if (...) return` 整页分支，它们彼此就是四张不同的页。
 *   产品方的原话要求是「桌面端和移动端的题目匹配页面应该都各只有一种页面展示」。
 *
 *   ⚠️ 本文件【不做形态判定】，只读 props.phase（真源在 app/matching/phase.ts，带单测）。
 *   ⚠️ <MatchStatusNote> 必须保持在骨架的固定位置：它内部的 <MatchingProgress> 计时器以挂载时刻为起点，
 *     一旦因分支切换而重挂载，进度条会从 85% 掉回 0。
 *
 *   桌面独有：↑↓ 切题 / Enter·→ 分析 / Esc 退出、行 hover 高亮、右栏 CTA 浮起。
 * @author   LingoBridge
 * @created  2026-07-09
 */
'use client'
import { type JSX, useEffect, useRef } from 'react'
import Card from '@/components/Card'
import Chip from '@/components/Chip'
import Tag from '@/components/Tag'
import Orb from '@/components/Orb'
import PartTag from '@/components/PartTag'
import Skeleton from '@/components/Skeleton'
import GradientButton from '@/components/GradientButton'
import MatchStatusNote, { matchTitle, MatchDimensionLine } from '@/components/matching/MatchStatusNote'
import AnkiBookmarkButton, { type AnkiSaveState } from '@/components/anki/AnkiBookmarkButton'
import { SCORE_HIGH, SCORE_MID, BRAND_GRADIENT_VERTICAL } from '@/lib/constants'
import type { MatchingViewProps, FunnelQuestion } from './types'

/** 选中行左侧竖条渐变：全站复用的品牌竖向渐变 */
const SELECTED_BAR = BRAND_GRADIENT_VERTICAL

/**
 * 匹配档位。三档而不是两档：低相关态右栏照样要立一张卡，只有 high/mid 两档时
 * 会给一道 45 分的题算出「中匹配」，页面上半部分刚说完「没有能用的题」，右边就自己打脸。
 * 未打分（undefined）返回 null → 不渲染徽标：降级态下分数全缺，标任何档都是「知道自己不知道，还是说了」。
 */
type Tier = 'high' | 'mid' | 'low'
function tierOf(score?: number): Tier | null {
  if (score === undefined) {
    console.error('[MatchingDesktop] 收到未打分候选，不标任何档', { score })
    return null
  }
  if (score >= SCORE_HIGH) return 'high'
  return score >= SCORE_MID ? 'mid' : 'low'
}

/** 分组标题行：完整文本 + 横线（文本由调用方组装，因为低相关态那一组不是「X · N 道」的形状） */
function GroupHeader({ text, variant }: { text: string; variant: Tier }): JSX.Element {
  const textClass =
    // 高匹配用 -dark 变体：brand-accent 对白底仅约 2.7:1，不达 WCAG AA（移动端早已改，桌面此前漏改）
    variant === 'high' ? 'text-brand-accent-dark font-semibold'
    : variant === 'mid' ? 'text-v2-text-secondary font-medium'
    : 'text-v2-text-muted font-medium'
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={`text-[0.6875rem] ${textClass}`}>{text}</span>
      <div className="flex-1 h-px bg-black/[0.05]" />
    </div>
  )
}

/** 匹配档位徽标 */
function TierBadge({ tier }: { tier: Tier }): JSX.Element {
  const map = {
    high: { label: '高匹配',   cls: 'text-brand-accent-dark bg-brand-accent/10 border-brand-accent/25' },
    mid:  { label: '中匹配',   cls: 'text-v2-text-secondary bg-black/[0.04] border-black/[0.08]' },
    low:  { label: '不够贴合', cls: 'text-v2-text-muted bg-black/[0.04] border-black/[0.08]' },
  }[tier]
  return <span className={`text-[0.6875rem] font-medium px-[9px] py-[3px] rounded-full border ${map.cls}`}>{map.label}</span>
}

/** 左栏紧凑可点题目行 —— 视觉 DNA 对齐 MatchedQuestionCard，但行内不放 CTA（CTA 归右栏） */
function QuestionRow({ q, isHigh, selected, showSwitchTag = true, onSelect }: {
  q: FunnelQuestion; isHigh: boolean; selected: boolean; showSwitchTag?: boolean; onSelect: () => void
}): JSX.Element {
  const enText = q.part === 2 ? (q.cue_card_title ?? q.question_text) : q.question_text
  const zhText = q.part === 2 ? (q.cue_card_title_zh ?? '') : (q.question_text_zh ?? '')
  const needSwitch = showSwitchTag && !q.isPrimaryMatch && !isHigh
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
            // 文字色由 brand-primary-dark 改 v2-text-secondary：前者压 brand-primary/10 底约 3.86:1，
            // 10px 字远不达 WCAG AA
            <span className="text-[0.625rem] font-medium px-[8px] py-[3px] rounded-full text-v2-text-secondary bg-brand-primary/10 border border-brand-primary/30">
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

/**
 * 右栏选中题详情。
 * @param lowTone     低相关态：分析入口降为文本按钮（这道题本来就用不上，不该和主 CTA 抢注意力），
 *                    并给一个退回出口面板的方式
 * @param onBackToExit 退回出口面板（仅 lowTone 有）
 */
function DetailPane({ q, lowTone, onPractice, onBackToExit, saveState, onSave }: {
  q: FunnelQuestion
  lowTone: boolean
  onPractice: (id: string) => void
  onBackToExit: () => void
  saveState: AnkiSaveState
  onSave: () => void
}): JSX.Element {
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
            {tier && <TierBadge tier={tier} />}
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
            {/* 标题按档切：低相关时「为什么这道题适合你」是句谎话，这道题恰恰不适合。
                正文仍用同一个 relevanceReason（重排对低分题照样给 reason，不需要新数据）。 */}
            <p className="text-[0.6875rem] font-semibold tracking-[0.04em] text-v2-text-muted mb-1.5">
              {tier === 'low' ? '这道题和你的语料差在哪' : '为什么这道题适合你'}
            </p>
            <p className="text-[0.875rem] text-v2-text-secondary leading-relaxed">{q.relevanceReason}</p>
          </div>
        )}
      </div>
      <div className={`shrink-0 border-t border-black/[0.05] px-7 py-5 flex items-center ${lowTone ? 'justify-between' : 'justify-end'}`}>
        {lowTone ? (
          <>
            <button
              onClick={onBackToExit}
              className="min-h-[44px] inline-flex items-center px-1 text-[0.8125rem] text-v2-text-muted active:opacity-60"
            >
              ← 返回
            </button>
            <button
              onClick={() => onPractice(q.id)}
              className="min-h-[44px] inline-flex items-center px-1 text-[0.8125rem] font-medium text-v2-text-secondary active:opacity-60"
            >
              题目分析 →
            </button>
          </>
        ) : (
          <GradientButton
            onClick={() => onPractice(q.id)}
            className="flex items-center gap-1.5 px-7 py-3 rounded-full text-[0.9375rem] font-medium transition-[transform,box-shadow] duration-200 hover:-translate-y-[2px] hover:shadow-[0_8px_22px_rgba(0,0,0,0.09)]"
          >
            题目分析 →
          </GradientButton>
        )}
      </div>
    </Card>
  )
}

/**
 * 右栏出口面板：Orb + 可选说明 + 一个动作。degraded / error / limit / lowMatch / noMatch 共用，
 * 免得每个状态各造一张不一样的空态页（那正是旧代码整页跳变的来源）。
 * @param variant pill = 主要动作（渐变胶囊）；text = 退路（低强度文本按钮，如 429 不该显眼地怂恿再点）
 */
function ExitPane({ title, note, label, variant = 'pill', onAction }: {
  title?: string
  note?: string
  label: string
  variant?: 'pill' | 'text'
  onAction: () => void
}): JSX.Element {
  return (
    <Card className="flex flex-col items-center justify-center text-center px-8 py-10">
      <Orb size={100} pulse={false} />
      {title && <p className="text-[0.9375rem] font-medium text-v2-text-primary mt-5">{title}</p>}
      {note && <p className="text-[0.8125rem] text-v2-text-secondary mt-2 max-w-[280px] leading-relaxed">{note}</p>}
      {variant === 'pill' ? (
        <GradientButton onClick={onAction} className="mt-5 min-h-[44px] inline-flex items-center justify-center px-6 py-2.5 rounded-full text-[0.875rem] font-medium">
          {label}
        </GradientButton>
      ) : (
        <button
          onClick={onAction}
          className="mt-2 min-h-[44px] inline-flex items-center justify-center px-3 text-[0.8125rem] font-medium text-v2-text-secondary active:opacity-60"
        >
          {label}
        </button>
      )}
    </Card>
  )
}

/** 列表区的「这个状态没有题可列」说明块（noMatch / degraded / error / limit 共用） */
function ListNote({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center text-center pt-10">
      <Orb size={100} pulse={false} />
      <p className="text-[0.9375rem] font-medium text-v2-text-primary mt-5">{text}</p>
    </div>
  )
}

export default function MatchingDesktop({
  phase, result, missingCorpus, candidateCount, arrivedCount, slowHint,
  totalVisible, availableTabs, activeTab, filtered,
  highGroup, midGroup, noneVisible, lowShown, selectedId, savedIds, savingId,
  onSelectTab, onSelect, onToggleSelect, onPractice, onSavePair, onRetry, onExit,
}: MatchingViewProps): JSX.Element {
  const pending = phase === 'waiting' || phase === 'streaming'
  const isLow = phase === 'lowMatch'
  const hasList = phase === 'streaming' || phase === 'result' || isLow
  // 有序可导航列表：低相关态走 lowShown（它不经 Part 筛选），其余走高→中（与左栏展示顺序一致）。
  // 漏了这步低相关态的 ↑↓ 就会全无反应、右栏永远空着。
  const listItems = isLow ? lowShown : [...highGroup, ...midGroup]
  const selected = result ? (result.questions.find((q) => q.id === selectedId) ?? null) : null

  // 筛选联动：切 Part 后若选中题不在筛选结果里，自动选中第一题，右栏不空。
  // 低相关态【刻意不参与】：那几道题是佐证不是备选，替用户选中一道用不上的题等于变相推荐。
  // 仅桌面断点生效——两视图同时挂载，matchMedia 守卫避免在移动端改写共享 selectedId。
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia('(min-width: 1024px)').matches) return
    if (phase !== 'streaming' && phase !== 'result') return
    if (filtered.length === 0) return
    if (!filtered.some((q) => q.id === selectedId)) onSelect(filtered[0].id)
  }, [filtered, selectedId, phase, onSelect])

  // 键盘：↑↓ 切题、Enter/→ 进入分析、Esc 退出（仅桌面断点、有列表时才挂）
  const latest = useRef({ listItems, selectedId, onSelect, onPractice, onExit })
  latest.current = { listItems, selectedId, onSelect, onPractice, onExit }
  useEffect(() => {
    if (!hasList) return
    const onKey = (e: KeyboardEvent): void => {
      if (!window.matchMedia('(min-width: 1024px)').matches) return
      const t = e.target as HTMLElement | null
      const { listItems, selectedId, onSelect, onPractice, onExit } = latest.current
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // 方向键无原生按钮动作，始终用于列表切题（即使焦点在筛选 Chip/行上）
        e.preventDefault()
        if (listItems.length === 0) return
        const idx = listItems.findIndex((q) => q.id === selectedId)
        const nextIdx = e.key === 'ArrowDown'
          ? Math.min(listItems.length - 1, idx < 0 ? 0 : idx + 1)
          : Math.max(0, idx < 0 ? 0 : idx - 1)
        const nextId = listItems[nextIdx].id
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

  return (
    // aria-busy 覆盖整个等待期（含 streaming）：此前只在 loading 期间挂，而 loading 在第一个 question 帧
    // 就变 false，正好把最长的那段等待漏在外面。
    <div className="h-[calc(100vh-72px)] flex flex-col items-center px-8 py-8 overflow-hidden" aria-busy={pending}>
      <div className="w-full max-w-[1040px] flex-1 min-h-0 flex flex-col">

        {/* ① 头部（恒在：标题随状态换措辞，副行恒占一行） */}
        <div className="shrink-0 mb-5">
          <h2 className="text-[1.375rem] font-bold text-v2-text-primary">{matchTitle(phase, totalVisible)}</h2>
          <MatchDimensionLine
            phase={phase}
            primary={result?.primary ?? null}
            secondary={result?.secondary ?? null}
            className="text-[0.8125rem] text-v2-text-muted mt-1"
          />
        </div>

        {/* ② 状态说明卡（恒在：唯一会换措辞的地方；min-h 锁住卡高，八种状态之间不位移） */}
        <MatchStatusNote
          phase={phase}
          className="mb-5"
          cardClassName="px-4 py-3 min-h-[76px]"
          primary={result?.primary ?? null}
          secondary={result?.secondary ?? null}
          matchedViaSecondary={!!result?.matchedViaSecondary}
          arrivedCount={arrivedCount}
          candidateCount={candidateCount}
          slowHint={slowHint}
          missingCorpus={missingCorpus}
          onRetry={onRetry}
        />

        {/* ③ 两栏（恒在：左列表 + 右面板，各自内部滚动） */}
        <div className="flex-1 min-h-0 flex gap-6">

          {/* 左·题目列表 */}
          <div className="w-[360px] shrink-0 flex flex-col min-h-0">
            {/* Part 筛选槽：恒占 26px 高，避免 chips 出现/消失时下面整列上下跳 */}
            <div className="h-[26px] shrink-0 mb-4 flex gap-2 flex-wrap overflow-hidden">
              {phase === 'waiting' && (
                <span className="flex gap-2" aria-hidden="true">
                  <Skeleton className="w-12 h-[26px] rounded-full" />
                  <Skeleton className="w-16 h-[26px] rounded-full" />
                </span>
              )}
              {/* 低相关态不渲染 chips：lowShown 不经 Part 筛选，渲染出来就是个点了没反应的死控件 */}
              {(phase === 'streaming' || phase === 'result') && availableTabs.map((p) => (
                <Chip key={p} onClick={() => onSelectTab(p)} variant="ghost" active={activeTab === p}>
                  {p}
                </Chip>
              ))}
            </div>

            {/* 列表区：骨架卡 / 真卡分组 / 说明块，三选一填进同一个滚动容器 */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-1.5 flex flex-col gap-5">
              {phase === 'waiting' && (
                <div className="flex flex-col gap-2.5" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="w-full h-[86px] rounded-[14px]" />)}
                </div>
              )}

              {(phase === 'streaming' || phase === 'result') && (
                <>
                  {highGroup.length > 0 && (
                    <div>
                      <GroupHeader text={`高匹配 · ${highGroup.length} 道`} variant="high" />
                      <div className="flex flex-col gap-2.5">
                        {highGroup.map((q) => (
                          <QuestionRow key={q.id} q={q} isHigh selected={selectedId === q.id} onSelect={() => onSelect(q.id)} />
                        ))}
                      </div>
                    </div>
                  )}
                  {midGroup.length > 0 && (
                    <div>
                      <GroupHeader text={`中匹配 · ${midGroup.length} 道`} variant="mid" />
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
                </>
              )}

              {isLow && (
                // 单组，不拆「最相关 / 其他」：拆开会让第一张看起来是被推荐的，与「都用不上」的定调打架
                <div>
                  <GroupHeader text={`最接近的 ${lowShown.length} 道，都用不上`} variant="low" />
                  <div className="flex flex-col gap-2.5">
                    {lowShown.map((q) => (
                      // showSwitchTag=false：全都不贴合的语境下只给一部分卡挂「需切换角度」，
                      // 等于暗示没挂的那几道可以直接用
                      <QuestionRow
                        key={q.id} q={q} isHigh={false} showSwitchTag={false}
                        selected={selectedId === q.id} onSelect={() => onSelect(q.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {phase === 'noMatch'  && <ListNote text="这一季没有可以列出来的题" />}
              {phase === 'degraded' && <ListNote text="排序没出来，暂时没法按贴合度排列" />}
              {phase === 'error'    && <ListNote text="没有拿到题目" />}
              {phase === 'limit'    && <ListNote text="今天不再发起新的匹配" />}
            </div>
          </div>

          {/* 右·面板槽（等待说明 / 题目详情 / 出口面板） */}
          <div className="flex-1 min-h-0 flex flex-col justify-center">
            {phase === 'waiting' && (
              <Card className="flex flex-col items-center justify-center px-8 py-16 text-center">
                <p className="text-[0.875rem] text-v2-text-primary">题目还在陆续到达，到了会显示在左边</p>
                <p className="text-[0.8125rem] text-v2-text-muted mt-2">选中任意一道，这里会展开它和你的语料的关系</p>
              </Card>
            )}

            {(phase === 'streaming' || phase === 'result' || isLow) && (
              selected ? (
                <DetailPane
                  q={selected}
                  lowTone={isLow}
                  onPractice={onPractice}
                  // 退回出口面板：复用 onToggleSelect（再点同一张即取消选中），不新增一条清空选中的通路
                  onBackToExit={() => onToggleSelect(selected.id)}
                  saveState={savingId === selected.id ? 'saving' : savedIds.has(selected.id) ? 'saved' : 'idle'}
                  onSave={() => onSavePair(selected.id)}
                />
              ) : isLow ? (
                // 低相关态默认落在出口面板上：这个状态下唯一的主要动作就是回首页重讲。
                // 用户主动点某道题时右栏才切成详情——那是用户自己触发的槽位内容切换，不是页面自己变形。
                <ExitPane label="回到首页" onAction={onExit} />
              ) : (
                <Card className="flex items-center justify-center px-8 py-16 text-center">
                  <p className="text-[0.8125rem] text-v2-text-muted">从左侧选择一道题查看详情</p>
                </Card>
              )
            )}

            {phase === 'noMatch' && (
              <ExitPane
                title="换个角度，重新讲一遍"
                note="同一件事，换个重点讲，往往就能对上题库里的题。"
                label="回到首页"
                onAction={onExit}
              />
            )}
            {phase === 'degraded' && <ExitPane label="重新匹配" onAction={onRetry} />}
            {phase === 'error' && (
              // F10：缺 corpusId 时重试永远无效（页面根本不知道该匹配哪段语料），出口换成回首页
              missingCorpus
                ? <ExitPane label="回到首页" onAction={onExit} />
                : <ExitPane label="重试" onAction={onRetry} />
            )}
            {/* 429 不给重试（只会再撞一次），退路做成低强度文本按钮 */}
            {phase === 'limit' && <ExitPane label="回到首页" variant="text" onAction={onExit} />}
          </div>
        </div>

        {/* ④ 键盘提示（恒在） */}
        <p className="shrink-0 mt-4 text-center text-[0.75rem] text-v2-text-muted">↑↓ 切题 · Enter 分析 · Esc 退出</p>
      </div>
    </div>
  )
}
