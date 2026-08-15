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
 *   noMatch / degraded / error / limit 四个终态经产品方真机验收拍板删掉了左列表说明块（与上方文案重复），
 *   这四态下左右两栏收成居中单面板（骨架容器保留，标题与说明卡不位移）。
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

/**
 * 匹配档位徽标 —— **只接 high / mid**。
 *
 * ⚠️【为什么参数类型排除了 'low'（2026-08-15 产品方拍板）】低相关档的这句判断已由题目详情卡
 *   下方的「不够贴合」标题承担；此前右上角一枚同名徽标 + 下方一句反问，说的是同一件事、
 *   等于把「这题不合适」强调了两遍。现在低相关档不再渲染本徽标。
 *   **刻意把 'low' 从参数类型里摘掉而不是留个走不到的分支**：将来谁想再给低相关档加徽标，
 *   tsc 会当场把他挡在这条决定面前，而不是让他以为这里本来就支持。
 */
function TierBadge({ tier }: { tier: Exclude<Tier, 'low'> }): JSX.Element {
  const map = {
    high: { label: '高匹配', cls: 'text-brand-accent-dark bg-brand-accent/10 border-brand-accent/25' },
    mid:  { label: '中匹配', cls: 'text-v2-text-secondary bg-black/[0.04] border-black/[0.08]' },
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
 * @param lowTone 低相关态：分析入口降为文本按钮——这道题本来就用不上，不该做成显眼 CTA 怂恿去练
 */
function DetailPane({ q, lowTone, onPractice, saveState, onSave }: {
  q: FunnelQuestion
  lowTone: boolean
  onPractice: (id: string) => void
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
            {/* 低相关档不渲染徽标：同一句判断已由下方「不够贴合」标题承担（产品方 2026-08-15 拍板）。
                high / mid 仍显示 —— 那两档的徽标是【正向信息】（这题多贴合），不与下方标题重复。 */}
            {tier && tier !== 'low' && <TierBadge tier={tier} />}
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
                正文仍用同一个 relevanceReason（重排对低分题照样给 reason，不需要新数据）。
                ⚠️【2026-08-15 产品方拍板】低相关档的标题由「这道题和你的语料差在哪」改为「不够贴合」，
                   同时右上角那枚同名 TierBadge 不再渲染 —— 此前两处同时出现同一句判断，
                   右上角一枚徽标 + 下方一句反问，说的是同一件事，读起来像被强调了两遍。
                   现在只保留下方这一处，右上角留给 Part / 维度 / 新题 这些客观标签。 */}
            <p className="text-[0.6875rem] font-semibold tracking-[0.04em] text-v2-text-muted mb-1.5">
              {tier === 'low' ? '不够贴合' : '为什么这道题适合你'}
            </p>
            <p className="text-[0.875rem] text-v2-text-secondary leading-relaxed">{q.relevanceReason}</p>
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-black/[0.05] px-7 py-5 flex items-center justify-end">
        {lowTone ? (
          <button
            onClick={() => onPractice(q.id)}
            className="min-h-[44px] inline-flex items-center px-1 text-[0.8125rem] font-medium text-v2-text-secondary active:opacity-60"
          >
            题目分析 →
          </button>
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
 * 终态动作面板：Orb + 可选说明 + 一个渐变 CTA。noMatch / degraded / error 共用
 * （limit 无卡片：产品方拍板 429 页做到最简，只留标题 + 说明卡 + 底部文字出口）。
 * @param roomy degraded / error 这两张没有说明文字的卡传 true：orb 与内边距放大、按钮加大，
 *              否则在 1440 宽屏上只有一颗 100px orb + 小按钮，卡内空得压不住（产品方真机验收）
 */
function ExitPane({ title, note, label, roomy = false, onAction }: {
  title?: string
  note?: string
  label: string
  roomy?: boolean
  onAction: () => void
}): JSX.Element {
  return (
    <Card className={`flex flex-col items-center justify-center text-center px-8 ${roomy ? 'py-16' : 'py-10'}`}>
      <Orb size={roomy ? 130 : 100} pulse={false} />
      {title && <p className="text-[0.9375rem] font-medium text-v2-text-primary mt-5">{title}</p>}
      {note && <p className="text-[0.8125rem] text-v2-text-secondary mt-2 max-w-[300px] leading-relaxed">{note}</p>}
      <GradientButton
        onClick={onAction}
        className={`min-h-[44px] inline-flex items-center justify-center rounded-full font-medium ${
          roomy ? 'mt-7 px-8 py-3 text-[0.9375rem]' : 'mt-5 px-6 py-2.5 text-[0.875rem]'
        }`}
      >
        {label}
      </GradientButton>
    </Card>
  )
}

export default function MatchingDesktop({
  phase, result, missingCorpus, candidateCount, arrivedCount, slowHint, earlyHint,
  totalVisible, hasHigh, availableTabs, activeTab, filtered,
  highGroup, midGroup, noneVisible, lowShown, selectedId, savedIds, savingId,
  onSelectTab, onSelect, onPractice, onSavePair, onRetry, onExit,
}: MatchingViewProps): JSX.Element {
  const pending = phase === 'waiting' || phase === 'streaming'
  const isLow = phase === 'lowMatch'
  const hasList = phase === 'streaming' || phase === 'result' || isLow
  // 四个终态：产品方真机验收拍板删掉左列表说明块（与上方标题/说明卡重复），两栏收成居中单面板
  const isTerminal = phase === 'noMatch' || phase === 'degraded' || phase === 'error' || phase === 'limit'
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
          <h2 className="text-[1.375rem] font-bold text-v2-text-primary">{matchTitle(phase, totalVisible, hasHigh)}</h2>
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
          secondary={result?.secondary ?? null}
          hasHigh={hasHigh}
          matchedViaSecondary={!!result?.matchedViaSecondary}
          arrivedCount={arrivedCount}
          candidateCount={candidateCount}
          slowHint={slowHint}
          earlyHint={earlyHint}
          missingCorpus={missingCorpus}
          onRetry={onRetry}
        />

        {/* ③ 两栏（恒在容器）：等待/流式/结果/低相关填左右两栏；四个终态删掉列表说明块后收居中单面板
            （产品方拍板：与上方文案重复的 orb 说明块删除；limit 连动作卡都不留，出口在底部提示行） */}
        <div className="flex-1 min-h-0 flex gap-6">
          {isTerminal ? (
            <div className="flex-1 min-h-0 flex flex-col justify-center items-center">
              <div className="w-full max-w-[560px]">
                {phase === 'noMatch' && (
                  // 文案不再建议「换个角度」：换角度能沾边的话就该有中匹配或低匹配，
                  // 一道都没召回说明这个故事本身和题库对不上，建议换角度是误导（产品方论证定稿）
                  <ExitPane
                    title="换个故事试试"
                    note="这个故事和当季题库对不上。可以试试分享其他经历，或者在首页切到雅思题模式，直接挑题来讲。"
                    label="回到首页"
                    onAction={onExit}
                  />
                )}
                {phase === 'degraded' && <ExitPane roomy label="重新匹配" onAction={onRetry} />}
                {phase === 'error' && (
                  // F10：缺 corpusId 时重试永远无效（页面根本不知道该匹配哪段语料），出口换成回首页
                  missingCorpus
                    ? <ExitPane roomy label="回到首页" onAction={onExit} />
                    : <ExitPane roomy label="重试" onAction={onRetry} />
                )}
                {/* limit：这里刻意什么都不放（页面做到最简），退路是底部提示行的「回到首页」文字链接 */}
              </div>
            </div>
          ) : (
            <>
              {/* 左·题目列表 */}
              <div className="w-[360px] shrink-0 flex flex-col min-h-0">
                {/* Part 筛选槽：恒占 2rem 高。【必须用 rem 不能用 px】：Chip 字号是 rem，会随设置页字体档
                    （--fs-scale 最大 1.15）联动放大——实测标准档 chip 恰好 30px，特大档约 32.7px，
                    px 定高 + overflow-hidden 正是「全部」下沿被裁的成因。rem 槽随档同缩放，任何档位都不裁；
                    三枚 chips 总宽远不到换行线，无需 wrap 与 overflow 裁剪 */}
                <div className="h-[2rem] shrink-0 mb-4 flex items-center gap-2">
                  {phase === 'waiting' && (
                    <span className="flex gap-2" aria-hidden="true">
                      <Skeleton className="w-12 h-[1.875rem] rounded-full" />
                      <Skeleton className="w-16 h-[1.875rem] rounded-full" />
                    </span>
                  )}
                  {/* 低相关态不渲染 chips：lowShown 不经 Part 筛选，渲染出来就是个点了没反应的死控件 */}
                  {(phase === 'streaming' || phase === 'result') && availableTabs.map((p) => (
                    <Chip key={p} onClick={() => onSelectTab(p)} variant="ghost" active={activeTab === p}>
                      {p}
                    </Chip>
                  ))}
                </div>

                {/* 列表区：骨架卡 / 真卡分组，二选一填进同一个滚动容器 */}
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
                </div>
              </div>

              {/* 右·面板槽（等待说明 / 题目详情） */}
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
                      saveState={savingId === selected.id ? 'saving' : savedIds.has(selected.id) ? 'saved' : 'idle'}
                      onSave={() => onSavePair(selected.id)}
                    />
                  ) : (
                    <Card className="flex items-center justify-center px-8 py-16 text-center">
                      <p className="text-[0.8125rem] text-v2-text-muted">从左侧选择一道题查看详情</p>
                    </Card>
                  )
                )}
              </div>
            </>
          )}
        </div>

        {/* ④ 键盘提示（恒在）。lowMatch / limit 的「回到首页」按产品方拍板做成同层级纯文字链接放在这一行：
            这两个状态的出口是退路不是主推，不给渐变按钮 */}
        <p className="shrink-0 mt-4 text-center text-[0.75rem] text-v2-text-muted">
          ↑↓ 切题 · Enter 分析 · Esc 退出
          {(isLow || phase === 'limit') && (
            <>
              {' · '}
              <button onClick={onExit} className="underline underline-offset-2 active:opacity-60">回到首页</button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
