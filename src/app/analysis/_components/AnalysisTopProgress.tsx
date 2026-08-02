/**
 * @module   AnalysisTopProgress
 * @desc     题目分析页「落地后页内等 AI 分析」专用的顶部涓流进度条 + 分阶段等待文案 —— 与全局 NavProgress、
 *           练习页 InlineTopProgress 视觉一致（同一 BRAND_GRADIENT、h-[3px]/z-[100]、10s cubic-bezier 涓流爬到 90%）。
 *           这里【不复用 useNav】：分析是落地本页后页内 POST /api/analysis（AI 调用，较慢）触发的等待，
 *           根本不发生路由跳转、点不亮全局条，故必须自渲染一条独立的条（与练习页排队条同理，但那条在 practice
 *           目录且文案是「排队重试」，语义/归属都不同，不共用）。
 *           2026-07-25 起在涓流条之外再挂一枚底部居中的「当前在干嘛」状态胶囊：分析虽是一次 AI 调用、
 *           后端不回进度信号，但纯前端按已用时长滚动阶段文案（对齐匹配页 lib/matching-progress 范式），
 *           让用户知道在干嘛、不是干等。胶囊即 aria-live 播报源（role=status），涓流条 aria-hidden。
 *           motion-reduce：涓流条不做爬升、静态停 30% 宽；阶段文案属信息、仍按时推进（脉动点关停）。
 *           仅在分析加载态（loading）挂载。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { type JSX, useEffect, useState } from 'react'
import { BRAND_GRADIENT } from '@/lib/constants'

/**
 * 分阶段等待文案（按已用时长推进）。每档 fromMs 为进入该档的毫秒下界，
 * 取最后一个满足 elapsed >= fromMs 的档。措辞对齐匹配页调性（「正在读你的…」→ 逐步收束）。
 */
const STAGES: readonly { fromMs: number; text: string }[] = [
  { fromMs: 0,      text: '正在读你的语料…' },
  { fromMs: 3_500,  text: '分析这道题的答题侧重点…' },
  { fromMs: 7_000,  text: '正在挑贴合的地道词组…' },
  { fromMs: 11_000, text: '整理要点，马上就好…' },
]

/** 已用时长 → 当前阶段文案。 */
function stageText(elapsedMs: number): string {
  let text = STAGES[0].text
  for (const s of STAGES) {
    if (elapsedMs >= s.fromMs) text = s.text
  }
  return text
}

/**
 * 分析页页内顶部涓流进度条 + 底部居中阶段状态胶囊（AI 生成分析等待时挂载）。
 * @returns  固定视口顶部的涓流条（装饰，aria-hidden）+ 底部居中的 aria-live 阶段状态
 */
export default function AnalysisTopProgress(): JSX.Element {
  // 先给非零起点触发 CSS width 过渡，再爬向 90%（长 duration ease-out 形成先快后慢的涓流感，抄 NavProgress）
  const [width, setWidth] = useState(8)
  // 减少动效偏好：不做爬升，静态停 30%（inline width 会盖过 class，故用状态切 transition/width）
  const [reduced, setReduced] = useState(false)
  // 当前阶段文案（按已用时长滚动推进）
  const [stage, setStage] = useState(STAGES[0].text)

  useEffect(() => {
    const r = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setReduced(r)
    let widthTimer = 0
    if (r) setWidth(30)
    else widthTimer = window.setTimeout(() => setWidth(90), 60)

    // 阶段文案计时：用起始时刻做差而非累加计数（标签页切后台时 interval 会被节流，累加会越走越慢）。
    const startedAt = Date.now()
    const stageId = window.setInterval(() => setStage(stageText(Date.now() - startedAt)), 500)

    return () => { window.clearTimeout(widthTimer); window.clearInterval(stageId) }
  }, [])

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[100] h-[3px]"
        style={{
          width: `${width}%`,
          background: BRAND_GRADIENT,
          transition: reduced ? 'none' : 'width 10s cubic-bezier(0.1, 0.9, 0.2, 1)',
        }}
      />
      {/* 底部居中状态胶囊：显示「当前在干嘛」，随时长滚动。role=status + aria-live 让阶段切换被读屏播报。
          bottom 偏移让位可能存在的底部 TabBar（56px）+ 安全区，桌面 FlowShell 无 TabBar 时只是略微上浮。 */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-full bg-bg-surface border border-black/[0.05] shadow-[0_4px_16px_rgba(0,0,0,0.08)] px-4 py-2"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}
      >
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full animate-pulse motion-reduce:animate-none"
          style={{ background: BRAND_GRADIENT }}
        />
        <span className="text-[0.8125rem] text-v2-text-secondary">{stage}</span>
      </div>
    </>
  )
}
