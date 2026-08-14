'use client'
/**
 * @module   dashboard/CohortGrowthBlocks
 * @desc     「谁留下了」区的三块群组内容，拆成三个导出（三件不同的事，看的频率也不同）：
 *             · <RetentionSeriesBlock>  W1 留存曲线（按周，**每点必须标 n**）
 *             · <StickinessBlock>       粘性比 DAU/MAU 每日曲线
 *             · <UserSegmentsBlock>     用户分层 × 各层 W1 留存 + 核心活跃人数拆分
 *
 *   【为什么每个点都要标 n】内测期一个群组可能只有 2 个人，50% 与 0% 之间只差一个人；
 *   单独显示百分比就是假精度，本项目已反复吃过这个亏（CohortReturnTable 干脆只给分子分母）。
 *
 *   【图表的 a11y 标准（本项目既有）】SVG 对读屏不可读 ⇒ role="img" + 概述 aria-label +
 *   下方数据表兜底，三件缺一不可（范式见 EngagementTrendChart）。
 *   ⚠️ 留存那块的数据表【是可见的】而非 sr-only：它同时承担「每点标 n」这条硬要求，
 *      不能只押在 recharts 的 LabelList 上（那段只在浏览器里绘制，服务端渲染验不到）。
 *
 *   【颜色】线用 Tailwind 的 stroke-* 工具类；stroke="currentColor" 是它没生效时的兜底
 *   （容器已给 text-* token），全文件零内联色值。
 *
 * @author   LingoBridge
 * @created  2026-08-15
 */
import type { ReactNode } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts'
import type {
  GrowthState, GrowthCohortsResponse, RetentionPoint, StickinessPoint,
} from '@/hooks/useGrowthMetrics'

/** 区块外壳（沿用同页 FlowHealthBlocks 的 Block 范式，不另造视觉） */
function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="bg-white rounded-[16px] border border-black/[0.05] p-4 mt-3">
      <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary">{title}</h2>
        {note && <span className="text-[0.6875rem] text-v2-text-muted">{note}</span>}
      </div>
      {children}
    </section>
  )
}

/** 口径小字（10px muted，与全页同级） */
function Note({ children }: { children: ReactNode }) {
  return <div className="text-[0.625rem] text-v2-text-muted leading-relaxed mt-2">{children}</div>
}

/** 三态里的「读不到 / 加载中 / 迁移未跑」一行（措辞区分开：读不到 ≠ 还没接入 ≠ 没有样本） */
function Status({ loading, error, pending, pendingText }: {
  loading: boolean; error: boolean; pending: boolean; pendingText: string
}) {
  if (error) return <div className="text-v2-text-muted text-[0.75rem] py-2">数据暂时读取失败，刷新页面重试。</div>
  if (pending) return <div className="text-v2-text-muted text-[0.75rem] py-2 leading-relaxed">{pendingText}</div>
  if (loading) return <div className="text-v2-text-muted text-[0.75rem] py-2">加载中…</div>
  return null
}

/** 'YYYY-MM-DD' → 'M/D'（与看板其余日期轴的写法一致：斜杠、无前导零） */
function shortDate(iso: string): string {
  const [, mm, dd] = iso.split('-')
  return `${Number(mm)}/${Number(dd)}`
}

// ══════════════════════════════════════════════════════════════════════════════
// ① W1 留存曲线
// ══════════════════════════════════════════════════════════════════════════════

/** 曲线一个点的图表形态（nLabel 预先拼好：省掉 recharts formatter，也保证每点都带 n） */
type RetentionChartPoint = { week: string; rate: number | null; nLabel: string; cohortN: number; returnedN: number }

/**
 * W1 留存曲线（按周）
 * @param state  /api/dashboard/growth/cohorts 的三态
 */
export function RetentionSeriesBlock({ state }: { state: GrowthState<GrowthCohortsResponse> }) {
  const res = state.data
  const series: RetentionPoint[] | null = res?.retentionSeries ?? null
  const points: RetentionChartPoint[] = (series ?? []).map(p => ({
    week: shortDate(p.weekStart),
    rate: p.rate,
    nLabel: `n=${p.cohortN}`,
    cohortN: p.cohortN,
    returnedN: p.returnedN,
  }))

  return (
    <Block title="W1 首周留存曲线" note="按自然周（周一起算）">
      <Status loading={state.loading} error={state.error} pending={res?.retentionSeriesPending === true}
        pendingText="W1 留存曲线 RPC（get_weekly_retention_series）尚未接入，待部署方跑迁移 0065 后自动显示。" />

      {/* 空数组【不是】降级：那表示回看范围内没有任何成熟群组，与读不到数是两件事 */}
      {series !== null && series.length === 0 && (
        <div className="text-v2-text-secondary text-[0.6875rem] leading-relaxed">
          回看范围内还没有【满 7 天】的成熟群组 —— 这不是 0%，是还没到能算的时候。
        </div>
      )}

      {points.length > 0 && (<>
        <div className="text-v2-text-muted" role="img"
          aria-label={`W1 首周留存曲线，共 ${points.length} 周。${points.map(p => `${p.week} 那周 ${p.cohortN} 人，其中 ${p.returnedN} 人回来${p.rate === null ? '' : `，留存 ${p.rate}%`}`).join('；')}。详细数据见下方数据表。`}>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={points} margin={{ top: 16, right: 12, bottom: 0, left: -24 }}>
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'currentColor' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'currentColor' }} tickLine={false} axisLine={false}
                allowDecimals={false} width={36} domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="rate" className="stroke-brand-primary" stroke="currentColor"
                strokeWidth={1.5} dot={{ r: 2 }} isAnimationActive={false} connectNulls={false}>
                {/* 每点标 n：分母不显示的话，个位数群组的百分比就是假精度 */}
                <LabelList dataKey="nLabel" position="top" fontSize={10} fill="currentColor" />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 这张表【刻意可见】，不是 sr-only 兜底：产品方硬性要求「每点标 n」，而图上的 n 标签
            由 recharts 在浏览器里绘制，服务端渲染产物里验不到 —— 把 n 只押在图上，等于把一条
            硬要求押在一个我无法验证的渲染分支上。表里给出的分子/分母是那条要求的可靠承载。 */}
        <table className="w-full text-[0.6875rem] mt-2">
          <caption className="text-left text-[0.625rem] text-v2-text-muted pb-1 leading-relaxed">
            W1 首周留存 · 分母 = 该周首次核心活跃且已满 7 天的注册用户，分子 = 其中 D+1~D+7 再次活跃的人
          </caption>
          <thead className="hidden md:table-header-group">
            <tr className="border-b border-black/[0.04]">
              <th scope="col" className="px-2 py-1.5 text-left font-medium text-v2-text-muted">群组周</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium text-v2-text-muted">群组人数 n</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium text-v2-text-muted">回来人数</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium text-v2-text-muted">留存率</th>
            </tr>
          </thead>
          <tbody>
            {points.map(p => (
              <tr key={p.week} className="block md:table-row border-b border-black/[0.03] py-1.5 md:py-0">
                <th scope="row" className="block md:table-cell px-2 py-0.5 md:py-2 text-left font-medium text-v2-text-primary tabular-nums">{p.week}</th>
                <td className="block md:table-cell px-2 py-0.5 md:py-2 md:text-right tabular-nums text-v2-text-secondary">
                  <span className="md:hidden text-v2-text-muted">群组人数：</span>n={p.cohortN}
                </td>
                <td className="block md:table-cell px-2 py-0.5 md:py-2 md:text-right tabular-nums text-v2-text-secondary">
                  <span className="md:hidden text-v2-text-muted">回来人数：</span>{p.returnedN} 人
                </td>
                <td className="block md:table-cell px-2 py-0.5 md:py-2 md:text-right tabular-nums text-v2-text-secondary">
                  <span className="md:hidden text-v2-text-muted">留存率：</span>
                  {p.rate === null ? <span className="text-v2-text-muted">无成熟群组</span> : `${p.rate}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>)}

      <Note>
        n = 该周的群组人数（分母），图上每点与下表各标一份。最新一周可能人很少甚至缺席：首活日未满 7 天的人整个不进分母
        —— 那是刻意的，把他们计进去会把最新那一格系统性压低。
      </Note>
    </Block>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ② 粘性比 DAU/MAU
// ══════════════════════════════════════════════════════════════════════════════

/** 粘性曲线一个点的图表形态 */
type StickinessChartPoint = { day: string; ratio: number | null; dau: number; mau: number }

/**
 * 粘性比 DAU/MAU 曲线
 * @param state  /api/dashboard/growth/cohorts 的三态
 */
export function StickinessBlock({ state }: { state: GrowthState<GrowthCohortsResponse> }) {
  const res = state.data
  const series: StickinessPoint[] | null = res?.stickiness ?? null
  const points: StickinessChartPoint[] = (series ?? []).map(p => ({
    day: shortDate(p.day), ratio: p.ratio, dau: p.dau, mau: p.mau,
  }))

  return (
    <Block title="粘性 DAU/MAU" note="MAU 为滚动 30 天">
      <Status loading={state.loading} error={state.error} pending={res?.stickinessPending === true}
        pendingText="粘性 RPC（get_stickiness_series）尚未接入，待部署方跑迁移 0065 后自动显示。" />

      {series !== null && series.length === 0 && (
        <div className="text-v2-text-secondary text-[0.6875rem]">本窗口内没有任何一天有核心活跃记录。</div>
      )}

      {points.length > 0 && (<>
        <div className="text-v2-text-muted" role="img"
          aria-label={`粘性比 DAU/MAU 曲线，共 ${points.length} 天，末日 DAU ${points[points.length - 1].dau} 人、MAU ${points[points.length - 1].mau} 人。详细数据见下方数据表。`}>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'currentColor' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'currentColor' }} tickLine={false} axisLine={false}
                width={36} domain={[0, 1]} />
              <Tooltip />
              <Line type="monotone" dataKey="ratio" className="stroke-brand-accent" stroke="currentColor"
                strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <table className="sr-only">
          <caption>粘性比 DAU/MAU（DAU = 当日核心活跃注册用户，MAU = 以该日为右端点回看 30 天的去重人数）</caption>
          <thead>
            <tr>
              <th scope="col">日期</th>
              <th scope="col">DAU</th>
              <th scope="col">MAU</th>
              <th scope="col">DAU/MAU</th>
            </tr>
          </thead>
          <tbody>
            {points.map(p => (
              <tr key={p.day}>
                <th scope="row">{p.day}</th>
                <td>{p.dau}</td>
                <td>{p.mau}</td>
                <td>{p.ratio === null ? '当日 MAU 为 0，比值不成立' : p.ratio}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>)}

      <Note>
        单点几乎没有解释力：内测期一个人的进出就能让比值跳十几个点，要看的是形状不是某一天。
        窗口最左边那几天的 MAU 用到了窗口外的数据（滚动 MAU 本就如此），别拿「窗口内总人数」去核对。
      </Note>
    </Block>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ③ 用户分层 × 各层留存 + 核心活跃拆分
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 用户分层与核心活跃拆分
 * @param state  /api/dashboard/growth/cohorts 的三态
 */
export function UserSegmentsBlock({ state }: { state: GrowthState<GrowthCohortsResponse> }) {
  const res = state.data
  const seg = res?.segments ?? null

  return (
    <Block title="用户分层 × 各层留存" note="分母 = 窗口内来过的人">
      <Status loading={state.loading} error={state.error} pending={res?.segmentsPending === true}
        pendingText="分层 RPC（get_user_segments）尚未接入，待部署方跑迁移 0065 后自动显示。" />

      {seg && (<>
        <table className="w-full text-[0.6875rem]">
          <caption className="text-left text-[0.625rem] text-v2-text-muted pb-2 leading-relaxed">
            四层用户与各层 W1 留存。前三层互斥，「高频用户」与它们【正交】—— 四行相加没有意义，也绝不可画成饼图。
          </caption>
          <thead className="hidden md:table-header-group">
            <tr className="border-b border-black/[0.04]">
              <th scope="col" className="px-2 py-1.5 text-left font-medium text-v2-text-muted">分层</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium text-v2-text-muted">人数</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium text-v2-text-muted">占来过的人</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium text-v2-text-muted">W1 留存</th>
            </tr>
          </thead>
          <tbody>
            {seg.segments.map(s => (
              <tr key={s.key} className="block md:table-row border-b border-black/[0.03] py-2 md:py-0">
                <th scope="row" className="block md:table-cell px-2 py-0.5 md:py-2 text-left font-medium text-v2-text-primary">{s.label}</th>
                <td className="block md:table-cell px-2 py-0.5 md:py-2 md:text-right tabular-nums text-v2-text-secondary">
                  <span className="md:hidden text-v2-text-muted">人数：</span>{s.users} 人
                </td>
                <td className="block md:table-cell px-2 py-0.5 md:py-2 md:text-right tabular-nums text-v2-text-secondary">
                  <span className="md:hidden text-v2-text-muted">占来过的人：</span>
                  {s.share === null ? <span className="text-v2-text-muted">窗口内无人</span> : `${s.share}%`}
                </td>
                <td className="block md:table-cell px-2 py-0.5 md:py-2 md:text-right tabular-nums text-v2-text-secondary">
                  <span className="md:hidden text-v2-text-muted">W1 留存：</span>
                  {s.w1Rate === null
                    ? <span className="text-v2-text-muted">层内还没有满 7 天的人</span>
                    : <>{s.w1Ret}/{s.w1N}（{s.w1Rate}%）</>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="text-[0.6875rem] text-v2-text-secondary mt-3 leading-relaxed">
          核心活跃 <span className="tabular-nums font-medium text-v2-text-primary">{seg.coreActive}</span> 人里混了谁：
          {seg.coreSplit.map((c, i) => (
            <span key={c.key}>
              {i > 0 && ' · '}
              {c.label} <span className="tabular-nums font-medium text-v2-text-primary">{c.users}</span> 人
              {c.share !== null && <span className="text-v2-text-muted">（{c.share}%）</span>}
            </span>
          ))}
        </div>

        <Note>
          分层人群 {seg.segmentBase} 人 = 窗口内【核心活跃 ∪ 有新增语料】的注册用户，不是全部注册用户
          （用全部注册用户当分母，占比之和会永远远小于 1、且随窗口长度漂移）。
          每层的 W1 分母必然小于该层人数：首活日未满 7 天的人不进分母，那不是算错。
          核心活跃拆分的三档互斥，之和等于核心活跃人数。
        </Note>
      </>)}
    </Block>
  )
}
