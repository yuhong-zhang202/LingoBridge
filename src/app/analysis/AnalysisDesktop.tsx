/**
 * @module   AnalysisDesktop
 * @desc     题目分析页桌面视图（split 档）—— FlowShellDesktop 沉浸外壳内的两栏舞台：
 *           顶部跨栏题目卡，下方 max-w-[960px] grid-cols-2「左 考官侧重点 | 右 可用词组」左右并置一眼对照，
 *           底部居中「开始练习」CTA。水平下拉 / 词组详情 / 收藏逻辑经 props 由 page.tsx 外壳下发。
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
  'bg-[#EDF6EB] text-[#3D7A38] border-[#C0DDB9]',
  'bg-phrase-blue-bg text-phrase-blue-text border-phrase-blue-border',
]

/** 可选雅思口语目标水平 */
const LEVELS = ['5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0']

/** 舞台最小高度：满屏减去外壳 72px 顶栏 */
const STAGE = 'min-h-[calc(100vh-72px)]'

/** 序号圆圈：外层极淡渐变描边 + 内层白底 + 灰色数字 */
function StepNum({ n }: { n: number }) {
  return (
    <div style={{ background: BRAND_GRADIENT_SOFT, padding: 1, borderRadius: '50%', width: 20, height: 20, flexShrink: 0 }}>
      <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
        <span className="text-[11px] font-bold leading-none text-[#A0A09A]">{n}</span>
      </div>
    </div>
  )
}

/** 渐变描边卡片 — 极淡 1px 渐变 border + 白底内层。
 *  桌面 split 两栏等高：h-full + min-h 让「侧重点 | 词组」高度一致，消除底部参差。 */
function GradCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card variant="gradient" className={cn('px-[22px] pt-[18px] pb-[22px] h-full flex flex-col min-h-[340px]', className)}>
      {children}
    </Card>
  )
}

export default function AnalysisDesktop({
  data, loading, error, level, levelMenuOpen, phrasesLoading, openPhrase, savedSet,
  onRetry, onToggleLevelMenu, onSelectLevel, onTogglePhrase, onToggleSave, onStartPractice, onExit,
}: AnalysisViewProps) {

  // 键盘：Enter / → 进入练习、Esc 退出（仅桌面断点、有结果时才挂；焦点在输入类元素时不拦截）
  const ready = !loading && !error && !!data
  const latest = useRef({ onStartPractice, onExit, levelMenuOpen, onToggleLevelMenu })
  latest.current = { onStartPractice, onExit, levelMenuOpen, onToggleLevelMenu }
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
      // Enter/→ 交还给聚焦的原生控件（按钮 / 下拉项）自行激活，不劫持去练习
      if ((e.key === 'Enter' || e.key === 'ArrowRight') && t?.closest('button, a, [role="button"]')) return
      if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); s.onStartPractice() }
      else if (e.key === 'Escape') { s.onExit() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready])

  if (loading) {
    return (
      <div className={`${STAGE} flex flex-col justify-center px-8 py-12`}>
        <div className="w-full max-w-[960px] mx-auto">
          {/* 题目卡骨架 */}
          <Card className="px-[22px] pt-[16px] pb-[22px]">
            <div className="flex items-center gap-2">
              <Skeleton className="w-12 h-[18px] rounded-full" />
              <Skeleton className="w-14 h-[18px] rounded-full" />
            </div>
            <Skeleton className="w-[70%] h-[14px] mt-3" />
            <Skeleton className="w-1/3 h-3 mt-2" />
          </Card>
          <div className="grid grid-cols-2 gap-8 items-stretch mt-6">
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
        <div className="mb-6 flex items-center justify-center gap-2 text-[13px] text-v2-text-muted">
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
          <p className="text-[17px] font-semibold text-v2-text-primary leading-[1.5] mb-1.5">{data.question.en}</p>
          <p className="text-[13px] text-v2-text-muted">{data.question.zh}</p>
        </Card>

        {/* split 档：左 考官侧重点 | 右 可用词组，天然成对左右并置、等高对照 */}
        <div className="grid grid-cols-2 gap-8 items-stretch mt-6">

          {/* 左栏：考官侧重点 */}
          <GradCard>
            <div className="flex items-center gap-1.5 mb-2">
              <Target size={13} className="text-brand-primary" />
              <span className="text-[13px] font-semibold text-v2-text-secondary">答题侧重点</span>
            </div>
            {data.analysis.structureLabel && (
              <p className="text-[11px] text-v2-text-muted font-medium leading-[1.7] mb-4">{data.analysis.structureLabel}</p>
            )}
            {/* flex-1 + justify-center：等高卡内把侧重点纵向居中，多出的高度化为呼吸留白 */}
            <div className="flex-1 flex flex-col justify-center gap-5">
              {data.analysis.focusPoints.map((fp, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <StepNum n={i + 1} />
                  <div className="flex-1 pt-[1px]">
                    <p className="text-[14px] font-medium text-v2-text-primary leading-[1.6]">{fp.title}</p>
                    <p className="text-[12px] text-v2-text-muted mt-1 leading-relaxed">{fp.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </GradCard>

          {/* 右栏：可用词组（含水平下拉，向下展开不被容器裁切） */}
          <GradCard>
            <div className="flex items-center gap-1.5 mb-3">
              <Type size={13} className="text-brand-accent" />
              <span className="text-[13px] font-semibold text-v2-text-secondary">可用词组</span>
              <div className="relative ml-auto">
                <button
                  onClick={onToggleLevelMenu}
                  disabled={phrasesLoading}
                  className="flex items-center gap-1 text-[12px] text-brand-primary-dark bg-white border border-brand-primary-light rounded-full pl-2.5 pr-1.5 py-[4px] leading-none active:scale-[0.97] transition-transform duration-150 disabled:opacity-50"
                >
                  雅思 {level}
                  <ChevronDown size={13} className={`transition-transform duration-150 ${levelMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {levelMenuOpen && (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-[110px] bg-white border border-black/[0.08] rounded-[14px] p-1.5 shadow-[0_6px_20px_rgba(0,0,0,0.10)]">
                    <p className="text-[11px] text-v2-text-muted px-2.5 pt-0.5 pb-1">目标水平</p>
                    {LEVELS.map(lv => (
                      <button
                        key={lv}
                        onClick={() => onSelectLevel(lv)}
                        className={`flex items-center w-full text-[13px] px-2.5 py-[7px] rounded-[9px] active:bg-bg-muted ${lv === level ? 'text-brand-primary-dark font-medium' : 'text-v2-text-secondary'}`}
                      >
                        {lv}
                        {lv === level && <Check size={13} className="ml-auto text-brand-primary" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {phrasesLoading ? (
              <p className="flex-1 flex items-center justify-center text-[12px] text-v2-text-muted">正在按雅思 {level} 出词组…</p>
            ) : (
            // 词组多时不撑高卡片：max-h 封顶 + 卡内滚动（min-h-0 让 flex 子项可收缩、触发 overflow）；pr-1 给滚动条留位
            <div className="flex-1 min-h-0 max-h-[440px] overflow-y-auto flex flex-col gap-3.5 pr-1">
              {(data.analysis.phrases ?? []).map((g, gi) => {
                const [og, oi] = openPhrase ? openPhrase.split('-').map(Number) : [-1, -1]
                const openItem = og === gi ? g.items[oi] : null
                return (
                  <div key={gi}>
                    <p className="text-[11px] font-medium text-v2-text-muted mb-2">{g.group}</p>
                    <div className="flex flex-wrap gap-2">
                      {g.items.map((p, ii) => {
                        const isOpen = openPhrase === `${gi}-${ii}`
                        return (
                          <button
                            key={ii}
                            onClick={() => onTogglePhrase(isOpen ? null : `${gi}-${ii}`)}
                            className={`text-[13px] rounded-full px-[11px] py-[5px] leading-[1.3] border whitespace-nowrap transition-transform duration-150 hover:-translate-y-[2px] active:scale-[0.97] ${PHRASE_CHIP_STYLES[gi % PHRASE_CHIP_STYLES.length]} ${isOpen ? 'ring-2 ring-brand-primary/25' : ''}`}
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
                      <div className="mt-2.5">
                        <PhraseDetailCard
                          text={openItem.text}
                          meaning={openItem.meaning}
                          scene={openItem.scene}
                          isSaved={savedSet.has(openItem.text)}
                          onToggleSave={() => onToggleSave(openItem, g.group)}
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
            className="flex items-center justify-center gap-1.5 px-8 py-3 rounded-full text-[15px] font-medium transition-all duration-200 hover:-translate-y-[2px] hover:shadow-[0_8px_22px_rgba(0,0,0,0.09)]"
          >
            开始练习 →
          </GradientButton>
          <p className="text-[12px] text-v2-text-muted">Enter 或 → 进入练习 · Esc 退出</p>
        </div>
      </div>
    </div>
  )
}
