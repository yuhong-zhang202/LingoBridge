/**
 * @module   dashboard/_sections/UsersSection
 * @desc     经营看板折叠区②「用户走到哪」—— 2026-08-15 改版：主角换成七步主线漏斗（0064 口径）。
 *           区内顺序：七步漏斗表 → 质量注脚 → 额度墙 → 旧 4 段漏斗（保留）→ 参与度趋势。
 *
 *   🔴【旧 4 段漏斗保留，与七步并存，但两者口径不同源】产品方拍板：并存观察几天再决定砍哪个。
 *      旧 4 段走 0047 那批 RPC（**不剔**内部账户与自测流量），七步走 0064（**剔**）。
 *      ⇒ UI 上绝不可出现二者相减 / 对比的表达，各自标明口径是硬要求。
 *
 *   【删除记录】「哪些页面被用得多」（PageActivityList）与「离开页分布」占位卡 2026-08-14 整块移除
 *      —— 不是隐藏，是从这棵树上摘掉。2026-08-15 补清数据层：PageActivityList 组件、route 的
 *      pageViewStats / pageViewsTruncated 字段、fetchPageViewStats / aggregatePageViews 一并删除，
 *      「界面已无消费者、后端还在算」的半截链路就此收口。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import CollapsibleSection from '@/components/dashboard/CollapsibleSection'
import EngagementTrendChart from '@/components/dashboard/EngagementTrendChart'
import GrowthFunnelTable from '@/components/dashboard/GrowthFunnelTable'
import { FunnelQualityNotes, QuotaWallBlock } from '@/components/dashboard/FunnelFootnotes'
import type { GrowthState, GrowthFunnelResponse } from '@/hooks/useGrowthMetrics'
import { GrowthFunnel } from './GrowthFunnel'
import type { DashboardData } from './types'

/**
 * 「用户走到哪」折叠区
 * @param data        看板数据（区内各块各取所需字段）
 * @param funnel      七步漏斗三态（父层拉一次，见 useGrowthMetrics 顶注）
 * @param rangeBadge  区间口径 chip 文案（收起态也看得见这块数据的时间范围）
 * @param windowDays  区间天数（7/14/30），旧漏斗③的「近 N 天」口径用
 * @param subtitle    收起态 summary 的常驻结论数字
 */
export default function UsersSection({ data, funnel, rangeBadge, windowDays, subtitle }: {
  data: DashboardData; funnel: GrowthState<GrowthFunnelResponse>
  rangeBadge: string; windowDays: number; subtitle: string
}) {
  return (<>
    {/* ② 用户走到哪（默认收起）：七步漏斗 → 质量注脚 → 额度墙 → 旧 4 段漏斗 → 参与度趋势。
        历史沿革（本次改版前的两条删除记录，保留备查）：
        与 Hero 重复的「今日新增注册」「今日匿名活跃」两张小卡已删（Hero 三卡承接）；
        假空率小卡挪去「出事了吗」区（它是采集故障性质，不是用户行为）。 */}
    <CollapsibleSection title="用户走到哪" subtitle={subtitle}
      rangeBadge={rangeBadge}>
      {/* 七步主线漏斗（0064 口径，剔内部账户与自测）：跨源时数字照显，告警由行内标签 + 横幅承担 */}
      <GrowthFunnelTable state={funnel} />
      {/* 走到这一步的人体验到什么：只浏览未动手 / 匹配质量 / 出题停留 / 反馈卡 */}
      <FunnelQualityNotes state={funnel} />
      {/* 额度墙（撞墙窗口 30 天、观察期 7 天，两者都不随区间选择器变） */}
      <QuotaWallBlock state={funnel} />

      {/* 旧 4 段漏斗：口径与上面七步【不同源】，保留观察期（产品方拍板）。
          这行口径小字是并存的前提——没有它，两块数字并排就一定会被相减。 */}
      <div className="mt-4">
        <div className="text-[0.75rem] font-medium text-v2-text-secondary mb-1">旧 4 段漏斗 · 保留观察中</div>
        <div className="text-[0.625rem] text-v2-text-muted leading-relaxed mb-2">
          口径与上方七步漏斗【不同源】：这一组走 0047 那批 RPC，【不剔除】内部账户与自测流量，窗口也差一天。
          两组数字不可相减、不可对照，只能各看各的趋势。
        </div>
        {/* 增长漏斗：③ 窗口核心活跃跟随区间选择器（近 N 天） */}
        <GrowthFunnel data={data} windowDays={windowDays} />
      </div>

      {/* 参与度趋势（活跃 + 场次 + 新增注册 三线；新增注册线在迁移未跑/降级时不渲染）并入本组 */}
      <div className="mt-4">
        <div className="text-[0.75rem] font-medium text-v2-text-secondary mb-2">参与度趋势 · 核心活跃人数 + 练习场次 + 新增注册</div>
        {data.engagementTrend.some(d => d.activeUsers > 0 || d.practiceSessions > 0)
          ? <EngagementTrendChart data={data.engagementTrend} />
          : <div className="text-v2-text-muted text-[0.75rem] h-[180px] flex items-center justify-center">本期暂无参与度数据</div>}
      </div>
    </CollapsibleSection>
  </>)
}
