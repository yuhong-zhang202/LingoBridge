'use client'
/**
 * @module   dashboard/FlowHealthPanel
 * @desc     看板「客户端链路观测」区块 —— 数据源是 flow_events 埋点表（不是 api_usage_logs），
 *           三块：① AI 调用结局分布（stage × result，按「用户侧 / 我方侧 / 网络」归属分类）；
 *           ② 埋点健康（各事件计数，零计数高亮）；③ 关键枚举取值覆盖（恒缺的值标出来）。
 *
 *   ⚠️ 与「B · 故障与排障」口径不同源、不该对得上：那边是【真实产生费用的调用】（服务端记账），
 *   这边是【用户视角的尝试与结局】（含 403/402/429/400/503 这些服务端裸 return、压根不记账的早退，
 *   以及服务端结构性无痕的网络失败）。口径说明在区块顶部常驻，避免被当成「哪个数算错了」。
 *
 *   自己拉数据（独立子路由 /api/dashboard/flow-health），与主看板解耦：本块查询挂了只显本块错误。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

// ── 与 lib/db/dashboard-flow-events 的返回结构对齐（前端不 import server-only 模块的类型以外的东西）──
type AiResultBucket = 'ok' | 'user' | 'ours' | 'network' | 'aborted' | 'other' | 'missing'
type AiResultStat = { result: string; label: string; bucket: AiResultBucket; count: number; qaCount: number }
type AiStageStat = {
  stage: string; name: string; attempts: number
  ok: number; userSide: number; ourSide: number; networkSide: number; otherSide: number
  aborted: number; missingResult: number; successRate: number | null; qaRows: number
  results: AiResultStat[]
}
type EventCountStat = { event: string; label: string; count: number; qaCount: number; known: boolean }
type EnumValueStat = { value: string; count: number; qaCount: number; expected: boolean }
type EnumFieldCoverage = {
  key: string; label: string; event: string; field: string
  eventRows: number; eventRowsQa: number; missing: number; missingQa: number
  values: EnumValueStat[]
}
type FlowHealth = {
  windowDays: number; windowStart: string; baselineStart: string
  preBaselineRows: number; totalRows: number; qaRows: number; truncated: boolean
  aiCall: AiStageStat[]; eventCounts: EventCountStat[]; enumCoverage: EnumFieldCoverage[]
}

/** 区块外壳（沿用同页 PhaseCostBreakdown / PhaseFailureBreakdown 的卡片范式，不另造视觉） */
function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary">{title}</h2>
        {note && <span className="text-[0.625rem] text-v2-text-muted">{note}</span>}
      </div>
      {children}
    </section>
  )
}

/** QA 计数后缀：仅在有 QA 行时显示，让产品方能确认「自测标记确实在工作」 */
function QaSuffix({ n }: { n: number }) {
  if (n <= 0) return null
  return <span className="text-[0.5625rem] text-v2-text-muted ml-1">(+{n} 自测)</span>
}

/** 归属分类的四个汇总格：颜色只区分「该找谁」，不表示严重度 */
const BUCKET_META: Array<{ bucket: Exclude<AiResultBucket, 'aborted' | 'missing'>; label: string; hint: string; cls: string }> = [
  { bucket: 'ok',      label: '成功',   hint: '正常完成',                       cls: 'text-v2-text-primary' },
  { bucket: 'user',    label: '用户侧', hint: '未同意 / 额度 / 日限 / 输入不合格', cls: 'text-warning-text' },
  { bucket: 'ours',    label: '我方侧', hint: '鉴权 / 并发满 / 5xx / 解析失败',    cls: 'text-error' },
  { bucket: 'network', label: '网络',   hint: '请求没到 / 超时',                 cls: 'text-error' },
]

/**
 * 单个 AI 阶段的一张小卡：成功率 + 归属四格 + 逐 result 明细。
 * @param s  该阶段的聚合统计
 */
function AiStageCard({ s }: { s: AiStageStat }) {
  const counts: Record<string, number> = {
    ok: s.ok, user: s.userSide, ours: s.ourSide, network: s.networkSide,
  }
  return (
    <div className="rounded-[12px] border border-black/[0.05] p-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
        <span className="text-[0.75rem] font-medium text-v2-text-primary">{s.name}</span>
        <span className="text-[0.6875rem] text-v2-text-secondary tabular-nums">
          {s.successRate === null
            ? <span className="text-v2-text-muted">窗口内无尝试</span>
            : <>成功率 <span className="font-semibold text-v2-text-primary">{s.successRate}%</span>
                <span className="text-v2-text-muted"> · 尝试 {s.attempts} 次</span></>}
          <QaSuffix n={s.qaRows} />
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 mb-2">
        {BUCKET_META.map(b => (
          <div key={b.bucket} className="bg-black/[0.02] rounded-[8px] px-2 py-1.5 text-center" title={b.hint}>
            <div className="text-[0.5625rem] text-v2-text-muted">{b.label}</div>
            <div className={`text-[0.875rem] font-semibold tabular-nums ${b.cls}`}>{counts[b.bucket]}</div>
          </div>
        ))}
      </div>
      {/* 逐 result 明细：只列窗口内出现过的（含只在自测里出现的）；「哪些值一次都没出现」交给下方枚举覆盖块 */}
      {s.results.length === 0 ? (
        <div className="text-[0.625rem] text-v2-text-muted py-1">本窗口该阶段无任何 ai_call 事件</div>
      ) : (
        <ul className="space-y-1">
          {s.results.map(r => (
            <li key={r.result} className="flex items-baseline gap-2 text-[0.6875rem]">
              <span className="text-v2-text-secondary flex-1 truncate" title={r.result}>
                {r.label}
                <span className="text-v2-text-muted ml-1 text-[0.5625rem]">{r.result}</span>
              </span>
              <span className="tabular-nums text-v2-text-primary">{r.count}</span>
              <QaSuffix n={r.qaCount} />
            </li>
          ))}
        </ul>
      )}
      {/* aborted / 未上报 result 都不进成功率分母，但都必须看得见 */}
      {(s.aborted > 0 || s.missingResult > 0) && (
        <div className="text-[0.625rem] text-v2-text-muted mt-2 leading-relaxed">
          另有 用户跳页打断 <span className="tabular-nums">{s.aborted}</span> 次（不计失败、不入分母）
          {s.missingResult > 0 && (
            <span className="text-warning-text">
              　·　未上报结局 <span className="tabular-nums">{s.missingResult}</span> 次（这批调用在结局分布里消失了，查调用点是否漏传 result）
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** ① AI 调用结局分布 */
function AiCallBlock({ stages }: { stages: AiStageStat[] }) {
  return (
    <Block title="AI 调用结局分布" note="按阶段 × 结局，来自客户端埋点">
      <div className="text-[0.625rem] text-v2-text-muted mb-3 leading-relaxed">
        口径：用户视角的【尝试与结局】，含服务端早退（未同意 403 / 额度 402 / 日限 429 / 输入 400 / 并发满 503）
        与网络失败 —— 这些在「B · 故障与排障」里一条都看不到，因为那边只统计【真实产生费用的调用】。
        两块数字对不上是预期，不是哪边算错了。
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {stages.map(s => <AiStageCard key={s.stage} s={s} />)}
      </div>
    </Block>
  )
}

/** ② 埋点健康：重点是零计数的事件 */
function EventHealthBlock({ events, windowDays }: { events: EventCountStat[]; windowDays: number }) {
  // 零上报分两档，可疑度差很多：
  //   · 真实与自测【都】为 0 —— 最可疑，埋点可能压根没通（服务端 400 / DB CHECK 拒绝都被静默吞掉）；
  //   · 只有真实为 0、自测有数 —— 埋点代码本身是通的，多半只是这窗口没有真实用户走这条路径。
  const deadZero = events.filter(e => e.known && e.count === 0 && e.qaCount === 0)
  const qaOnly   = events.filter(e => e.known && e.count === 0 && e.qaCount > 0)
  return (
    <Block title="埋点健康" note={`近 ${windowDays} 天各事件计数`}>
      <div className="text-[0.625rem] text-v2-text-muted mb-3 leading-relaxed">
        埋点是 fire-and-forget、失败不报错（服务端 400 与 DB 约束拒绝都被静默吞掉），
        <span className="text-warning-text">「某个事件突然归零」是唯一能发现埋点坏了的信号</span>，所以零计数也占一行。
      </div>
      {deadZero.length > 0 && (
        <div className="text-[0.6875rem] text-warning-text mb-2">
          真实与自测<span className="font-semibold">都为 0</span>（最可疑，埋点可能没通）：
          {deadZero.map(e => e.label).join('、')}
        </div>
      )}
      {qaOnly.length > 0 && (
        <div className="text-[0.6875rem] text-v2-text-secondary mb-2">
          仅自测有数、真实用户零上报（埋点本身是通的，多半是本窗口没真实用户走到）：
          {qaOnly.map(e => e.label).join('、')}
        </div>
      )}
      <ul className="space-y-1">
        {events.map(e => {
          // 只有「真实与自测都为 0」才染警示色；仅真实为 0（自测有数）不报警，避免天天亮着无人理
          const alarm = e.count === 0 && e.qaCount === 0
          return (
          <li key={e.event} className="flex items-baseline gap-2 text-[0.6875rem]">
            <span className={`flex-1 truncate ${alarm ? 'text-warning-text' : 'text-v2-text-secondary'}`} title={e.event}>
              {e.label}
              <span className="text-v2-text-muted ml-1 text-[0.5625rem]">{e.event}</span>
              {!e.known && (
                <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[0.5625rem] font-medium bg-warning/15 text-warning-text">
                  清单外
                </span>
              )}
            </span>
            <span className={`tabular-nums ${alarm ? 'text-warning-text font-medium' : 'text-v2-text-primary'}`}>{e.count}</span>
            <QaSuffix n={e.qaCount} />
          </li>
          )
        })}
      </ul>
      <div className="text-[0.625rem] text-v2-text-muted mt-2 leading-relaxed">
        「清单外」= 库里有、本看板事件清单没有（看板侧的事件名是手工对齐的副本，加新事件时要同步）。
      </div>
    </Block>
  )
}

/** 单个枚举值的小片：0 次用虚线弱化但不隐藏（恒缺才是要看的东西） */
function EnumChip({ v }: { v: EnumValueStat }) {
  const total = v.count + v.qaCount
  const base = 'inline-flex items-baseline gap-1 px-2 py-1 rounded-[8px] text-[0.625rem] tabular-nums'
  if (total === 0) {
    return (
      <span className={`${base} border border-dashed border-warning/50 text-warning-text`} title="窗口内一次都没出现（含自测）">
        {v.value}<span className="font-medium">0</span>
      </span>
    )
  }
  return (
    <span className={`${base} bg-black/[0.03] ${v.expected ? 'text-v2-text-secondary' : 'text-warning-text'}`}
      title={v.expected ? undefined : '契约清单外的值'}>
      {v.value}
      <span className="font-medium text-v2-text-primary">{v.count}</span>
      {v.qaCount > 0 && <span className="text-[0.5625rem] text-v2-text-muted">+{v.qaCount} 自测</span>}
    </span>
  )
}

/** ③ 枚举取值覆盖：把分布摆出来，不做自动判定 */
function EnumCoverageBlock({ fields }: { fields: EnumFieldCoverage[] }) {
  return (
    <Block title="枚举取值覆盖" note="哪些值从来没出现过">
      <div className="text-[0.625rem] text-v2-text-muted mb-3 leading-relaxed">
        服务端对不认识的枚举值是<span className="text-warning-text">静默丢弃</span>：某个值一次都没出现，
        既可能是「该分支没触发」，也可能是「客户端把值拼错了 / 写死成了别的值」——
        <span className="text-warning-text">分不清，所以不做自动判定</span>，只把分布摆出来给人看。
        （2026-08-02 那批三个 bug 正是这个形态：surface 写死、mode 写死、rankingDegraded 被丢。）
        「0」含自测流量在内，也就是说：连自测都没打出来的值最可疑。
      </div>
      <div className="space-y-3">
        {fields.map(f => (
          <div key={f.key}>
            <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
              <span className="text-[0.75rem] font-medium text-v2-text-primary">{f.label}</span>
              <span className="text-[0.5625rem] text-v2-text-muted">{f.event}.{f.field}</span>
              <span className="text-[0.625rem] text-v2-text-muted tabular-nums">
                本窗口该事件 {f.eventRows} 条<QaSuffix n={f.eventRowsQa} />
              </span>
              {(f.missing + f.missingQa) > 0 && (
                <span className="text-[0.625rem] text-warning-text tabular-nums">
                  其中 {f.missing + f.missingQa} 条没带这个字段（可能被 sanitize 丢了）
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {f.values.map(v => <EnumChip key={v.value} v={v} />)}
            </div>
          </div>
        ))}
      </div>
    </Block>
  )
}

/**
 * 「客户端链路观测」区块主体：自己按 range 拉 /api/dashboard/flow-health 并渲染三块。
 * @param range  时间范围参数（'7d' | '14d' | '30d'，跟随主看板的区间选择器）
 */
export default function FlowHealthPanel({ range }: { range: string }) {
  const [data, setData] = useState<FlowHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(false)
    ;(async () => {
      try {
        const res = await apiFetch(`/api/dashboard/flow-health?range=${range}`, { signal: ac.signal })
        if (ac.signal.aborted) return
        if (!res.ok) { setError(true); setLoading(false); return }
        const d = (await res.json()) as FlowHealth
        if (ac.signal.aborted) return
        setData(d); setLoading(false)
      } catch {
        if (ac.signal.aborted) return          // 中断不算错误，忽略
        setError(true); setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [range, reloadKey])

  if (loading) return <div className="text-v2-text-muted text-[0.75rem] py-6 text-center">加载中…</div>
  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <div className="text-v2-text-secondary text-[0.75rem]">客户端链路观测加载失败</div>
        <button onClick={() => setReloadKey(k => k + 1)}
          className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-full text-[0.6875rem] font-medium bg-v2-text-primary text-white">
          重试
        </button>
      </div>
    )
  }

  const qaPct = data.totalRows > 0 ? Math.round((data.qaRows / data.totalRows) * 1000) / 10 : 0
  return (
    <>
      {/* 顶部元信息：QA 占比（确认标记在工作）+ 起算日 + 截断告警 */}
      <div className="text-[0.625rem] text-v2-text-muted mb-3 leading-relaxed">
        窗口内埋点事件共 <span className="tabular-nums text-v2-text-secondary">{data.totalRows}</span> 条，
        其中自测（is_qa）<span className="tabular-nums text-v2-text-secondary">{data.qaRows}</span> 条 · {qaPct}%
        —— <span className="text-v2-text-secondary">下面所有主数字都已剔除自测流量</span>，括号里的「+N 自测」仅用于确认标记在工作、
        以及判断某条分支到底有没有被触发过。
        <br />
        真实用户数据起算日 {data.baselineStart}（更早的历史混有无法回溯标记的自测流量，见 migration 0053）。
        {data.preBaselineRows > 0 && (
          <span className="text-warning-text">　本窗口有 {data.preBaselineRows} 条早于起算日，仅供参考。</span>
        )}
      </div>
      {data.truncated && (
        <div className="text-[0.6875rem] text-error mb-3">
          ⚠️ 分页触顶：以上计数偏低、不可当真实值看（该把聚合下推到 DB 端了）。
        </div>
      )}
      <AiCallBlock stages={data.aiCall} />
      <EventHealthBlock events={data.eventCounts} windowDays={data.windowDays} />
      <EnumCoverageBlock fields={data.enumCoverage} />
    </>
  )
}
