/**
 * @module   dashboard/_sections/shared
 * @desc     经营看板各区块【跨区共用】的小件 —— 2026-08-14 自 `dashboard/page.tsx` 原样抽出
 *           （逐字未改、只换位置）。只放真被两个及以上区块用到的：
 *             · phaseDisplayName —— 「钱花在哪」的块A 与「出事了吗」的块B 共用；
 *             · PendingPlaceholder —— 「用户走到哪」的离开页分布 与「出事了吗」的假空率 共用。
 *           只被单一区块用到的局部组件一律留在各自区块文件里，不往这里堆。
 * @author   LingoBridge
 * @created  2026-08-14
 */
import type { PhaseTotal } from './types'

/** other 桶显示名：明确它是「未标注环节」而非某个真实环节（pm 方案 §2.3） */
function phaseDisplayName(p: PhaseTotal): string {
  return p.phase === 'other' ? '其他（未标注环节）' : p.name
}

/** 「下一步接入」空态占位（假空率无带信号样本时用，不硬编错数）：漏斗下方并列小卡的降级态 */
function PendingPlaceholder({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="flex-1 min-w-[140px] bg-black/[0.02] rounded-[12px] border border-dashed border-black/[0.1] px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[0.6875rem] text-v2-text-muted">{title}</span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.5625rem] font-medium bg-black/[0.04] text-v2-text-muted">下一步接入</span>
      </div>
      <div className="text-[0.625rem] text-v2-text-muted leading-relaxed mt-1">{reason}</div>
    </div>
  )
}

// 导出写在声明之后（而非 `export function`）：保持上面两处声明行与重构前逐字一致。
export { phaseDisplayName, PendingPlaceholder }
