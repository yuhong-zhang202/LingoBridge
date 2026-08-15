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
import { cn } from '@/lib/utils'
import type { MatchPhase } from '@/app/matching/phase'
import type { MatchEarlyHint } from '@/lib/match-early-hint'
import type { MatchedPoint } from '@/lib/types'

interface Props {
  phase: MatchPhase
  /** 外层（承载 role=status）的 class：外边距等布局 */
  className?: string
  /** 卡本体的 class：内边距 + 最小高度，由两端各自传（两端的等高基线不同） */
  cardClassName: string
  /** 识别出的副观察点（result 态副维度降级说明要用） */
  secondary: MatchedPoint | null
  /** 本次匹配【跨所有 Part】有没有高匹配（结果级属性，不随 Tab 变）。result 态据此切「情况二」文案 */
  hasHigh: boolean
  /** 本次匹配是靠副观察点召回的（result 态换成副维度说明，措辞与改造前一字不改） */
  matchedViaSecondary: boolean
  /** 已到达题数（waiting/streaming 的计数行） */
  arrivedCount: number
  /** 候选总数；null = 无此信号（?stream=0 降级路），计数行整行不渲染 */
  candidateCount: number | null
  /** 强制显示 75 秒超时兜底行（mock 演示用，正常由 MatchingProgress 内部计时判定） */
  slowHint?: boolean
  /** 等待期前置提示（判据见 lib/match-early-hint）；null = 不提示。仅 waiting/streaming 两态渲染 */
  earlyHint: MatchEarlyHint | null
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
 * 骨架头部的状态化标题（两端共用文案，只有字号不同）。
 * 结果形态按产品方 2026-08-03 定稿分三种情况：有高匹配（现状标题）、只有中匹配（「暂无完美匹配」，
 * 中匹配自动展开）、高中都没有（lowMatch，与 noMatch 共用「暂无可用匹配」）。
 * @param phase        当前页面形态
 * @param totalVisible 可见题数（只有 streaming / result 两态会用到）
 * @param hasHigh      本次匹配【跨所有 Part】有没有高匹配。按全局判而不按当前 Tab 判：
 *                     这是结果级属性，切 Part 时标题不该跟着跳
 * @returns            该状态下的页面主标题
 */
export function matchTitle(phase: MatchPhase, totalVisible: number, hasHigh: boolean): string {
  switch (phase) {
    case 'waiting':   return '正在为你匹配题目'
    case 'streaming': return `已找到 ${totalVisible} 道，还在继续找`
    // 情况二：没有高匹配、只有中匹配——不再宣称「匹配到 N 道」，如实说没有完美的
    case 'result':    return hasHigh ? `匹配到 ${totalVisible} 道当季真题` : '暂无完美匹配'
    // 情况三/四共用：低分题只是「确实翻遍题库了」的佐证，一道没召回时更是如此
    case 'lowMatch':  return '暂无可用匹配'
    case 'noMatch':   return '暂无可用匹配'
    case 'degraded':  return '题目找到了，排序没算出来'
    case 'error':     return '题目没匹配出来'
    case 'limit':     return '今天的匹配次数用完了'
  }
}

/**
 * 骨架头部的识别维度副行（两端共用）。**恒占一行**：meta 帧在萃取完成时就到（早于全部重排），
 * 等待期中后段这行会自己从「识别中」填上真值，是一次正向的「有进展」信号；
 * error / limit 态没有可信的维度可说，渲染同高度的空占位而不是塞假信息。
 * @param className 字号/颜色/间距（两端不同）
 * @returns 识别维度行
 */
export function MatchDimensionLine({ phase, primary, secondary, className }: {
  phase: MatchPhase
  primary: MatchedPoint | null
  secondary: MatchedPoint | null
  className: string
}): JSX.Element {
  if (phase === 'error' || phase === 'limit') {
    return <p className={className} aria-hidden="true">&nbsp;</p>
  }
  if (!primary) return <p className={className}>识别维度：识别中</p>
  return (
    <p className={className}>
      识别维度：{primary.dimension} · {primary.pointName}
      {secondary && ` ／ ${secondary.dimension} · ${secondary.pointName}`}
    </p>
  )
}

/**
 * 匹配页状态说明卡。
 * @param phase 当前页面形态，决定卡内文案；waiting/streaming 时卡内是进度条而非文案
 * @returns 恒在同一位置的说明卡（role=status，状态变化由读屏 polite 播报）
 */
export default function MatchStatusNote({
  phase, className, cardClassName, secondary, hasHigh, matchedViaSecondary,
  arrivedCount, candidateCount, slowHint, earlyHint, missingCorpus, onRetry,
}: Props): JSX.Element {
  const pending = phase === 'waiting' || phase === 'streaming'
  // 离线判定放在本组件内：两端共用一份口径，改文案只改一处。
  const offline = typeof navigator !== 'undefined' && !navigator.onLine

  return (
    // role/aria-live 挂在外层而非 <Card>：Card 是全站共用组件，不为本页给它开 a11y 属性口子。
    <div role="status" aria-live="polite" className={cn('shrink-0', className)}>
      {/* 短文案终态在卡内【垂直居中】（产品方真机验收：min-h 撑出的下方留白让文字看着顶在上沿）；
          waiting/streaming 的进度条内容多、自然撑满，保持块布局不受影响 */}
      <Card className={cn(cardClassName, !pending && 'flex flex-col justify-center')}>
        {pending ? (
          // ⚠️ 唯一一处 MatchingProgress：waiting 与 streaming 共用它，切换 phase 时不重挂载、进度条不倒退
          <MatchingProgress
            arrivedCount={arrivedCount}
            candidateCount={candidateCount}
            slowHint={slowHint}
            earlyHint={earlyHint}
            onRetry={onRetry}
          />
        ) : (
          <Body
            phase={phase}
            secondary={secondary}
            hasHigh={hasHigh}
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
function Body({ phase, secondary, hasHigh, matchedViaSecondary, missingCorpus, offline }: {
  phase: MatchPhase
  secondary: MatchedPoint | null
  hasHigh: boolean
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
      // 情况二：没有高匹配、只有中匹配。标题已说「暂无完美匹配」，这里给出路（换角度即可用）
      if (!hasHigh) {
        return <p className={LINE1}>换个角度，可以匹配到下面这些题目。</p>
      }
      return (
        <>
          <p className={`${LINE1} mb-1`}>下面这些题，都可以用你刚才那段语料来回答</p>
          <p className={LINE2}>先挑一道进去，分析会告诉你这段语料该怎么组织成答案。</p>
        </>
      )

    case 'lowMatch':
      // 【只有一行】。这几道低分题是「我们确实翻遍题库了」的佐证，不是备选题 ——
      // 多写一句「可以先挑一道试试」就等于把用不上的题当备选推给用户。出路是底部的「回到首页」文字链接。
      return <p className={LINE1}>下面几道是最接近的，列出来给你确认一下。</p>

    case 'noMatch':
      // 与 lowMatch 共用同一套定调（标题已相同），只是这次连「最接近的几道」都没有可列
      return <p className={LINE1}>题库里没有能列出来的相近题目。</p>

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
