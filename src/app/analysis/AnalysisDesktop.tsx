/**
 * @module   AnalysisDesktop
 * @desc     题目分析页桌面视图（split 档）—— FlowShellDesktop 沉浸外壳内的两栏舞台：
 *           顶部跨栏题目卡，下方 max-w-[960px] grid-cols-2「左 考官侧重点 | 右 可用词组」左右并置一眼对照，
 *           底部居中「开始练习」CTA。两栏定高（PANEL_H）恒等高：左栏内容顶部对齐、右栏词组含详情卡
 *           一律卡内滚动，展开详情不撑高布局。水平下拉 / 词组详情 / 收藏逻辑经 props 由 page.tsx 外壳下发。
 *           桌面独有交互：词组 chip 与主按钮 hover 轻微浮起；Enter/→ 进入练习、Esc 退出。
 * @author   LingoBridge
 * @created  2026-07-09
 */
'use client'
import { useEffect, useRef, type ReactNode } from 'react'
import { Target, Type, ChevronDown, Check, Star, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import Card from '@/components/Card'
import Skeleton from '@/components/Skeleton'
import PartTag from '@/components/PartTag'
import Tag from '@/components/Tag'
import EmptyState from '@/components/EmptyState'
import OfflineState from '@/components/OfflineState'
import GradientButton from '@/components/GradientButton'
import PhraseDetailCard from '@/components/analysis/PhraseDetailCard'
import { BRAND_GRADIENT_SOFT } from '@/lib/constants'
import type { AnalysisViewProps } from './types'

/** 词组分组配色：按组循环（暖橙 / 标准绿 / 雾青蓝），与移动端一致（设计系统唯一允许的多色例外）。 */
const PHRASE_CHIP_STYLES = [
  'bg-phrase-warm-bg text-brand-primary-dark border-brand-primary-light',
  'bg-tag-success-bg text-tag-success-text border-tag-success-border',
  'bg-phrase-blue-bg text-phrase-blue-text border-phrase-blue-border',
]

/** 可选雅思口语目标水平 */
const LEVELS = ['5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0']

/** 舞台最小高度：满屏减去外壳顶栏高度。
 *  这里的 72 = TOPNAV_H_DESKTOP（见 @/lib/constants）——Tailwind 的 calc() 必须是字面量、
 *  不能插值运行时变量（JIT 扫不到动态拼出的 class），故此处保留字面量并以注释锚定。
 *  改 TOPNAV_H_DESKTOP 必须同步改这里，以及下方 PANEL_H 那笔首屏高度账。 */
const STAGE = 'min-h-[calc(100vh-72px)]'

/** 两栏舞台定高：左右卡片恒等高、不随内容（含词组详情卡展开）变化，超出部分走卡内滚动。
 *  取 360px —— 落在既有 min-h-[340px]（左栏原下限，不压缩现有内容）与 max-h-[440px] 之间，
 *  并留出 1080p 首屏余量：整页所需高度 ≈ 旁白 44 + 题目卡 ~149 + 24 + 360 + 32 + CTA 46
 *  + 12 + 提示 18 + 舞台 py-12 96 + 顶栏 TOPNAV_H_DESKTOP(72) ≈ 853px，1080p 窗口可视高约 900–970，
 *  即便题面折成 3 行仍不把「开始练习」推出首屏。改这个值前先重算这笔账。 */
const PANEL_H = 'h-[360px]'

/** 序号圆圈：外层极淡渐变描边 + 内层白底 + 灰色数字 */
function StepNum({ n }: { n: number }) {
  return (
    <div style={{ background: BRAND_GRADIENT_SOFT, padding: 1, borderRadius: '50%', width: 20, height: 20, flexShrink: 0 }}>
      <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
        <span className="text-[0.6875rem] font-bold leading-none text-v2-text-muted">{n}</span>
      </div>
    </div>
  )
}

/** 渐变描边卡片 — 极淡 1px 渐变 border + 白底内层。
 *  桌面 split 两栏定高：h-full 吃 grid 行的固定高度（PANEL_H），
 *  min-h-0 让内部 flex 子项可收缩、把溢出交给卡内滚动容器而不是撑高卡片。 */
function GradCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card variant="gradient" className={cn('px-[22px] pt-[18px] pb-[22px] h-full min-h-0 flex flex-col', className)}>
      {children}
    </Card>
  )
}

export default function AnalysisDesktop({
  data, loading, error, dailyLimitHit, level, levelMenuOpen, phrasesLoading, phrasesError, openPhrase, savedSet,
  onRetry, onRetryPhrases, onToggleLevelMenu, onSelectLevel, onTogglePhrase, onToggleSave, onStartPractice, onReviewCards, onExit,
}: AnalysisViewProps) {

  // 键盘：Enter / → 进入练习、Esc 退出（仅桌面断点、有结果时才挂；焦点在输入类元素时不拦截）
  const ready = !loading && !error && !dailyLimitHit && !!data
  const latest = useRef({ onStartPractice, onExit, levelMenuOpen, onToggleLevelMenu, openPhrase, onTogglePhrase })
  latest.current = { onStartPractice, onExit, levelMenuOpen, onToggleLevelMenu, openPhrase, onTogglePhrase }
  useEffect(() => {
    if (!ready) return
    const onKey = (e: KeyboardEvent) => {
      if (!window.matchMedia('(min-width: 1024px)').matches) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const s = latest.current
      // level 菜单展开时：Esc 先关菜单，其余键让位于菜单（不做页面导航）
      if (s.levelMenuOpen) {
        if (e.key === 'Escape') { e.preventDefault(); s.onToggleLevelMenu() }
        return
      }
      // 词组详情展开时：Esc 先收起详情卡（关卡片是最自然的预期），不再直接退出整场练习流程
      if (s.openPhrase && e.key === 'Escape') { e.preventDefault(); s.onTogglePhrase(null); return }
      // Enter/→ 交还给聚焦的原生控件（按钮 / 下拉项）自行激活，不劫持去练习
      if ((e.key === 'Enter' || e.key === 'ArrowRight') && t?.closest('button, a, [role="button"]')) return
      if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); s.onStartPractice() }
      else if (e.key === 'Escape') { s.onExit() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready])

  // 词组栏定高后详情卡内联展开在被点 chip 下方，可能落在可视区外 = 用户点了没反应。
  // 展开后把详情卡滚进视野；block:'nearest' 只做最小位移（已可见则不动），不打断阅读位置。
  const detailRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!openPhrase) return
    detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [openPhrase])

  if (loading) {
    return (
      <div className={`${STAGE} flex flex-col justify-center px-8 py-12`} aria-busy="true">
        <div className="w-full max-w-[960px] mx-auto" aria-hidden="true">
          {/* 题目卡骨架 */}
          <Card className="px-[22px] pt-[16px] pb-[22px]">
            <div className="flex items-center gap-2">
              <Skeleton className="w-12 h-[18px] rounded-full" />
              <Skeleton className="w-14 h-[18px] rounded-full" />
            </div>
            <Skeleton className="w-[70%] h-[14px] mt-3" />
            <Skeleton className="w-1/3 h-3 mt-2" />
          </Card>
          <div className={`grid grid-cols-2 gap-8 items-stretch mt-6 ${PANEL_H}`}>
            {/* 答题侧重点骨架 */}
            <GradCard>
              <Skeleton className="w-24 h-3.5" />
              <div className="flex flex-col gap-4 mt-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <Skeleton className="w-6 h-6 rounded-full flex-shrink-0" />
                    <div className="flex-1">
                      <Skeleton className="w-3/4 h-[14px]" />
                      <Skeleton className="w-[90%] h-3 mt-2" />
                    </div>
                  </div>
                ))}
              </div>
            </GradCard>
            {/* 可用词组骨架 */}
            <GradCard>
              <div className="flex items-center justify-between">
                <Skeleton className="w-20 h-3.5" />
                <Skeleton className="w-16 h-6 rounded-full" />
              </div>
              <div className="flex flex-col gap-3 mt-4">
                {[0, 1, 2].map((i) => (
                  <div key={i}>
                    <Skeleton className="w-1/3 h-3" />
                    <Skeleton className="w-[92%] h-[14px] mt-2" />
                  </div>
                ))}
              </div>
            </GradCard>
          </div>
        </div>
      </div>
    )
  }

  // 当日上限（429）：排在 error 之前，且不给「重试」——重试只会再撞 429，把用户锁进死循环。
  if (dailyLimitHit) {
    return (
      <div className={`${STAGE} flex flex-col items-center justify-center px-8`}>
        <EmptyState
          title="操作太频繁，今天先歇歇吧"
          subtitle="明天会自动恢复。收藏过的词卡随时可以回顾。"
          ctaLabel="回顾词卡"
          onCta={onReviewCards}
          orbSize={100}
          alert
          ctaVariant="text"
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className={`${STAGE} flex flex-col items-center justify-center px-8`}>
        {typeof navigator !== 'undefined' && !navigator.onLine ? (
          <OfflineState onRetry={onRetry} />
        ) : (
          <EmptyState
            title="分析没生成出来"
            subtitle="刚才好像没连上，点下面再试一次就好。"
            ctaLabel="重试"
            onCta={onRetry}
            orbSize={100}
          />
        )}
      </div>
    )
  }

  if (!data) return <div className={STAGE} />

  return (
    <div className={`${STAGE} flex flex-col justify-center px-8 py-12`}>
      <div className="w-full max-w-[960px] mx-auto">

        {/* 旁白定调：点明左右两栏的关系（考官怎么看 · 能用的表达），暖橙绿蓝一句话引导 */}
        <div className="mb-6 flex items-center justify-center gap-2 text-[0.8125rem] text-v2-text-muted">
          <Sparkles size={14} className="text-brand-accent" />
          <span>先看考官会怎么评这道题，再挑几个直接能用的表达</span>
        </div>

        {/* 题目卡（跨栏，本页主角） */}
        <Card className="px-7 pt-[18px] pb-[22px]">
          <div className="flex items-center gap-2 mb-2.5">
            <PartTag label={`Part ${data.question.part}`} />
            {data.question.dimension && <Tag variant="green" label={data.question.dimension} />}
            {data.question.isNew && <Tag variant="green" label="当季新题" />}
          </div>
          <p className="text-[1.0625rem] font-semibold text-v2-text-primary leading-[1.5] mb-1.5">{data.question.en}</p>
          <p className="text-[0.8125rem] text-v2-text-muted">{data.question.zh}</p>
        </Card>

        {/* split 档：左 考官侧重点 | 右 可用词组，天然成对左右并置、等高对照。
            行高由 PANEL_H 锁死：两栏恒等高，词组详情卡展开只在栏内滚动，整页布局纹丝不动。 */}
        <div className={`grid grid-cols-2 gap-8 items-stretch mt-6 ${PANEL_H}`}>

          {/* 左栏：考官侧重点 */}
          <GradCard>
            <div className="flex items-center gap-1.5 mb-2">
              <Target size={13} className="text-brand-primary" />
              <span className="text-[0.8125rem] font-semibold text-v2-text-secondary">答题侧重点</span>
            </div>
            {data.analysis.structureLabel && (
              <p className="text-[0.6875rem] text-v2-text-muted font-medium leading-[1.7] mb-4">{data.analysis.structureLabel}</p>
            )}
            {/* 顶部对齐（产品方 2026-07-20 拍板）：内容顶着标题起排，不做垂直居中——
                居中版实际观感是内容悬空、与标题脱节。pt-3 是标题与第一条之间的呼吸，
                取值与条目间距 gap-5(20px) 相协调、又不至于把首条推得太低。
                外层保持 flex-1 min-h-0 overflow-y-auto：内容超过定高 PANEL_H 时栏内滚动，
                两栏等高与右栏内部滚动的布局契约不受影响。 */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              <div className="flex flex-col justify-start pt-3 gap-5">
                {data.analysis.focusPoints.map((fp, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <StepNum n={i + 1} />
                    <div className="flex-1 pt-[1px]">
                      <p className="text-[0.875rem] font-medium text-v2-text-primary leading-[1.6]">{fp.title}</p>
                      <p className="text-[0.75rem] text-v2-text-muted mt-1 leading-relaxed">{fp.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </GradCard>

          {/* 右栏：可用词组（含水平下拉，向下展开不被容器裁切） */}
          <GradCard>
            <div className="flex items-center gap-1.5 mb-3">
              <Type size={13} className="text-brand-accent" />
              <span className="text-[0.8125rem] font-semibold text-v2-text-secondary">可用词组</span>
              <div className="relative ml-auto">
                <button
                  onClick={onToggleLevelMenu}
                  disabled={phrasesLoading}
                  aria-haspopup="listbox"
                  aria-expanded={levelMenuOpen}
                  className="flex items-center gap-1 text-[0.75rem] text-brand-primary-dark bg-white border border-brand-primary-light rounded-full pl-2.5 pr-1.5 py-[4px] leading-none active:scale-[0.97] transition-transform duration-150 disabled:opacity-50"
                >
                  雅思 {level}
                  <ChevronDown size={13} className={`transition-transform duration-150 ${levelMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {levelMenuOpen && (
                  <div role="listbox" aria-label="目标水平" className="absolute right-0 top-[calc(100%+6px)] z-20 w-[110px] bg-white border border-black/[0.08] rounded-[14px] p-1.5 shadow-[0_6px_20px_rgba(0,0,0,0.10)]">
                    <p className="text-[0.6875rem] text-v2-text-muted px-2.5 pt-0.5 pb-1">目标水平</p>
                    {LEVELS.map(lv => (
                      <button
                        key={lv}
                        onClick={() => onSelectLevel(lv)}
                        role="option"
                        aria-selected={lv === level}
                        className={`flex items-center w-full text-[0.8125rem] px-2.5 py-[7px] rounded-[9px] active:bg-bg-muted ${lv === level ? 'text-brand-primary-dark font-medium' : 'text-v2-text-secondary'}`}
                      >
                        {lv}
                        {lv === level && <Check size={13} className="ml-auto text-brand-primary" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* aria-live：换档后词组整体被替换，读屏用户否则感知不到内容已变（先例 PracticeDesktop 消息列表） */}
            {phrasesLoading ? (
              <p aria-live="polite" className="flex-1 flex items-center justify-center text-[0.75rem] text-v2-text-muted">正在按雅思 {level} 出词组…</p>
            ) : (
            // 卡片已定高：词组多 / 详情卡展开一律不撑高外层，全部在本容器内滚动
            // （min-h-0 让 flex 子项可收缩、触发 overflow）；pr-1 给滚动条留位
            <div aria-live="polite" className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3.5 pr-1">
              {/* 换档失败（20s 超时/网络断）：行内失败态 + 重试，复用本容器既有 aria-live 播报；
                  下方仍是原档位词组（换档失败不清空已有内容） */}
              {phrasesError !== null && (
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-[0.75rem] text-error leading-[1.5]">网络原因没能拿到词组，点一下重试</p>
                  <button
                    type="button"
                    onClick={onRetryPhrases}
                    className="btn-ghost h-[44px] px-4 shrink-0 transition-[border-color,transform] duration-150 hover:border-black/25 active:scale-[0.97]"
                  >
                    重试
                  </button>
                </div>
              )}
              {(data.analysis.phrases ?? []).map((g, gi) => {
                const [og, oi] = openPhrase ? openPhrase.split('-').map(Number) : [-1, -1]
                const openItem = og === gi ? g.items[oi] : null
                return (
                  <div key={gi}>
                    <p className="text-[0.6875rem] font-medium text-v2-text-muted mb-2">{g.group}</p>
                    <div className="flex flex-wrap gap-2">
                      {g.items.map((p, ii) => {
                        const isOpen = openPhrase === `${gi}-${ii}`
                        return (
                          <button
                            key={ii}
                            onClick={() => onTogglePhrase(isOpen ? null : `${gi}-${ii}`)}
                            aria-expanded={isOpen}
                            aria-controls={isOpen ? `phrase-detail-${gi}-${ii}` : undefined}
                            className={`text-[0.8125rem] rounded-full px-[11px] py-[5px] leading-[1.3] border whitespace-nowrap transition-transform duration-150 hover:-translate-y-[2px] active:scale-[0.97] ${PHRASE_CHIP_STYLES[gi % PHRASE_CHIP_STYLES.length]} ${isOpen ? 'ring-2 ring-brand-primary/25' : ''}`}
                          >
                            {p.text}
                            {savedSet.has(p.text) && (
                              <Star size={11} className="inline-block ml-1 -mt-[2px] align-middle fill-brand-primary text-brand-primary" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                    {openItem && (
                      <div ref={detailRef} className="mt-2.5">
                        <PhraseDetailCard
                          id={`phrase-detail-${gi}-${oi}`}
                          text={openItem.text}
                          meaning={openItem.meaning}
                          scene={openItem.scene}
                          isSaved={savedSet.has(openItem.text)}
                          onToggleSave={() => onToggleSave(openItem, g.group)}
                          onClose={() => onTogglePhrase(null)}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            )}
          </GradCard>
        </div>

        {/* 底部：开始练习（居中，hover 轻微浮起）+ 桌面快捷键提示 */}
        <div className="mt-8 flex flex-col items-center gap-3">
          <GradientButton
            onClick={onStartPractice}
            className="flex items-center justify-center gap-1.5 px-8 py-3 rounded-full text-[0.9375rem] font-medium transition-[transform,box-shadow] duration-200 hover:-translate-y-[2px] hover:shadow-[0_8px_22px_rgba(0,0,0,0.09)]"
          >
            开始练习 →
          </GradientButton>
          <p className="text-[0.75rem] text-v2-text-muted">Enter 或 → 进入练习 · Esc 退出</p>
        </div>
      </div>
    </div>
  )
}
