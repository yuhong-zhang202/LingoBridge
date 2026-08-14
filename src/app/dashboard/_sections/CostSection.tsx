/**
 * @module   dashboard/_sections/CostSection
 * @desc     经营看板折叠区④「钱花在哪」及其两个局部块（PhaseCostBreakdown / UserCostBreakdown）
 *           —— 2026-08-14 自 `dashboard/page.tsx` 原样抽出（逐字未改、只换位置）。
 *           区内顺序：费用卡 → 口径小字 → 费用趋势 + 按服务占比 → 按环节成本 → 按用户成本 → 单价参考。
 *
 *   ⚠️ 服务筛选态（selectedService）刻意【不】收在本组件内、由 page.tsx 持有：切区间时 page 会短暂
 *      进入加载态、本区块随之卸载，state 放这里会被清空，与重构前「筛选跨区间保持」的行为不一致。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import CollapsibleSection from '@/components/dashboard/CollapsibleSection'
import CostCards from '@/components/dashboard/CostCards'
import CostTrendChart from '@/components/dashboard/CostTrendChart'
import CostBreakdown from '@/components/dashboard/CostBreakdown'
import { ANCHOR_COST, isCostWarn } from '@/lib/dashboard-verdict'
import { formatCny } from '@/lib/format-cost'
import { phaseDisplayName } from './shared'
import type { DashboardData, PhaseTotal, UserTotal } from './types'

/**
 * 块A「钱花在哪个环节」（归「钱花在哪」）— 横条按最高成本归一，每行 = 环节名 + 成本条 + ¥金额 + 占本期总成本%。
 * 刻意删失败率、删次数：这块只回答"钱花哪了"，失败拆到块B（归「出事了吗」）。other 桶照实按成本排、不隐藏（pm 方案 §2.3）。
 * @param phases  已按成本降序的环节聚合数组
 */
function PhaseCostBreakdown({ phases }: { phases: PhaseTotal[] }) {
  const max   = phases.reduce((m, p) => Math.max(m, p.cost), 0)
  const total = phases.reduce((s, p) => s + p.cost, 0)
  const hasOther = phases.some(p => p.phase === 'other')
  return (
    <section aria-label="按环节成本" className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary">钱花在哪个环节</h2>
        <span className="text-[0.625rem] text-v2-text-muted">占本期总成本</span>
      </div>
      {phases.length === 0 ? (
        <div className="text-v2-text-muted text-[0.75rem] py-4 text-center">本期暂无环节数据</div>
      ) : (
        <div className="space-y-2">
          {phases.map(p => {
            const name = phaseDisplayName(p)
            const pct  = total > 0 ? Math.round(p.cost / total * 100) : 0
            return (
              <div key={p.phase} className="flex items-center gap-3">
                <span className="text-[0.6875rem] text-v2-text-secondary w-28 flex-shrink-0 truncate" title={name}>{name}</span>
                <div className="flex-1 h-2 bg-black/[0.04] rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-brand-accent/70"
                    style={{ width: `${max > 0 ? (p.cost / max) * 100 : 0}%` }} />
                </div>
                <span className="text-[0.6875rem] font-medium text-v2-text-primary w-16 text-right flex-shrink-0 tabular-nums">{formatCny(p.cost)}</span>
                <span className="text-[0.625rem] text-v2-text-muted w-10 text-right flex-shrink-0 tabular-nums">{pct}%</span>
              </div>
            )
          })}
          {hasOther && (
            <div className="text-[0.625rem] text-v2-text-muted mt-2 leading-relaxed">
              「其他（未标注环节）」多为埋点前的转写调用，新数据会自动归位。
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// 用户身份口径未生效时的说明（0058 未跑/RPC 不可用）：与漏斗各段 *_REASON 同范式，措辞点明"错在哪"。
const USER_IDENTITY_REASON = '用户身份 RPC（get_user_anon_flags）尚未接入：「匿名」标签暂按历史调用标记推断，'
  + '先匿名试用后注册的转化用户会被误标成匿名、其试用期成本也被算进匿名侧。待部署方跑迁移 0058 后自动切当前身份口径。'

/**
 * 「按用户成本 Top-N」视图 — 内测 200 陌生人下一眼看出"谁烧最多、是不是匿名"。
 * 仅按 user_id（UUID）归因、不含任何个人信息；匿名单独标出（匿名试用是纯成本高风险）。
 * 顶部另给匿名 vs 登录的成本占比。横向条按最高成本归一化，降序（烧最多在最前）。
 * 身份口径：匿名 = 该账号【当前】不是真注册用户（auth.users 权威源）；pending 时退回旧标记口径并明示。
 * @param users          已按成本降序的每用户聚合数组（Top-N）
 * @param anonymousCost  全时段匿名用户成本合计（pending 时为旧的按行标记口径）
 * @param loggedInCost   全时段登录用户成本合计（同上）
 * @param identityPending true = 身份 RPC 未接入，标注「口径待生效」并给出误导说明
 */
function UserCostBreakdown({ users, anonymousCost, loggedInCost, identityPending }: {
  users: UserTotal[]; anonymousCost: number; loggedInCost: number; identityPending: boolean
}) {
  const max = users.reduce((m, u) => Math.max(m, u.cost), 0)
  const attributed = anonymousCost + loggedInCost
  const anonPct = attributed > 0 ? Math.round(anonymousCost / attributed * 100) : 0
  return (
    <section aria-label="按用户成本 Top-N" className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary">按用户成本 Top-N</h2>
          {/* 本区块口径独立于区间：按 user_id 全时段累计（抓"谁烧最多"要看历史总账，不随区间切换） */}
          <span className="text-[0.625rem] text-v2-text-muted">全时段累计</span>
          {/* 口径未生效标记：badge 样式与漏斗降级段（FunnelDegraded）一致，不自造新样式 */}
          {identityPending && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.5625rem] font-medium bg-black/[0.04] text-v2-text-muted">口径待生效</span>
          )}
        </div>
        {/* 匿名/登录成本占比：匿名占比高 = 陌生人试用在烧钱，内测阶段重点盯 */}
        {attributed > 0 && (
          <span className="text-[0.6875rem] text-v2-text-secondary">
            匿名 <span className="font-medium text-warning-text">{formatCny(anonymousCost)} · {anonPct}%</span>
            <span className="mx-1.5 text-v2-text-muted">/</span>
            登录 <span className="font-medium text-v2-text-primary">{formatCny(loggedInCost)}</span>
          </span>
        )}
      </div>
      {users.length === 0 ? (
        <div className="text-v2-text-muted text-[0.75rem] py-4 text-center">暂无可归因到用户的调用</div>
      ) : (
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.userId} className="flex items-center gap-3">
              {/* user_id 是 UUID，截前 8 位展示即可辨识、又不占满宽；等宽字体对齐 */}
              <span className="text-[0.6875rem] text-v2-text-secondary w-20 flex-shrink-0 truncate" style={{ fontFamily: 'monospace' }}>{u.userId.slice(0, 8)}</span>
              {/* 匿名标记：匿名单独标出（纯成本高风险），登录不占位保持行整洁 */}
              <span className="w-10 flex-shrink-0">
                {u.isAnonymous && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.5625rem] font-medium bg-warning/15 text-warning-text">匿名</span>
                )}
              </span>
              <div className="flex-1 h-2 bg-black/[0.04] rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${u.isAnonymous ? 'bg-warning/70' : 'bg-brand-accent/70'}`}
                  style={{ width: `${max > 0 ? (u.cost / max) * 100 : 0}%` }} />
              </div>
              <span className="text-[0.6875rem] font-medium text-v2-text-primary w-16 text-right flex-shrink-0 tabular-nums">{formatCny(u.cost)}</span>
              <span className="text-[0.625rem] text-v2-text-muted w-14 text-right flex-shrink-0">{u.calls} 次</span>
            </div>
          ))}
        </div>
      )}
      {/* 口径小字（10px muted，同漏斗段 FunnelNote 的字号/色）：pending 显"错在哪 + 怎么修"，否则交代当前口径 */}
      <div className="text-[0.625rem] text-v2-text-muted leading-relaxed mt-3">
        {identityPending
          ? USER_IDENTITY_REASON
          : '匿名 = 该账号当前不是注册用户（口径同「今日活跃·注册」）；转化用户（先试用后注册）的试用期成本计入登录侧。'}
      </div>
    </section>
  )
}

/**
 * 「钱花在哪」折叠区
 * @param data            看板数据
 * @param rangeBadge      区间口径 chip 文案
 * @param windowDays      区间天数（7/14/30），趋势图与占比图的「近 N 天」口径用
 * @param hasRangeData    本期是否有费用数据（无则趋势图位置显空态而非画空图）
 * @param selectedService 当前被点选的服务（联动 dim 其余服务），null = 未筛选
 * @param setSelected     切换筛选（state 在 page.tsx，见本文件顶注）
 */
export default function CostSection({ data, rangeBadge, windowDays, hasRangeData, selectedService, setSelected }: {
  data: DashboardData; rangeBadge: string; windowDays: number; hasRangeData: boolean
  selectedService: string | null; setSelected: (s: string | null) => void
}) {
  // 收起态只留一行结论：本月花了多少 + 有没有超预算。判据复用结论条的 isCostWarn（同一把尺，
  // 不另写一个"超没超"的判断——两处各写一份必然出现 summary 说没超、结论条说超了）。
  // 措辞点明是【今日】对【日预算】：本项目没有月预算，写成笼统的「未超预算」会被当成月度结论。
  const costWarn = isCostWarn(data.todayCost, data.todayStatus.avgDailyCost7, data.dailyBudget)
  const costSummary = `本月 ${formatCny(data.monthCost)} · ${costWarn ? '今日超日预算' : '今日未超日预算'}`
  return (<>
    {/* ⑥ 钱花在哪（默认收起）：费用卡 · 趋势 · 按服务 / 环节 / 用户 · 单价参考。
        锚点包裹：结论条成本黄灯 chip 的落点；summary 常驻一行结论（撤 Hero 成本卡的去向）。 */}
    <div id={ANCHOR_COST} tabIndex={-1}>
    <CollapsibleSection title="钱花在哪" subtitle={costSummary}
      rangeBadge={rangeBadge}>
      {/* 本月 + 累计（+ 今日）费用卡：日历口径（USD 副行与汇率脚注已删，方案 §六瘦身） */}
      <CostCards data={data} />
      {/* 成本口径小字（10px muted，同下方预算线注/漏斗 FunnelNote 的字号色，不自造组件）：
          自测流量已从本区块所有数字里剔除，但只对起算日之后的行成立——起算日之前无法回溯标记。
          缺省（旧部署 API 无此字段）不渲染，不对老部署凭空声明一个它没有的口径。 */}
      {data.costQaBaselineStart && (
        <div className="text-[0.625rem] text-v2-text-muted leading-relaxed mt-2">
          注：本区块所有成本数字已剔除产品方自测流量（带 QA 标记的请求）与内部账户。
          但该标记自 {data.costQaBaselineStart} 起才写入日志，此前的行无从回溯判定、仍混着自测流量——
          别拿这个日子前后的成本做同比。
        </div>
      )}
      <div className="mb-4" />

      {/* 费用趋势 + 按服务占比 */}
      <div className="flex items-center justify-end mb-2">
        {/* 筛选可发现性：点占比联动后给显式「全部」出口，否则用户不知如何清除 dim 状态 */}
        {selectedService && (
          <button onClick={() => setSelected(null)}
            className="inline-flex items-center gap-1 min-h-[44px] pl-2.5 pr-3 -my-2 rounded-full text-[0.6875rem] font-medium text-v2-text-secondary bg-black/[0.03] hover:bg-black/[0.06] transition-colors focus-visible:ring-2 focus-visible:ring-brand-primary/40">
            <span aria-hidden="true">×</span>清除筛选 · 全部
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2">
        <section aria-label="费用趋势" className="md:col-span-2 bg-white rounded-[16px] border border-black/[0.05] p-4">
          {/* 时间范围标注：趋势/饼图均为所选区间（近 N 天）口径，与上方费用卡（全部历史/本月/今日）不同源 */}
          <div className="text-[0.6875rem] text-v2-text-muted mb-1">费用趋势 · 近 {windowDays} 天</div>
          {hasRangeData
            ? <CostTrendChart data={data.dailyData} selectedService={selectedService} dailyBudget={data.dailyBudget} />
            : <div className="text-v2-text-muted text-[0.75rem] h-[180px] flex items-center justify-center">本期暂无费用数据</div>}
        </section>
        <section aria-label="按服务费用占比" className="md:col-span-1 bg-white rounded-[16px] border border-black/[0.05] p-4">
          <CostBreakdown totals={data.serviceTotals} selected={selectedService} onSelect={setSelected} rangeDays={windowDays} />
        </section>
      </div>
      <div className="text-[0.625rem] text-v2-text-muted mb-4">
        注：趋势图的日预算线 ¥{data.dailyBudget} 为内测占位参照值、非真实告警阈值——超线仅在卡片染色提示，不触发任何告警推送。
      </div>

      {/* 块A「钱花在哪个环节」：横条 + ¥金额 + 占本期总成本%（失败率拆到「出事了吗」） */}
      <PhaseCostBreakdown phases={data.phaseTotals} />
      {/* 按用户成本 Top-N 折叠收起（方案 §六瘦身）：单人日读不必每次展开一屏 UUID */}
      <details className="mb-4">
        <summary className="cursor-pointer list-none select-none min-h-[44px] flex items-center text-[0.75rem] font-medium text-v2-text-secondary [&::-webkit-details-marker]:hidden">
          按用户成本 · 展开
        </summary>
        {/* userIdentityPending 缺省（旧部署 API 无此字段）按 false 处理：不对老部署凭空喊"口径待生效" */}
        <UserCostBreakdown users={data.userTotals} anonymousCost={data.anonymousCost} loggedInCost={data.loggedInCost}
          identityPending={data.userIdentityPending === true} />
      </details>

      {/* 单价参考折叠收起（解释来源的口径小字，按三档收敛规则收进 details） */}
      <details>
        <summary className="cursor-pointer list-none select-none min-h-[44px] flex items-center text-[0.75rem] font-medium text-v2-text-secondary [&::-webkit-details-marker]:hidden">
          单价参考 · 展开
        </summary>
        <div className="bg-white rounded-[12px] border border-black/[0.05] px-4 py-3">
          <div className="text-[0.6875rem] text-v2-text-muted leading-relaxed">
            单价参考（估算依据）&nbsp;|&nbsp;豆包 ASR ≈ ¥0.003/秒&nbsp;|&nbsp;千问 Qwen Flash ≈ ¥0.0008/千token&nbsp;|&nbsp;千问 Plus ≈ ¥0.8/¥2.0 per M token（输入/输出）
          </div>
          <div className="text-[0.625rem] text-v2-text-muted mt-1.5">
            * 优先按模型返回的真实 token 计费；无真实用量时回退按字数估算（记录标 cost_source=estimate）。实际账单以各平台控制台为准。
          </div>
        </div>
      </details>
    </CollapsibleSection>
    </div>
  </>)
}
