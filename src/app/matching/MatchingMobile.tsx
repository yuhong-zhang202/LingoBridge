/**
 * @module   MatchingMobile
 * @desc     题目匹配页移动端视图 —— 现有移动端版式原样搬入、改接 props 的纯展示组件（视觉与逻辑一字不改）。
 *           TopBar + StepBar、匹配标题/识别维度、副维度降级说明、动态 Part 筛选、三档分组、查看更多折叠、
 *           noMatch 温柔收尾、TabBar 全部照旧。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'
import TabBar from '@/components/TabBar'
import Card from '@/components/Card'
import Chip from '@/components/Chip'
import Skeleton from '@/components/Skeleton'
import EmptyState from '@/components/EmptyState'
import OfflineState from '@/components/OfflineState'
import MatchedQuestionCard from '@/components/matching/MatchedQuestionCard'
import NoMatchView from '@/components/matching/NoMatchView'
import type { MatchingViewProps } from './types'

/** 分组标题行：label + 横线 */
function GroupHeader({ label, count, variant }: {
  label: string
  count: number
  variant: 'high' | 'mid' | 'low'
}) {
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

export default function MatchingMobile({
  result, loading, error, totalVisible, availableTabs, activeTab,
  highGroup, midGroup, lowGroup, foldedCount, hasMore, noneVisible, globalNoneVisible,
  selectedId, expanded,
  onSelectTab, onToggleSelect, onToggleExpanded, onPractice, onRetry,
}: MatchingViewProps & { globalNoneVisible: boolean }) {
  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col">
      <TopBar title="题目匹配" />
      <StepBar currentStep="matching" />

      <div className="flex-1 overflow-y-auto px-5 pb-[72px] relative z-10 lg:max-w-3xl lg:mx-auto lg:w-full lg:px-10 lg:pb-10">

        {loading && (
          <div className="pt-2" aria-busy="true">
            {/* 标题骨架 */}
            <div className="mb-4">
              <Skeleton className="w-3/5 h-[20px]" />
              <Skeleton className="w-2/5 h-3 mt-2.5" />
            </div>

            {/* Part 筛选骨架 */}
            <div className="flex gap-2 mb-5">
              <Skeleton className="w-12 h-[26px] rounded-full" />
              <Skeleton className="w-16 h-[26px] rounded-full" />
              <Skeleton className="w-16 h-[26px] rounded-full" />
            </div>

            {/* 题卡骨架 ×3 */}
            <div className="flex flex-col gap-2.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-white rounded-[14px] border border-black/[0.05] shadow-[0_1px_8px_rgba(0,0,0,0.06)] p-4">
                  <div className="flex items-center gap-2">
                    <Skeleton className="w-12 h-[18px] rounded-full" />
                    <Skeleton className="w-14 h-[18px] rounded-full" />
                  </div>
                  <Skeleton className="w-[90%] h-[15px] mt-3" />
                  <Skeleton className="w-1/2 h-3 mt-2" />
                  <div className="flex justify-end mt-3">
                    <Skeleton className="w-20 h-7 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && error && (
          typeof navigator !== 'undefined' && !navigator.onLine ? (
            <OfflineState onRetry={onRetry} />
          ) : (
            <EmptyState
              title="题目没匹配出来"
              subtitle="刚才好像没连上，点下面再试一次就好。"
              ctaLabel="重试"
              onCta={onRetry}
              orbSize={100}
            />
          )
        )}

        {/* noMatch（真没题）与 globalNoneVisible（有题但全部低分被隐藏）统一升级为 NoMatchView 引导 */}
        {!loading && !error && result && (result.noMatch || globalNoneVisible) && (
          <NoMatchView
            primaryDimension={result.primary?.dimension ?? ''}
            primaryPointName={result.primary?.pointName ?? ''}
            variant={result.noMatch ? 'noMatch' : 'lowScore'}
          />
        )}

        {!loading && !error && result && !result.noMatch && !globalNoneVisible && (
          <>
            {/* 匹配标题 + 识别出的维度 */}
            <div className="mb-4">
              <h2 className="text-[20px] font-bold text-v2-text-primary">匹配到 {totalVisible} 道当季真题</h2>
              {result.primary && (
                <p className="text-[12px] text-v2-text-muted mt-1">
                  识别维度：{result.primary.dimension} · {result.primary.pointName}
                  {result.secondary && ` ／ ${result.secondary.dimension} · ${result.secondary.pointName}`}
                </p>
              )}
            </div>

            {/* 副维度降级说明 */}
            {result.matchedViaSecondary && result.secondary && (
              <Card className="px-4 py-3 mb-4">
                <p className="text-[13px] text-v2-text-primary leading-snug mb-1">
                  暂时没匹配到完全契合的雅思真题
                </p>
                <p className="text-[12px] text-v2-text-secondary leading-relaxed">
                  不过把重点放在{' '}
                  <span className="text-brand-primary-dark font-medium">
                    {result.secondary.dimension} · {result.secondary.pointName}
                  </span>
                  {' '}这个方向上，这些题目同样值得练
                </p>
              </Card>
            )}

            {/* Part 筛选（动态，只出现有结果的 Part） */}
            <div className="flex gap-2 mb-5 flex-wrap">
              {availableTabs.map((p) => (
                <Chip key={p} onClick={() => onSelectTab(p)} variant="ghost" active={activeTab === p}>
                  {p}
                </Chip>
              ))}
            </div>

            {/* 三档分组展示 */}
            <div className="mb-6">

              {/* 高匹配组：默认展示 */}
              {highGroup.length > 0 && (
                <div>
                  <GroupHeader label="高匹配" count={highGroup.length} variant="high" />
                  <div className="flex flex-col gap-3">
                    {highGroup.map((q) => (
                      <MatchedQuestionCard
                        key={q.id}
                        question={q}
                        selected={selectedId === q.id}
                        onToggle={() => onToggleSelect(q.id)}
                        onPractice={() => onPractice(q.id)}
                        isPrimaryMatch={q.isPrimaryMatch}
                        isHighMatch={true}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 展开后：中匹配组 */}
              {expanded && midGroup.length > 0 && (
                <div className="mt-5">
                  <GroupHeader label="中匹配" count={midGroup.length} variant="mid" />
                  <div className="flex flex-col gap-3">
                    {midGroup.map((q) => (
                      <MatchedQuestionCard
                        key={q.id}
                        question={q}
                        selected={selectedId === q.id}
                        onToggle={() => onToggleSelect(q.id)}
                        onPractice={() => onPractice(q.id)}
                        isPrimaryMatch={q.isPrimaryMatch}
                        isHighMatch={false}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 展开后：低匹配组 */}
              {expanded && lowGroup.length > 0 && (
                <div className="mt-5">
                  <GroupHeader label="低匹配" count={lowGroup.length} variant="low" />
                  <div className="flex flex-col gap-3">
                    {lowGroup.map((q) => (
                      <MatchedQuestionCard
                        key={q.id}
                        question={q}
                        selected={selectedId === q.id}
                        onToggle={() => onToggleSelect(q.id)}
                        onPractice={() => onPractice(q.id)}
                        isPrimaryMatch={q.isPrimaryMatch}
                        isHighMatch={false}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 空态 */}
              {noneVisible && (
                <div className="text-center text-[13px] text-v2-text-muted py-10">该 Part 暂无匹配题目</div>
              )}
            </div>

            {/* 查看更多 / 收起 toggle（中 + 低匹配折叠区） */}
            {hasMore && (
              <div className="text-center mb-6">
                <button
                  onClick={onToggleExpanded}
                  className="text-[13px] font-medium text-brand-primary active:opacity-60"
                >
                  {expanded ? '收起 ↑' : `查看更多 ${foldedCount} 道 →`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 流程页桌面端沉浸：隐藏侧栏 */}
      <div className="relative z-20 flex-shrink-0 lg:hidden"><TabBar /></div>
    </div>
  )
}
