/**
 * @module   dashboard/_sections/GrowthFunnel
 * @desc     经营看板「用户走到哪」区块里的增长漏斗（① 累计注册 → ② 激活 → ③ 窗口核心活跃 →
 *           ④ W1 首周留存）及其段内小件 —— 2026-08-14 自 `dashboard/page.tsx` 原样抽出
 *           （逐字未改、只换位置）。四段各自独立降级的三态逻辑全在本文件内。
 * @author   LingoBridge
 * @created  2026-08-14
 */
import type { ReactNode } from 'react'
import Card from '@/components/Card'
import type { DashboardData } from './types'

// ── 增长漏斗（归「用户走到哪」）：等宽卡 + 段间箭头（chevron），不画按数值递减宽度的漏斗条 ──
//   产品方拍板（勿改）：③核心活跃门槛低于②激活、可能反超，递减条会误导；故四段等宽、每段 x/y 各自自洽。

/** 漏斗每段的等宽卡壳（plain Card + flex 撑满等高，口径小字靠 mt-auto 沉底） */
function FunnelCard({ children }: { children: ReactNode }) {
  return <Card className="flex-1 flex flex-col px-4 py-4">{children}</Card>
}

/** 段间箭头：桌面横排 `›` / 移动纵排 `↓`，纯装饰、对读屏 aria-hidden（先后由 <ol> 承载） */
function FunnelChevron() {
  return (
    <li aria-hidden="true" className="flex items-center justify-center shrink-0 text-v2-text-muted">
      <span className="hidden md:inline text-[1.125rem] leading-none">›</span>
      <span className="md:hidden text-[1rem] leading-none">↓</span>
    </li>
  )
}

/**
 * x/y 的百分比串（1 位小数）；分母 ≤0 返回 null（除零保护，调用处据此不显 (%)、只显 x/y）。
 * @param num  分子
 * @param den  分母
 * @returns    形如 '39.2%'；分母 ≤0 时 null
 */
function pctText(num: number, den: number): string | null {
  if (den <= 0) return null
  return `${(num / den * 100).toFixed(1)}%`
}

/** 漏斗主数字 x/y（%）：主 x/y 为 text-[1.5rem] 粗体；(%) 括号灰为辅（除零时不显 %，只显 x/y） */
function FunnelFraction({ num, den }: { num: number; den: number }) {
  const p = pctText(num, den)
  return (
    <div className="text-[1.5rem] font-bold text-v2-text-primary tabular-nums leading-none mt-1">
      {num}/{den}
      {p && <span className="text-[0.8125rem] font-medium text-v2-text-secondary ml-1">({p})</span>}
    </div>
  )
}

/** 漏斗段降级内容（塞进同尺寸 FunnelCard、保持漏斗不塌）：段标题 + 「下一步接入」badge + 原因小字 */
function FunnelDegraded({ title, reason }: { title: string; reason: string }) {
  return (
    <>
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className="text-[0.6875rem] text-v2-text-muted">{title}</span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.5625rem] font-medium bg-black/[0.04] text-v2-text-muted">下一步接入</span>
      </div>
      <div className="text-[0.625rem] text-v2-text-muted leading-relaxed mt-1">{reason}</div>
    </>
  )
}

/** 漏斗段标题（11px muted） */
function FunnelTitle({ children }: { children: ReactNode }) {
  return <div className="text-[0.6875rem] text-v2-text-muted">{children}</div>
}

/** 漏斗段口径小字（10px muted，mt-auto 沉底与等高段对齐） */
function FunnelNote({ children }: { children: ReactNode }) {
  return <div className="text-[0.625rem] text-v2-text-muted leading-relaxed mt-auto pt-2">{children}</div>
}

/**
 * 单条留存指标的展示串：rate + 样本量 n（n 必显，避免小样本 100% 被误读）。
 * rate=null（该指标无成熟群组，如 D7 现未满 7 天）→ 显未成熟提示而非 0%，避免误导。
 * @param rate     0-100 百分比（1 位小数），null = 未成熟
 * @param n        分母（成熟群组总人数）
 * @param immature rate=null 时展示的未成熟说明
 */
function retentionText(rate: number | null, n: number, immature: string): string {
  if (rate === null) return immature
  return `${rate}% · n=${n}`
}

// 迁移 0047 各段的接入提示（降级 reason 复用，避免散落硬编码）。
const ACTIVATION_REASON = '激活 RPC（get_activation_stats）尚未接入，待部署方跑迁移 0047 后自动显示真实数据。'
const WEEKLY_RET_REASON = 'W1 留存 RPC（get_weekly_retention_stats）尚未接入，待部署方跑迁移 0047 后自动显示真实数据。'

/**
 * 增长漏斗：① 累计注册 →（›/↓）② 激活 →（›/↓）③ 窗口核心活跃 →（›/↓）④ W1 首周留存。
 * 桌面一行四段 + chevron，移动纵向堆叠 + 下箭头；四段等宽（不画递减宽度漏斗条，产品方拍板）。
 * a11y：<ol>/<li> 承载先后、区块 aria-label 概述全链、chevron aria-hidden。各段迁移未跑时独立降级、不塌。
 * @param data       看板数据（读 activation / weeklyRetention / retention / windowCoreActive 及各 pending）
 * @param windowDays 区间天数（7/14/30），③ 口径小字「近 N 天」用
 */
function GrowthFunnel({ data, windowDays }: { data: DashboardData; windowDays: number }) {
  // ① 累计注册 / ② 激活：同源 activation，null 时两段同时降级
  const act = data.activation
  const seg1: ReactNode = act
    ? (<>
        <FunnelTitle>累计注册</FunnelTitle>
        <div className="text-[1.5rem] font-bold text-v2-text-primary tabular-nums leading-none mt-1">{act.registeredTotal}</div>
        <FunnelNote>只计真注册（非匿名·有邮箱）· 东八区</FunnelNote>
      </>)
    : <FunnelDegraded title="累计注册" reason={ACTIVATION_REASON} />

  const cohortPct = act ? pctText(act.cohortActivated, act.cohortTotal) : null
  const seg2: ReactNode = act
    ? (<>
        <FunnelTitle>激活</FunnelTitle>
        <FunnelFraction num={act.activatedTotal} den={act.registeredTotal} />
        <div className="text-[0.6875rem] text-v2-text-secondary mt-2">
          本周期新注册激活 <span className="tabular-nums">{act.cohortActivated}/{act.cohortTotal}</span>
          {cohortPct && <span className="text-v2-text-muted">（{cohortPct}）</span>}
        </div>
        <FunnelNote>激活 = 在 corpus 有 ≥1 条记录（真讲过一次故事）</FunnelNote>
      </>)
    : <FunnelDegraded title="激活" reason={ACTIVATION_REASON} />

  // ③ 窗口核心活跃：activePending（两级权威 RPC 皆不可用）时降级；否则显窗口去重人数
  const seg3: ReactNode = data.activePending
    ? <FunnelDegraded title="窗口核心活跃" reason="核心活跃口径 RPC（get_core_active_stats 与 0045）均未接入，窗口核心活跃暂不可信。待部署方跑迁移 0047 后自动显示。" />
    : (<>
        <FunnelTitle>窗口核心活跃</FunnelTitle>
        <div className="text-[1.5rem] font-bold text-v2-text-primary tabular-nums leading-none mt-1">{data.windowCoreActive}</div>
        <FunnelNote>AI 环节 / 闪卡复习 / 收藏 任一即算 · 仅注册用户 · 近{windowDays}天</FunnelNote>
      </>)

  // ④ W1 首周留存：三态——W1 有→完整；W1 无+D1/D7 有→主区降级但对照行照显；两者皆无→整段降级
  const wr  = data.weeklyRetention
  const ret = data.retention
  const d7Immature = ret && ret.d7N === 0 ? '需≥7天数据' : '暂无'
  const comparisonRow = ret ? (
    <div className="text-[0.625rem] text-v2-text-muted mt-2 leading-relaxed">
      旧口径对照 · D1 {retentionText(ret.d1Rate, ret.d1N, '需≥1天数据')} · D7 {retentionText(ret.d7Rate, ret.d7N, d7Immature)}
    </div>
  ) : null
  const w1Note = <FunnelNote>首次核心活跃后 7 天内再次活跃 · 只算注册用户 · 东八区</FunnelNote>
  let seg4: ReactNode
  if (wr) {
    seg4 = (<>
      <FunnelTitle>W1 首周留存</FunnelTitle>
      <FunnelFraction num={wr.w1Ret} den={wr.w1N} />
      {comparisonRow}
      {w1Note}
    </>)
  } else if (ret) {
    // W1 无、D1/D7 有：主区 badge，但旧口径对照行不一起吞、照显
    seg4 = (<>
      <FunnelDegraded title="W1 首周留存" reason={WEEKLY_RET_REASON} />
      {comparisonRow}
      {w1Note}
    </>)
  } else {
    seg4 = <FunnelDegraded title="W1 首周留存" reason="W1 留存与旧 D1/D7 留存 RPC 均未接入，待部署方跑迁移 0047 / 0043 后自动显示。" />
  }

  return (
    <ol aria-label="增长漏斗：注册 → 激活 → 核心活跃 → 首周留存"
      className="flex flex-col md:flex-row md:items-stretch gap-2">
      <li className="flex-1 flex flex-col"><FunnelCard>{seg1}</FunnelCard></li>
      <FunnelChevron />
      <li className="flex-1 flex flex-col"><FunnelCard>{seg2}</FunnelCard></li>
      <FunnelChevron />
      <li className="flex-1 flex flex-col"><FunnelCard>{seg3}</FunnelCard></li>
      <FunnelChevron />
      <li className="flex-1 flex flex-col"><FunnelCard>{seg4}</FunnelCard></li>
    </ol>
  )
}

// 导出写在声明之后（而非 `export function`）：保持声明行与重构前逐字一致。
export { GrowthFunnel }
