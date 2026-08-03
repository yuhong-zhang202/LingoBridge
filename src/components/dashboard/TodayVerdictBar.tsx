'use client'
/**
 * @module   dashboard/TodayVerdictBar
 * @desc     看板顶部「今日结论条」—— 一行回答"今天有没有事要处理"（方案 §二）。
 *           判定逻辑在 lib/dashboard-verdict（纯函数、已单测），本组件只管渲染与锚点跳转：
 *           · 有系统故障（计费失败）→ 整条 error 透明底；仅反馈/成本/慢 → warning 同结构透明度；全绿白卡
 *           · 圆点 + 文字双承载状态（不靠色）；每件事是 min-h-[44px] 的链接式按钮，点了展开并跳到对应区块
 *           · <section aria-label> 复述整句结论（读屏一句话拿到全部信息）
 *           🔴 flow_events 的「该我们修」桶刻意不进本条（区间口径 ≠ 今日口径，理由见 dashboard-verdict 顶注）。
 * @author   LingoBridge
 * @created  2026-08-04
 */
import { computeVerdict, allClearText, type VerdictInput, type VerdictItem } from '@/lib/dashboard-verdict'
import { jumpToAnchor } from '@/components/dashboard/anchor'

/** chip 色调 → 样式（红=系统故障 / 品牌深色=反馈（要处理但不是坏了）/ 黄=成本、变慢） */
const CHIP_TONE_CLASS: Record<VerdictItem['tone'], string> = {
  error: 'bg-error/10 text-error',
  brand: 'bg-brand-primary-light/40 text-brand-primary-dark',
  warn:  'bg-warning/15 text-warning-text',
}

/**
 * 今日结论条
 * @param input  判定所需的看板字段子集（见 dashboard-verdict.VerdictInput）
 */
export default function TodayVerdictBar({ input }: { input: VerdictInput }) {
  const items = computeVerdict(input)
  const hasError = items.some(i => i.tone === 'error')

  // 外壳：系统故障 error 透明底 > 其余事项 warning 同结构透明度 > 全绿白卡（禁新色值，全部现有 token）
  const shell = hasError
    ? 'bg-error/[0.06] border-error/20'
    : items.length > 0
      ? 'bg-warning/[0.06] border-warning/20'
      : 'bg-white border-black/[0.05]'
  const dotClass = hasError ? 'bg-error' : items.length > 0 ? 'bg-warning' : 'bg-success'

  const headline = items.length > 0 ? `今天有 ${items.length} 件事要处理` : allClearText(input.todayCost)
  // aria-label 复述整句结论：主句 + 各事项，读屏用户不必逐 chip 探索
  const ariaLabel = items.length > 0
    ? `今日结论：${headline}：${items.map(i => i.text).join('；')}`
    : `今日结论：${headline}`

  return (
    <section aria-label={ariaLabel} className={`rounded-[16px] border px-4 py-3 mb-4 ${shell}`}>
      <div className="flex items-center gap-2">
        {/* 圆点是状态的辅助承载，主承载是文字（aria-hidden 防读屏念出无意义的图形） */}
        <span aria-hidden="true" className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} />
        <span className="text-[0.9375rem] font-semibold text-v2-text-primary">{headline}</span>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-1.5">
          {items.map(i => (
            <button key={i.key} onClick={() => jumpToAnchor(i.anchorId)}
              className={`inline-flex items-center min-h-[44px] px-3.5 rounded-full text-[0.75rem] font-medium transition-opacity active:opacity-70 focus-visible:ring-2 focus-visible:ring-brand-primary/40 ${CHIP_TONE_CLASS[i.tone]}`}>
              {i.text} · 查看
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
