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
import LowMatchView from '@/components/matching/LowMatchView'
import MatchingProgress from '@/components/matching/MatchingProgress'
import type { MatchingViewProps, FunnelQuestion } from './types'

/** 分组标题行：label + 横线 */
function GroupHeader({ label, count, variant }: {
  label: string
  count: number
  variant: 'high' | 'mid'
}) {
  const textClass =
    // 高匹配分组标题改 -dark 变体：brand-accent 对白底仅 2.7:1（不达 WCAG AA），brand-accent-dark 达标
    variant === 'high' ? 'text-brand-accent-dark font-semibold'
    : variant === 'mid' ? 'text-v2-text-secondary font-medium'
    : 'text-v2-text-muted font-medium'

  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={`text-[0.6875rem] ${textClass}`}>{label} · {count} 道</span>
      <div className="flex-1 h-px bg-black/[0.05]" />
    </div>
  )
}

export default function MatchingMobile({
  result, loading, error, dailyLimitHit, totalVisible, availableTabs, activeTab,
  highGroup, midGroup, foldedCount, hasMore, noneVisible, globalNoneVisible, rankingDegraded, lowShown,
  selectedId, expanded, savedIds, savingId,
  onSelectTab, onToggleSelect, onToggleExpanded, onPractice, onSavePair, onRetry, onBack, onExit,
}: MatchingViewProps & { globalNoneVisible: boolean; rankingDegraded: boolean; lowShown: FunnelQuestion[] }) {
  // 单题存对子三态：进行中 > 已存 > 未存（saving 优先于 saved，避免刚点完瞬间闪回未存）
  const saveStateOf = (id: string): 'idle' | 'saving' | 'saved' =>
    savingId === id ? 'saving' : savedIds.has(id) ? 'saved' : 'idle'
  // 空态四支互斥判定（顺序即优先级，见 page.tsx 决策树）：真没题 A 类 → 机制①降级 → B 类低相关 → 正常首屏。
  // 降级支【优先于】B 类，且兜住「globalNoneVisible 但无低分可展示」这一等价于机制①的组合，杜绝「文案+零张卡」空洞。
  const isNoMatch = !!result && result.noMatch
  const isDegraded = !!result && !result.noMatch && (rankingDegraded || (globalNoneVisible && lowShown.length === 0))
  const isLowMatch = !!result && !result.noMatch && !isDegraded && globalNoneVisible   // 走到这里 lowShown.length>0 必然成立
  const isNormal = !!result && !result.noMatch && !isDegraded && !globalNoneVisible
  return (
    <div className="relative h-dvh overflow-hidden bg-bg-page flex flex-col">
      <TopBar title="题目匹配" onBack={onBack} />
      <StepBar currentStep="matching" />

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-[calc(72px_+_env(safe-area-inset-bottom))] relative z-10 lg:max-w-3xl lg:mx-auto lg:w-full lg:px-10 lg:pb-10">

        {loading && (
          <div className="pt-2" aria-busy="true">
            {/* 分阶段进度：匹配要跑 20–47 秒真实模型调用，光一块不动的骨架屏用户无从判断是在跑还是卡死 */}
            <MatchingProgress className="mb-5" />

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

        {/* 当日上限（429）：必须排在 error 分支之前，且不给「重试」——重试只会再撞 429。
            文案只说「明天恢复」不写具体时刻：服务端计次日界是 UTC 还是本地未核实，不精确化。 */}
        {!loading && dailyLimitHit && (
          <EmptyState
            title="操作太频繁，今天先歇歇吧"
            subtitle="明天会自动恢复。已经匹配过的题目仍然可以打开。"
            ctaLabel="回首页"
            onCta={onExit}
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
              title="题目没匹配出来"
              subtitle="刚才好像没连上，点下面再试一次就好。"
              ctaLabel="重试"
              onCta={onRetry}
              orbSize={100}
            />
          )
        )}

        {/* A 类·真没题（三层漏斗全空）：NoMatchView 换故事引导，一字不动 */}
        {!loading && !error && isNoMatch && result && (
          <NoMatchView
            primaryDimension={result.primary?.dimension ?? ''}
            primaryPointName={result.primary?.pointName ?? ''}
            variant="noMatch"
          />
        )}

        {/* 机制①降级·重排一分没产出（无分可展示）：不走 NoMatchView 换故事，给「重试」复用 onRetry 重新匹配 */}
        {!loading && !error && isDegraded && (
          <EmptyState
            title="排序暂时不可用"
            subtitle="题目匹配好了，但排序没算出来。点下面重试一下就好。"
            ctaLabel="重试"
            onCta={onRetry}
            orbSize={100}
          />
        )}

        {/* B 类·低相关兜底展示（候选有分但全部 < SCORE_MID）：如实展示最相关的前几道 + 换故事出口 */}
        {!loading && !error && isLowMatch && result && (
          <LowMatchView
            primary={result.primary}
            secondary={result.secondary}
            lowShown={lowShown}
            selectedId={selectedId}
            savedIds={savedIds}
            savingId={savingId}
            onToggleSelect={onToggleSelect}
            onPractice={onPractice}
            onSavePair={onSavePair}
            onExit={onExit}
          />
        )}

        {!loading && !error && isNormal && result && (
          <>
            {/* 匹配标题 + 识别出的维度 */}
            <div className="mb-4">
              <h2 className="text-[1.25rem] font-bold text-v2-text-primary">匹配到 {totalVisible} 道当季真题</h2>
              {result.primary && (
                <p className="text-[0.75rem] text-v2-text-muted mt-1">
                  识别维度：{result.primary.dimension} · {result.primary.pointName}
                  {result.secondary && ` ／ ${result.secondary.dimension} · ${result.secondary.pointName}`}
                </p>
              )}
            </div>

            {/* 副维度降级说明 */}
            {result.matchedViaSecondary && result.secondary && (
              <Card className="px-4 py-3 mb-4">
                <p className="text-[0.8125rem] text-v2-text-primary leading-snug mb-1">
                  暂时没匹配到完全契合的雅思真题
                </p>
                <p className="text-[0.75rem] text-v2-text-secondary leading-relaxed">
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
                        saveState={saveStateOf(q.id)}
                        onSave={() => onSavePair(q.id)}
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
                        saveState={saveStateOf(q.id)}
                        onSave={() => onSavePair(q.id)}
                      />
                    ))}
                  </div>
                </div>
              )}


              {/* 空态 */}
              {noneVisible && (
                <div className="text-center text-[0.8125rem] text-v2-text-muted py-10">该 Part 暂无匹配题目</div>
              )}
            </div>

            {/* 查看更多 / 收起 toggle（折叠区 = 中匹配）。autoExpand 时不渲染：见 page.tsx 的 showToggle */}
            {hasMore && (
              <div className="text-center mb-6">
                <button
                  onClick={onToggleExpanded}
                  className="min-h-[44px] inline-flex items-center justify-center px-3 text-[0.8125rem] font-medium text-brand-primary-dark active:opacity-60"
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
