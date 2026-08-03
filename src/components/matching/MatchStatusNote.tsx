/**
 * @module   MatchStatusNote
 * @desc     匹配页「状态说明卡」（桌面 + 移动共用）—— 统一骨架里恒在的第 ② 槽，内容随 phase 变、位置不变。
 *
 *   为什么要有这张卡：产品方的硬要求是「桌面端和移动端各只有一种页面展示，不能过一会又跳转成别的 UI 形式」。
 *   八种状态过去各自是一整页（进度骨架页 / 空态页 / 低相关页 / 结果页…），彼此一换就是整页跳变。
 *   收成一个骨架后，「这一刻发生了什么」全部由这张卡承担 —— 它是页面里唯一会换措辞的地方。
 *
 *   🔴 卡的最小高度由调用方按端传入（桌面 min-h-[76px] / 移动 min-h-[84px]）：八种状态文案行数不同，
 *     不锁高度的话卡下沿会随状态上下跳，那正是本次要消灭的东西。lowMatch 只有一行、卡里会有留白，
 *     【这是刻意的】—— 等高优先于单张卡好看。
 *
 *   ⚠️ waiting 与 streaming 共用同一处 <MatchingProgress>（三元的同一个分支），不是各写一遍：
 *     它的计时器以挂载时刻为起点，换了 JSX 位置就会重挂载、进度条从 85% 掉回 0。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
'use client'
import { type JSX } from 'react'
import Card from '@/components/Card'
import MatchingProgress from '@/components/matching/MatchingProgress'
import type { MatchPhase } from '@/app/matching/phase'
import type { MatchedPoint } from '@/lib/types'

interface Props {
  phase: MatchPhase
  /** 卡本体的 class：内边距 + 最小高度 + 外边距，由两端各自传（两端的等高基线不同） */
  cardClassName: string
  /** 识别出的主观察点（noMatch 文案要点名方向）；null 时该句省略 */
  primary: MatchedPoint | null
  /** 识别出的副观察点（result 态副维度降级说明要用） */
  secondary: MatchedPoint | null
  /** 本次匹配是靠副观察点召回的（result 态换成副维度说明，措辞与改造前一字不改） */
  matchedViaSecondary: boolean
  /** 已到达题数（waiting/streaming 的计数行） */
  arrivedCount: number
  /** 候选总数；null = 无此信号（?stream=0 降级路），计数行整行不渲染 */
  candidateCount: number | null
  /** 强制显示 75 秒超时兜底行（mock 演示用，正常由 MatchingProgress 内部计时判定） */
  slowHint?: boolean
  /** error 态：缺 corpusId。此时重试永远无效，文案与出口都得换（F10） */
  missingCorpus: boolean
  /** waiting/streaming 的超时出口 + error/degraded 的重试 */
  onRetry: () => void
}

/** 说明卡第一行（主句）样式：与改造前的副维度说明卡逐字一致，不新造 */
const LINE1 = 'text-[0.8125rem] text-v2-text-primary leading-snug'
/** 说明卡第二行（补充句）样式 */
const LINE2 = 'text-[0.75rem] text-v2-text-secondary leading-relaxed'

/**
 * 匹配页状态说明卡。
 * @param phase 当前页面形态，决定卡内文案；waiting/streaming 时卡内是进度条而非文案
 * @returns 恒在同一位置的说明卡（role=status，状态变化由读屏 polite 播报）
 */
export default function MatchStatusNote({
  phase, cardClassName, primary, secondary, matchedViaSecondary,
  arrivedCount, candidateCount, slowHint, missingCorpus, onRetry,
}: Props): JSX.Element {
  const pending = phase === 'waiting' || phase === 'streaming'
  // 离线判定放在本组件内：两端共用一份口径，改文案只改一处。
  const offline = typeof navigator !== 'undefined' && !navigator.onLine

  return (
    // role/aria-live 挂在外层而非 <Card>：Card 是全站共用组件，不为本页给它开 a11y 属性口子。
    <div role="status" aria-live="polite" className="shrink-0">
      <Card className={cardClassName}>
        {pending ? (
          // ⚠️ 唯一一处 MatchingProgress：waiting 与 streaming 共用它，切换 phase 时不重挂载、进度条不倒退
          <MatchingProgress
            arrivedCount={arrivedCount}
            candidateCount={candidateCount}
            slowHint={slowHint}
            onRetry={onRetry}
          />
        ) : (
          <Body
            phase={phase}
            primary={primary}
            secondary={secondary}
            matchedViaSecondary={matchedViaSecondary}
            missingCorpus={missingCorpus}
            offline={offline}
          />
        )}
      </Card>
    </div>
  )
}

/**
 * 各定稿状态的说明文案（waiting/streaming 不走这里，它们卡里是进度条）。
 * @returns 一到两行说明
 */
function Body({ phase, primary, secondary, matchedViaSecondary, missingCorpus, offline }: {
  phase: MatchPhase
  primary: MatchedPoint | null
  secondary: MatchedPoint | null
  matchedViaSecondary: boolean
  missingCorpus: boolean
  offline: boolean
}): JSX.Element | null {
  switch (phase) {
    case 'result':
      // 副维度降级说明：与改造前逐字一致（已验证过的措辞）。差别只是它从此有固定位置，
      // 不再是「有时冒出一张卡、把下面的内容整体推下去」。
      if (matchedViaSecondary && secondary) {
        return (
          <>
            <p className={`${LINE1} mb-1`}>暂时没匹配到完全契合的雅思真题</p>
            <p className={LINE2}>
              不过把重点放在{' '}
              <span className="text-brand-primary-dark font-medium">
                {secondary.dimension} · {secondary.pointName}
              </span>
              {' '}这个方向上，这些题目同样值得练
            </p>
          </>
        )
      }
      return (
        <>
          <p className={`${LINE1} mb-1`}>下面这些题，都可以用你刚才那段语料来回答</p>
          <p className={LINE2}>先挑一道进去，分析会告诉你这段语料该怎么组织成答案。</p>
        </>
      )

    case 'lowMatch':
      // 【只有一行】。这几道低分题是「我们确实翻遍题库了」的佐证，不是备选题 ——
      // 多写一句「可以先挑一道试试」就等于把用不上的题当备选推给用户。出路交给下方的主 CTA。
      return <p className={LINE1}>下面几道是最接近的，列出来给你确认一下。</p>

    case 'noMatch':
      return (
        <>
          <p className={`${LINE1} mb-1`}>这一季的题目里，没有能承接这个故事的题</p>
          <p className={LINE2}>
            {primary ? `没有题目落在${primary.dimension} · ${primary.pointName}这个方向上。` : ''}
            换个角度重讲一遍，或者讲件别的事，通常就能对上。
          </p>
        </>
      )

    case 'degraded':
      return (
        <>
          <p className={`${LINE1} mb-1`}>题目匹配好了，只是排序这一步没算出来</p>
          <p className={LINE2}>这是临时故障，重新匹配一次通常就好。</p>
        </>
      )

    case 'error':
      return (
        <>
          <p className={`${LINE1} mb-1`}>这次没能拿到匹配结果</p>
          <p className={LINE2}>
            {missingCorpus
              // F10：缺语料 id 时重试永远无效，不能再说「点下面再试一次」骗用户按一个必然失败的按钮
              ? '这个页面缺少必要信息，回首页重新开始吧。'
              : offline
                ? '设备好像离线了，连上网络再试一次。'
                : '刚才好像没连上，点下面再试一次。'}
          </p>
        </>
      )

    case 'limit':
      return (
        <>
          <p className={`${LINE1} mb-1`}>今天的匹配次数已经用完</p>
          <p className={LINE2}>明天会自动恢复。之前匹配过的题目还可以照常打开。</p>
        </>
      )

    default:
      return null
  }
}
