/**
 * @module   MatchingMobile
 * @desc     题目匹配页移动端视图 —— 【统一骨架】：从进入匹配页到结果到齐，页面结构一次都不重建。
 *           五槽与桌面一一对应：① 头部（状态化标题 + 识别维度副行）② 状态说明卡 ③ Part 筛选槽
 *           ④ 列表区 ⑤ 底部动作槽。八种状态只换槽内内容，绝不整页互换。
 *
 *   为什么这样改：旧代码把 loading / 429 / error / noMatch / degraded / lowMatch / 正常七种情况写成七段
 *   并列的条件渲染，用户看到的是七张不同的页；等待期还会先显示「匹配到 0 道当季真题」再整页跳变。
 *   顺带修掉 F3：那七段里有四段只守了 `!loading && !error`、漏了 `!dailyLimitHit`，
 *   于是手机上会出现「今天先歇歇吧」和「匹配到 3 道」+ 可点题卡同屏并列（桌面是 early return 所以没有）。
 *   新骨架里 phase 天然互斥，同一时刻只有一套内容。
 *
 *   ⚠️ 本文件【不做形态判定】，只读 props.phase（真源在 app/matching/phase.ts，带单测）。
 *   noMatch / degraded / error / limit 四个终态经产品方真机验收拍板删掉了列表区的 orb 说明块
 *   （与上方标题/说明卡重复），这四态列表区留白，动作collapse到底部动作槽。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { type JSX } from 'react'
import TopBar from '@/components/TopBar'
import { StepBar } from '@/components/StepBar'
import TabBar from '@/components/TabBar'
import Chip from '@/components/Chip'
import Skeleton from '@/components/Skeleton'
import GradientButton from '@/components/GradientButton'
import MatchedQuestionCard from '@/components/matching/MatchedQuestionCard'
import MatchStatusNote, { matchTitle, MatchDimensionLine } from '@/components/matching/MatchStatusNote'
import type { MatchingViewProps } from './types'

/** 分组标题行：完整文本 + 横线（文本由调用方组装，低相关那一组不是「X · N 道」的形状） */
function GroupHeader({ text, variant }: { text: string; variant: 'high' | 'mid' | 'low' }): JSX.Element {
  const textClass =
    // 高匹配分组标题用 -dark 变体：brand-accent 对白底仅 2.7:1（不达 WCAG AA）
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

/** 单张骨架题卡（等待期占位，读屏一律忽略） */
function SkeletonCard(): JSX.Element {
  return (
    <div className="bg-white rounded-[14px] border border-black/[0.05] shadow-[0_1px_8px_rgba(0,0,0,0.06)] p-4">
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
  )
}

export default function MatchingMobile({
  phase, result, missingCorpus, candidateCount, arrivedCount, slowHint,
  totalVisible, hasHigh, availableTabs, activeTab,
  highGroup, midGroup, foldedCount, hasMore, noneVisible, lowShown,
  selectedId, expanded, savedIds, savingId,
  onSelectTab, onToggleSelect, onToggleExpanded, onPractice, onSavePair, onRetry, onBack, onExit,
}: MatchingViewProps): JSX.Element {
  // 单题存对子三态：进行中 > 已存 > 未存（saving 优先于 saved，避免刚点完瞬间闪回未存）
  const saveStateOf = (id: string): 'idle' | 'saving' | 'saved' =>
    savingId === id ? 'saving' : savedIds.has(id) ? 'saved' : 'idle'
  const pending = phase === 'waiting' || phase === 'streaming'
  const isLow = phase === 'lowMatch'
  const hasCards = phase === 'streaming' || phase === 'result'

  return (
    <div className="relative h-dvh overflow-hidden bg-bg-page flex flex-col">
      <TopBar title="题目匹配" onBack={onBack} />
      <StepBar currentStep="matching" />

      {/* aria-busy 覆盖整个等待期（含 streaming）：此前只在 loading 期间挂，而 loading 在第一个
          question 帧就变 false，正好把最长的那段等待漏在外面。 */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-5 pb-[calc(72px_+_env(safe-area-inset-bottom))] relative z-10 lg:max-w-3xl lg:mx-auto lg:w-full lg:px-10 lg:pb-10"
        aria-busy={pending}
      >
        {/* ① 头部（恒在） */}
        <div className="mb-4 pt-2">
          <h2 className="text-[1.25rem] font-bold text-v2-text-primary">{matchTitle(phase, totalVisible, hasHigh)}</h2>
          <MatchDimensionLine
            phase={phase}
            primary={result?.primary ?? null}
            secondary={result?.secondary ?? null}
            className="text-[0.75rem] text-v2-text-muted mt-1"
          />
        </div>

        {/* ② 状态说明卡（恒在：唯一会换措辞的地方；min-h 锁住卡高，八种状态之间不位移） */}
        <MatchStatusNote
          phase={phase}
          className="mb-4"
          cardClassName="px-4 py-3 min-h-[84px]"
          secondary={result?.secondary ?? null}
          hasHigh={hasHigh}
          matchedViaSecondary={!!result?.matchedViaSecondary}
          arrivedCount={arrivedCount}
          candidateCount={candidateCount}
          slowHint={slowHint}
          missingCorpus={missingCorpus}
          onRetry={onRetry}
        />

        {/* ③ Part 筛选槽：恒占 2rem 高。【必须用 rem 不能用 px】：Chip 字号是 rem，会随设置页字体档
            （--fs-scale 最大 1.15）联动放大——实测标准档 chip 恰好 30px，特大档约 32.7px，
            px 定高 + overflow-hidden 正是「全部」下沿被裁的成因。rem 槽随档同缩放，任何档位都不裁 */}
        <div className="h-[2rem] mb-5 flex items-center gap-2">
          {phase === 'waiting' && (
            <span className="flex gap-2" aria-hidden="true">
              <Skeleton className="w-12 h-[1.875rem] rounded-full" />
              <Skeleton className="w-16 h-[1.875rem] rounded-full" />
              <Skeleton className="w-16 h-[1.875rem] rounded-full" />
            </span>
          )}
          {/* 低相关态不渲染 chips：lowShown 不经 Part 筛选，渲染出来就是个点了没反应的死控件 */}
          {hasCards && availableTabs.map((p) => (
            <Chip key={p} onClick={() => onSelectTab(p)} variant="ghost" active={activeTab === p}>
              {p}
            </Chip>
          ))}
        </div>

        {/* ④ 列表区：骨架卡 / 真卡分组 / 说明块 */}
        <div className="mb-6">
          {phase === 'waiting' && (
            <div className="flex flex-col gap-2.5" aria-hidden="true">
              {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
            </div>
          )}

          {hasCards && (
            <>
              {highGroup.length > 0 && (
                <div>
                  <GroupHeader text={`高匹配 · ${highGroup.length} 道`} variant="high" />
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
                  <GroupHeader text={`中匹配 · ${midGroup.length} 道`} variant="mid" />
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

              {noneVisible && (
                <div className="text-center text-[0.8125rem] text-v2-text-muted py-10">该 Part 暂无匹配题目</div>
              )}
            </>
          )}

          {isLow && (
            // 单组，不拆「最相关 / 其他」：拆开会让第一张看起来是被推荐的，与「都用不上」的定调打架
            <div>
              <GroupHeader text={`最接近的 ${lowShown.length} 道，都用不上`} variant="low" />
              <div className="flex flex-col gap-3">
                {lowShown.map((q) => (
                  // showSwitchTag=false：全都不贴合的语境下只给一部分卡挂「需切换角度」，
                  // 等于暗示没挂的那几道可以直接用。
                  // practiceVariant=text：这几道题是佐证不是备选，卡上的分析入口不该和底部主 CTA 抢注意力。
                  <MatchedQuestionCard
                    key={q.id}
                    question={q}
                    selected={selectedId === q.id}
                    onToggle={() => onToggleSelect(q.id)}
                    onPractice={() => onPractice(q.id)}
                    isPrimaryMatch={q.isPrimaryMatch}
                    isHighMatch={false}
                    showSwitchTag={false}
                    practiceVariant="text"
                    saveState={saveStateOf(q.id)}
                    onSave={() => onSavePair(q.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* noMatch / degraded / error / limit：列表区刻意留白。原先这里各放一块 orb 说明
              （「这一季没有可以列出来的题」等），产品方真机验收判定与上方标题/说明卡重复，已删。 */}
        </div>

        {/* ⑤ 底部动作槽：恒占 44px 高，内容随状态换（等待期为空占位，避免按钮忽隐忽现） */}
        <div className="min-h-[44px] mt-6 mb-6 flex items-center justify-center text-center">
          {phase === 'result' && hasMore && (
            <button
              onClick={onToggleExpanded}
              // 文字色由 brand-primary-dark 改 v2-text-secondary：前者压页面底 #FBFAF7 约 4.08:1，
              // 13px 常规字需 4.5:1
              className="min-h-[44px] inline-flex items-center justify-center px-3 text-[0.8125rem] font-medium text-v2-text-secondary active:opacity-60"
            >
              {expanded ? '收起 ↑' : `查看更多 ${foldedCount} 道 →`}
            </button>
          )}
          {/* lowMatch 的出口按产品方拍板做成纯文字链接：这几道题是佐证不是备选，
              出口是退路不是主推，不给渐变按钮 */}
          {isLow && (
            <button
              onClick={onExit}
              className="min-h-[44px] inline-flex items-center justify-center px-3 text-[0.8125rem] font-medium text-v2-text-secondary underline underline-offset-2 active:opacity-60"
            >
              回到首页
            </button>
          )}
          {phase === 'noMatch' && (
            <GradientButton onClick={onExit} className="min-h-[44px] inline-flex items-center justify-center px-6 py-2.5 rounded-full text-[0.875rem] font-medium">
              回到首页
            </GradientButton>
          )}
          {phase === 'degraded' && (
            <GradientButton onClick={onRetry} className="min-h-[44px] inline-flex items-center justify-center px-6 py-2.5 rounded-full text-[0.875rem] font-medium">
              重新匹配
            </GradientButton>
          )}
          {phase === 'error' && (
            // F10：缺 corpusId 时重试永远无效（页面根本不知道该匹配哪段语料），出口换成回首页
            missingCorpus ? (
              <GradientButton onClick={onExit} className="min-h-[44px] inline-flex items-center justify-center px-6 py-2.5 rounded-full text-[0.875rem] font-medium">
                回到首页
              </GradientButton>
            ) : (
              <GradientButton onClick={onRetry} className="min-h-[44px] inline-flex items-center justify-center px-6 py-2.5 rounded-full text-[0.875rem] font-medium">
                重试
              </GradientButton>
            )
          )}
          {/* 429 不给重试（只会再撞一次），退路做成低强度文本按钮 */}
          {phase === 'limit' && (
            <button
              onClick={onExit}
              className="min-h-[44px] inline-flex items-center justify-center px-3 text-[0.8125rem] font-medium text-v2-text-secondary underline underline-offset-2 active:opacity-60"
            >
              回到首页
            </button>
          )}
        </div>
      </div>

      {/* 流程页桌面端沉浸：隐藏侧栏 */}
      <div className="relative z-20 flex-shrink-0 lg:hidden"><TabBar /></div>
    </div>
  )
}
