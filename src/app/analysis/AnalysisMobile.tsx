/**
 * @module   AnalysisMobile
 * @desc     题目分析页移动端视图 —— 现有移动端版式原样搬入、改接 props 的纯展示组件（视觉与逻辑一字不改）。
 *           TopBar + StepBar、题目卡、答题侧重点、可用词组（水平下拉 / 词组详情 / 收藏）、开始练习、TabBar。
 * @author   LingoBridge
 * @created  2026-05-28
 */
'use client'
import type { ReactNode } from 'react'
import { Target, Type, ChevronDown, Check, Star } from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import { StepBar } from '@/components/StepBar'
import PartTag from '@/components/PartTag'
import Tag from '@/components/Tag'
import EmptyState from '@/components/EmptyState'
import OfflineState from '@/components/OfflineState'
import Card from '@/components/Card'
import GradientButton from '@/components/GradientButton'
import Skeleton from '@/components/Skeleton'
import PhraseDetailCard from '@/components/analysis/PhraseDetailCard'
import { BRAND_GRADIENT_SOFT } from '@/lib/constants'
import type { AnalysisViewProps } from './types'

/** 词组分组配色：按组循环（暖橙 / 标准绿 / 雾青蓝），浅柔色调。
 *  暖橙复用 brand-primary；绿沿用全局标准强调绿；雾青为新增 token。*/
const PHRASE_CHIP_STYLES = [
  'bg-phrase-warm-bg text-brand-primary-dark border-brand-primary-light',
  'bg-tag-success-bg text-tag-success-text border-tag-success-border',
  'bg-phrase-blue-bg text-phrase-blue-text border-phrase-blue-border',
]

/** 可选雅思口语目标水平 */
const LEVELS = ['5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0']

/** 序号圆圈：外层极淡渐变描边 + 内层白底 + 灰色数字 */
function StepNum({ n }: { n: number }) {
  return (
    <div style={{ background: BRAND_GRADIENT_SOFT, padding: 1, borderRadius: '50%', width: 20, height: 20, flexShrink: 0 }}>
      <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
        <span className="text-[0.6875rem] font-bold leading-none text-neutral-mid">{n}</span>
      </div>
    </div>
  )
}

/** 渐变描边卡片 — 极淡 1px 渐变 border + 白底内层 */
function GradCard({ children }: { children: ReactNode }) {
  return <Card variant="gradient" className="px-[22px] pt-[16px] pb-[22px]">{children}</Card>
}

export default function AnalysisMobile({
  data, loading, error, dailyLimitHit, level, levelMenuOpen, phrasesLoading, openPhrase, savedSet,
  onRetry, onToggleLevelMenu, onSelectLevel, onTogglePhrase, onToggleSave, onStartPractice, onReviewCards, onBack,
}: AnalysisViewProps) {
  return (
    <div
      className="relative flex flex-col bg-bg-page overflow-hidden"
      style={{ height: '100dvh', paddingBottom: 'calc(56px + env(safe-area-inset-bottom))' }}
    >
      <TopBar title="题目分析" onBack={onBack} />
      <StepBar currentStep="analysis" />

      {/* 加载态用 Fragment 无容器可挂，故 aria-busy 挂在常驻滚动区、随 loading 切换 */}
      <div aria-busy={loading} className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-8 relative z-10 flex flex-col gap-4 lg:max-w-5xl lg:mx-auto lg:w-full lg:px-10">

        {loading && (
          <>
            {/* 题目卡骨架 */}
            <Card className="px-[22px] pt-[16px] pb-[22px]">
              <div className="flex items-center gap-2">
                <Skeleton className="w-12 h-[18px] rounded-full" />
                <Skeleton className="w-14 h-[18px] rounded-full" />
              </div>
              <Skeleton className="w-[90%] h-[14px] mt-3" />
              <Skeleton className="w-1/2 h-3 mt-2" />
            </Card>

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
          </>
        )}
        {/* 当日上限（429）：必须排在 error 分支之前，且不给「重试」——重试只会再撞 429。
            文案只说「明天恢复」不写具体时刻：服务端计次日界是 UTC 还是本地未核实，不精确化。 */}
        {!loading && dailyLimitHit && (
          <EmptyState
            title="操作太频繁，今天先歇歇吧"
            subtitle="明天会自动恢复。收藏过的词卡随时可以回顾。"
            ctaLabel="回顾词卡"
            onCta={onReviewCards}
            orbSize={100}
            alert
            ctaVariant="text"
          />
        )}

        {!loading && !dailyLimitHit && error && (
          typeof navigator !== 'undefined' && !navigator.onLine ? (
            <OfflineState onRetry={onRetry} />
          ) : (
            <EmptyState
              title="分析没生成出来"
              subtitle="刚才好像没连上，点下面再试一次就好。"
              ctaLabel="重试"
              onCta={onRetry}
              orbSize={100}
            />
          )
        )}

        {!loading && !error && data && (
          <>
            {/* 题目卡片 */}
            <Card className="px-[22px] pt-[16px] pb-[22px]">
              <div className="flex items-center gap-2 mb-2.5">
                <PartTag label={`Part ${data.question.part}`} />
                {data.question.dimension && <Tag variant="green" label={data.question.dimension} />}
                {data.question.isNew && <Tag variant="green" label="当季新题" />}
              </div>
              <p className="text-[0.875rem] font-medium text-v2-text-primary leading-[1.6] mb-1">{data.question.en}</p>
              <p className="text-[0.75rem] text-v2-text-muted">{data.question.zh}</p>
            </Card>

            {/* 桌面端：答题侧重点 | 可用词组 两栏（参照 web.html analysis-view）；移动端单列堆叠 */}
            <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">

            {/* 答题侧重点 */}
            <GradCard>
              <div className="flex items-center gap-1.5 mb-2">
                <Target size={13} className="text-brand-primary" />
                <span className="text-[0.8125rem] font-semibold text-v2-text-secondary">答题侧重点</span>
              </div>
              {data.analysis.structureLabel && (
                <p className="text-[0.6875rem] text-v2-text-muted font-medium leading-[1.7] mb-4">{data.analysis.structureLabel}</p>
              )}
              <div className="flex flex-col gap-4">
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
            </GradCard>

            {/* 可用词组（按答案分段分组，可直接取用） */}
            <GradCard>
              <div className="flex items-center gap-1.5 mb-3">
                <Type size={13} className="text-brand-accent" />
                <span className="text-[0.8125rem] font-semibold text-v2-text-secondary">可用词组</span>
                <div className="relative ml-auto">
                  <button
                    onClick={onToggleLevelMenu}
                    disabled={phrasesLoading}
                    className="flex items-center gap-1 text-[0.75rem] text-brand-primary-dark bg-white border border-brand-primary-light rounded-full pl-2.5 pr-1.5 py-[4px] leading-none active:scale-[0.97] transition-transform duration-150 disabled:opacity-50"
                  >
                    雅思 {level}
                    <ChevronDown size={13} className={`transition-transform duration-150 ${levelMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {levelMenuOpen && (
                    <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-[110px] bg-white border border-black/[0.08] rounded-[14px] p-1.5 shadow-[0_6px_20px_rgba(0,0,0,0.10)]">
                      <p className="text-[0.6875rem] text-v2-text-muted px-2.5 pt-0.5 pb-1">目标水平</p>
                      {LEVELS.map(lv => (
                        <button
                          key={lv}
                          onClick={() => onSelectLevel(lv)}
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
                <p aria-live="polite" className="text-[0.75rem] text-v2-text-muted text-center py-4">正在按雅思 {level} 出词组…</p>
              ) : (
              <div aria-live="polite" className="flex flex-col gap-3.5">
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
                              className={`text-[0.8125rem] rounded-full px-[11px] py-[5px] leading-[1.3] border whitespace-nowrap active:scale-[0.97] transition-transform duration-150 ${PHRASE_CHIP_STYLES[gi % PHRASE_CHIP_STYLES.length]} ${isOpen ? 'ring-2 ring-brand-primary/25' : ''}`}
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
            </div>{/* /两栏 wrapper */}

            <GradientButton
              onClick={onStartPractice}
              className="w-full flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-full text-[0.875rem] font-medium lg:max-w-[480px] lg:mx-auto"
            >
              开始练习 →
            </GradientButton>
          </>
        )}
      </div>

      {/* 流程页桌面端沉浸：隐藏侧栏 */}
      <div className="lg:hidden"><TabBar /></div>
    </div>
  )
}
