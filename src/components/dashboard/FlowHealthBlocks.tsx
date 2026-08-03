'use client'
/**
 * @module   dashboard/FlowHealthBlocks
 * @desc     flow_events（客户端埋点表）派生的两块看板内容 —— 刻意拆成两个导出，因为它们是
 *           性质完全不同的两件事，看的频率也不同：
 *
 *           · <AiOutcomeBlock>      「AI 调用结局分布」= 产品健康（用户被什么挡住了），每天看，
 *                                    归「出事了吗」区块，与每日故障柱并排；
 *           · <FlowSelfCheckBlock>  「埋点健康 + 枚举取值覆盖」= 仪表盘自检（我的传感器还活着吗），
 *                                    一周看一次，归「看板自己还准吗」区块。
 *
 *   ⚠️ 与「计费失败」口径不同源、不该对得上：那边是【真实产生费用的调用】（api_usage_logs 记账），
 *   这边是【用户视角的尝试与结局】（含 403/402/429/400/503 这些服务端裸 return、压根不记账的早退，
 *   以及服务端结构性无痕的网络失败）。AiOutcomeBlock 底部的「口径桥接行」把这件事从一段辩解
 *   变成一个可数的桥接数字。
 *
 *   数据由父层 useFlowHealth 拉一次后同时喂给两块（理由见该 hook 顶注）。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
import type { ReactNode } from 'react'
import type {
  AiResultBucket, AiStageStat, EnumFieldCoverage, EnumValueStat,
  EventCountStat, FlowHealth, FlowHealthState, LatestOursFailure,
} from '@/hooks/useFlowHealth'
import { jumpToAnchor } from '@/components/dashboard/anchor'
import { ANCHOR_FAILURE_DETAIL } from '@/lib/dashboard-verdict'

// 部署在香港、DB 存 UTC：展示时间按东八区折算（与看板其余口径一致）
const HK_OFFSET_MS = 8 * 60 * 60 * 1000

/** ISO 时刻 → 东八区「M/D HH:mm」（「该我们修」下钻明细的时间展示用） */
function hkDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + HK_OFFSET_MS)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`
}

/** 区块外壳（沿用同页 PhaseCostBreakdown / PhaseFailureBreakdown 的卡片范式，不另造视觉） */
function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="bg-white rounded-[16px] border border-black/[0.05] p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary">{title}</h2>
        {note && <span className="text-[0.6875rem] text-v2-text-muted">{note}</span>}
      </div>
      {children}
    </section>
  )
}

/** QA 计数后缀：仅在有 QA 行时显示，让产品方能确认「自测标记确实在工作」 */
function QaSuffix({ n }: { n: number }) {
  if (n <= 0) return null
  return <span className="text-[0.6875rem] text-v2-text-muted ml-1">(+{n} 自测)</span>
}

/**
 * 分页触顶告警：触顶时以下所有计数都偏低，属于「看板在说谎」级别的事，两块都要看得见。
 * role="alert" —— 它是异步加载完才可能出现的严重告警，不主动播报等于没有。
 */
function TruncatedAlert() {
  return (
    <div role="alert" className="text-[0.6875rem] text-error mb-3">
      <span aria-hidden="true">⚠️</span> 分页触顶：以下计数偏低、不可当真实值看（该把聚合下推到 DB 端了）。
    </div>
  )
}

/**
 * 异步三态门：加载中 / 加载失败 / 有数据。
 * 容器 aria-busy + 状态区 role="status" aria-live="polite" —— 内容是异步替换进来的，
 * 读屏用户不会自己回头再读一遍这块。
 * @param state     useFlowHealth 的返回态
 * @param label     失败文案用的块名（如「AI 调用结局分布」）
 * @param children  拿到数据后的渲染函数
 */
function FlowGate({ state, label, children }: {
  state: FlowHealthState; label: string; children: (d: FlowHealth) => ReactNode
}) {
  return (
    <div aria-busy={state.loading}>
      {state.loading && (
        <div role="status" aria-live="polite" className="text-v2-text-muted text-[0.75rem] py-6 text-center">加载中…</div>
      )}
      {!state.loading && (state.error || !state.data) && (
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-2 py-6">
          <div className="text-v2-text-secondary text-[0.75rem]">{label}加载失败</div>
          <button onClick={state.reload}
            className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-full text-[0.6875rem] font-medium bg-v2-text-primary text-white focus-visible:ring-2 focus-visible:ring-brand-primary/40">
            重试
          </button>
        </div>
      )}
      {!state.loading && !state.error && state.data && children(state.data)}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ① AI 调用结局分布（产品健康）
// ══════════════════════════════════════════════════════════════════════════════

/** 归属三格的语义。色只编码「该找谁」：红 = 需要我改代码，其余不是故障、不该抢注意力。 */
const ATTRIBUTION_META: Array<{
  bucket: 'ours' | 'user' | 'network'
  label: string
  /** 该格为 0 时的常驻结论（1-2 DAU 下 0 是常态，孤零零一个 0 读者不知道该松口气还是该紧张） */
  zeroText: string
  /** 该格无明细时的常驻说明（原先只在 title 属性里，触屏与键盘都够不到） */
  hint: string
  numberCls: string
  withStage: boolean
}> = [
  { bucket: 'ours', label: '该我们修', zeroText: '本期没有该我们修的失败',
    hint: '鉴权 / 并发满 / 服务端 5xx / 返回解析失败', numberCls: 'text-error', withStage: true },
  { bucket: 'user', label: '产品/文案的事', zeroText: '本期没有被产品规则挡住的用户',
    hint: '未同意 / 额度 / 日限 / 输入不合格 / 内容为空', numberCls: 'text-v2-text-primary', withStage: false },
  { bucket: 'network', label: '端侧网络', zeroText: '本期没有端侧网络失败',
    hint: '请求没到 / 超时', numberCls: 'text-warning-text', withStage: false },
]

/** result 明细行的色：只有「该我们修」是红，其余按色彩契约降级（网络=看一眼，用户侧与打断=信息） */
const RESULT_TONE: Record<AiResultBucket, string> = {
  ok:      'text-v2-text-secondary',
  user:    'text-v2-text-secondary',
  ours:    'text-error',
  network: 'text-warning-text',
  aborted: 'text-v2-text-muted',
  other:   'text-v2-text-muted',
  missing: 'text-v2-text-muted',
}

/**
 * 真正跑到了供应商（= 会记账、每日故障柱那边看得见）的结局。
 * empty_422 = 转写返回空，调用已经发生并计费；parse_fail = 服务端返回了、客户端解析失败，同样已计费。
 */
const REACHED_RESULTS = new Set(['ok', 'empty_422', 'server_5xx', 'parse_fail'])
/** 在服务端就被挡掉（裸 return、不记账、故障柱结构性看不到）的结局 */
const BLOCKED_RESULTS = new Set(['consent_403', 'quota_402', 'rate_429', 'bad_input_400', 'busy_503', 'auth_401'])

type AttributionDetail = { text: string; count: number }
type AttributionSummary = { total: number; details: AttributionDetail[] }

/**
 * 把某一归属桶的失败跨阶段汇总成「总数 + 构成明细」。
 * @param stages     全部阶段统计
 * @param bucket     归属桶（ours / user / network）
 * @param withStage  明细是否带阶段名（「该我们修」要知道去哪个阶段修，另两格不需要）
 * @returns          该桶总次数与按次数降序的构成明细
 */
function summarizeAttribution(
  stages: AiStageStat[], bucket: 'ours' | 'user' | 'network', withStage: boolean,
): AttributionSummary {
  const map = new Map<string, number>()
  let total = 0
  for (const s of stages) {
    for (const r of s.results) {
      if (r.bucket !== bucket || r.count <= 0) continue
      total += r.count
      const key = withStage ? `${s.name} ${r.result}` : r.label
      map.set(key, (map.get(key) ?? 0) + r.count)
    }
  }
  const details = Array.from(map.entries())
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
  return { total, details }
}

/**
 * 构成明细串（最多列 3 项，多的收进「等 N 项」），视觉小字与 sr-only 表共用同一份。
 * @param sum   某归属桶的汇总
 * @param hint  无明细时的兜底说明
 */
function detailText(sum: AttributionSummary, hint: string): string {
  if (sum.details.length === 0) return hint
  const head = sum.details.slice(0, 3).map(d => `${d.text} ${d.count}`).join(' · ')
  return sum.details.length > 3 ? `${head} 等 ${sum.details.length} 项` : head
}

/**
 * 归属三格：整块最顶，「该我们修」2 倍字号。
 * 四格同大小 = 四格同重要 = 等于没分类，所以这里刻意不等大；成功不占格（它在下方阶段列表与桥接行里）。
 * 「该我们修」>0 时格内附最近一条明细 + 失败明细锚点 + 互证文案（S4 告警四件套④：静音误报教训——
 * 归类可能有误，必须给一条与计费明细互证的路）。
 * @param stages      全部阶段统计
 * @param latestOurs  「该我们修」桶最近一条失败明细（可空；旧部署 API 无此字段时 undefined 同样兜住）
 */
function AttributionGrid({ stages, latestOurs }: { stages: AiStageStat[]; latestOurs: LatestOursFailure | null }) {
  const rows = ATTRIBUTION_META.map(m => ({ meta: m, sum: summarizeAttribution(stages, m.bucket, m.withStage) }))
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
        {rows.map(({ meta, sum }) => (
          <div key={meta.bucket} className="bg-black/[0.02] rounded-[12px] px-3 py-3">
            <div className="text-[0.6875rem] text-v2-text-muted mb-1">{meta.label}</div>
            {/* 0 不染红：1-2 DAU 下 0 是常态，把常态染成警示色等于让警示色失效 */}
            <div className={`font-bold tabular-nums leading-none ${meta.bucket === 'ours' ? 'text-[2.25rem]' : 'text-[1.125rem]'} ${sum.total > 0 ? meta.numberCls : 'text-v2-text-primary'}`}>
              {sum.total}
            </div>
            <div className="text-[0.6875rem] text-v2-text-muted mt-2 leading-relaxed">
              {sum.total === 0 ? meta.zeroText : detailText(sum, meta.hint)}
            </div>
            {/* 「该我们修」格下钻（仅 >0 时）：最近一条明细 + 计费明细锚点 + 互证提示 */}
            {meta.bucket === 'ours' && sum.total > 0 && (
              <div className="mt-2 border-t border-black/[0.05] pt-2">
                {latestOurs && (
                  <div className="text-[0.6875rem] text-v2-text-secondary">
                    最近一条：{latestOurs.stageName}
                    {' · '}<span style={{ fontFamily: 'monospace' }}>{latestOurs.result}</span>
                    {' · '}<span className="tabular-nums">{hkDateTime(latestOurs.createdAt)}</span>
                  </div>
                )}
                <button onClick={() => jumpToAnchor(ANCHOR_FAILURE_DETAIL)}
                  className="inline-flex items-center min-h-[44px] text-[0.6875rem] font-medium text-v2-text-secondary underline decoration-dotted focus-visible:ring-2 focus-visible:ring-brand-primary/40">
                  查看失败明细
                </button>
                <div className="text-[0.625rem] text-v2-text-muted leading-relaxed">
                  若下方明细里的类型是空录音/网络，说明归类可能有误，以明细行的错误类型为准。
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {/* 读屏兜底表：三格是 div 排版，读屏念出来只剩一串裸数、行列关系全丢 */}
      <table className="sr-only">
        <caption>AI 调用失败按归属分类（本期，已剔除自测流量）</caption>
        <thead>
          <tr><th scope="col">归属</th><th scope="col">次数</th><th scope="col">构成</th></tr>
        </thead>
        <tbody>
          {rows.map(({ meta, sum }) => (
            <tr key={meta.bucket}>
              <th scope="row">{meta.label}</th>
              <td>{sum.total}</td>
              <td>{sum.total === 0 ? meta.zeroText : detailText(sum, meta.hint)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/**
 * 单个「有异常」阶段的明细卡：成功率 + 逐 result 明细 + 打断/未上报副行。
 * 归属四格已上移为整块顶部的三格，这里不再重复（个位数下 8 个阶段各重复四格 = 一屏的 0）。
 * @param s  该阶段的聚合统计
 */
function StageDetailCard({ s }: { s: AiStageStat }) {
  return (
    <div className="rounded-[12px] border border-black/[0.05] p-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
        <span className="text-[0.75rem] font-medium text-v2-text-primary">{s.name}</span>
        <span className="text-[0.6875rem] text-v2-text-secondary tabular-nums">
          {s.successRate === null
            ? <span className="text-v2-text-muted">无计入成功率的尝试</span>
            : <>成功率 <span className="font-semibold text-v2-text-primary">{s.successRate}%</span>
                <span className="text-v2-text-muted"> · 尝试 {s.attempts} 次</span></>}
          <QaSuffix n={s.qaRows} />
        </span>
      </div>
      <ul className="space-y-1">
        {s.results.map(r => (
          <li key={r.result} className="flex items-baseline gap-2 text-[0.6875rem]">
            <span className={`flex-1 truncate ${RESULT_TONE[r.bucket]}`} title={r.result}>
              {r.label}
              <span className="text-v2-text-muted ml-1">{r.result}</span>
            </span>
            <span className={`tabular-nums ${r.bucket === 'ours' ? 'text-error font-medium' : 'text-v2-text-primary'}`}>{r.count}</span>
            <QaSuffix n={r.qaCount} />
          </li>
        ))}
      </ul>
      {/* aborted / 未上报 result 都不进成功率分母，但都必须看得见 */}
      {(s.aborted > 0 || s.missingResult > 0) && (
        <div className="text-[0.6875rem] text-v2-text-muted mt-2 leading-relaxed">
          另有 用户跳页打断 <span className="tabular-nums">{s.aborted}</span> 次（不计失败、不入分母）
          {s.missingResult > 0 && (
            <span className="text-error">
              　·　未上报结局 <span className="tabular-nums">{s.missingResult}</span> 次（这批调用在结局分布里消失了，查调用点是否漏传 result）
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 「有尝试但全成功」阶段的一行摘要（不展开成卡片：全成功的阶段不值得占一屏）。
 * @param s  该阶段的聚合统计
 */
function stageOkLine(s: AiStageStat): string {
  const base = s.attempts > 0 ? `${s.attempts} 次 · 全部成功` : '本期无计入成功率的尝试'
  return s.aborted > 0 ? `${base}（另有 ${s.aborted} 次跳页打断）` : base
}

/** 三类阶段的划分结果 */
type StageGroups = { abnormal: AiStageStat[]; allOk: AiStageStat[]; idle: AiStageStat[] }

/**
 * 阶段三分：有异常 / 有尝试但全成功 / 本期完全没被碰过。
 * 「没被碰过」的阶段是最大的视觉噪音源（8 个阶段各占一张含四个 0 的完整卡片），全部折起来。
 * @param stages  全部阶段统计
 */
function groupStages(stages: AiStageStat[]): StageGroups {
  const abnormal: AiStageStat[] = []
  const allOk: AiStageStat[] = []
  const idle: AiStageStat[] = []
  for (const s of stages) {
    const touched = s.attempts > 0 || s.missingResult > 0 || s.aborted > 0
    if (!touched) { idle.push(s); continue }
    if (s.attempts > s.ok || s.missingResult > 0) abnormal.push(s)
    else allOk.push(s)
  }
  return { abnormal, allOk, idle }
}

/** 口径桥接行的三段数字 */
type Bridge = { attempts: number; reached: number; blocked: number; unsettled: number }

/**
 * 算「尝试 = 跑到供应商 + 服务端挡掉 + 无法判定」这三段。
 * 为什么要这三个数：它把「为什么计费口径和埋点口径对不上」从一段辩解变成一个可数的桥接数字。
 * unsettled 用减法兜底（而非正向累加），保证三段之和恒等于 attempts —— 将来加了新 result 值，
 * 也不会出现「三段加起来对不上总数」这种自打脸。
 * @param stages  全部阶段统计
 * @returns       尝试总数与三段构成
 */
function computeBridge(stages: AiStageStat[]): Bridge {
  let attempts = 0, reached = 0, blocked = 0
  for (const s of stages) {
    attempts += s.attempts
    for (const r of s.results) {
      if (r.count <= 0 || r.bucket === 'aborted') continue
      if (REACHED_RESULTS.has(r.result)) reached += r.count
      else if (BLOCKED_RESULTS.has(r.result)) blocked += r.count
    }
  }
  return { attempts, reached, blocked, unsettled: Math.max(0, attempts - reached - blocked) }
}

/**
 * 「AI 调用结局分布」整块（归「出事了吗」区块）。
 * 三层：归属三格 → 只列有异常的阶段 → 口径桥接行。
 * @param state  useFlowHealth 的返回态（与自检块共用同一份数据）
 */
export function AiOutcomeBlock({ state }: { state: FlowHealthState }) {
  return (
    <FlowGate state={state} label="AI 调用结局分布">
      {d => {
        const { abnormal, allOk, idle } = groupStages(d.aiCall)
        const bridge = computeBridge(d.aiCall)
        return (
          <Block title="AI 调用结局分布" note="用户视角的尝试与结局 · 来自客户端埋点">
            {/* 口径边界（自原 Hero「计费失败」卡移入，信息不许丢）：计费口径（上方失败柱/明细）
                看不见用户被 403/402/429/503 挡在门外与网络失败——那五类只在本块（埋点口径）可见 */}
            <div className="text-[0.625rem] text-v2-text-muted mb-3 leading-relaxed">
              用户侧早退（未同意 / 额度 / 日限 / 并发满）与网络失败不产生计费，上方失败柱与明细表看不见它们，只在本块可见。
            </div>
            {d.truncated && <TruncatedAlert />}
            <AttributionGrid stages={d.aiCall} latestOurs={d.latestOurs ?? null} />

            {abnormal.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                {abnormal.map(s => <StageDetailCard key={s.stage} s={s} />)}
              </div>
            )}

            {allOk.length > 0 && (
              <ul className="space-y-1 mb-2">
                {allOk.map(s => (
                  <li key={s.stage} className="flex items-baseline gap-2 text-[0.6875rem]">
                    <span className="text-v2-text-secondary flex-1 truncate">{s.name}</span>
                    <span className="text-v2-text-secondary tabular-nums">{stageOkLine(s)}</span>
                    <QaSuffix n={s.qaRows} />
                  </li>
                ))}
              </ul>
            )}

            {idle.length > 0 && (
              <details className="mb-2">
                <summary className="cursor-pointer list-none text-[0.6875rem] text-v2-text-muted min-h-[44px] flex items-center">
                  本期完全没被碰过的阶段：{idle.length} 个（点开看是哪些）
                </summary>
                <ul className="space-y-1 mt-1 pl-1">
                  {idle.map(s => (
                    <li key={s.stage} className="flex items-baseline gap-2 text-[0.6875rem] text-v2-text-muted">
                      <span className="flex-1 truncate">{s.name}</span>
                      <span>0 次尝试</span>
                      <QaSuffix n={s.qaRows} />
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* 口径桥接行：把「两块数字为什么对不上」变成三个能相加的数 */}
            <div className="text-[0.6875rem] text-v2-text-secondary leading-relaxed border-t border-black/[0.05] pt-2">
              {bridge.attempts === 0 ? (
                <>本期窗口内没有任何 AI 调用尝试（已剔除自测流量）。</>
              ) : (
                <>
                  本期 <span className="tabular-nums font-medium text-v2-text-primary">{bridge.attempts}</span> 次尝试
                  {' · '}其中 <span className="tabular-nums font-medium text-v2-text-primary">{bridge.reached}</span> 次真正跑到供应商（= 每日故障柱那边的口径）
                  {' · '}<span className="tabular-nums font-medium text-v2-text-primary">{bridge.blocked}</span> 次在服务端就被挡掉（不计费、故障柱看不到）
                  {bridge.unsettled > 0 && (
                    <>{' · '}<span className="tabular-nums font-medium text-v2-text-primary">{bridge.unsettled}</span> 次无法判定是否到达（网络失败 / 超时 / 未细分结局）</>
                  )}
                  。主数字均已剔除自测流量。
                </>
              )}
            </div>
          </Block>
        )
      }}
    </FlowGate>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ② 看板自检：埋点健康 + 枚举取值覆盖
// ══════════════════════════════════════════════════════════════════════════════

/** 埋点事件三分组：可能坏了 / 仅自测有数 / 有真实上报 */
type EventGroups = { dead: EventCountStat[]; qaOnly: EventCountStat[]; live: EventCountStat[]; liveRows: number }

/**
 * 埋点事件三分组。判断逻辑与原实现一致（两档零上报的可疑度差很多，不能混为一谈），
 * 变的只是展示：原先算出了摘要行、下面又把 14 行原样平铺一遍，摘要被稀释成了标题。
 * @param events  全部事件计数
 * @returns       三组事件 + 「有真实上报」组的总条数
 */
function groupEvents(events: EventCountStat[]): EventGroups {
  const dead: EventCountStat[] = []
  const qaOnly: EventCountStat[] = []
  const live: EventCountStat[] = []
  let liveRows = 0
  for (const e of events) {
    if (e.known && e.count === 0 && e.qaCount === 0) dead.push(e)
    else if (e.known && e.count === 0 && e.qaCount > 0) qaOnly.push(e)
    else { live.push(e); liveRows += e.count }
  }
  return { dead, qaOnly, live, liveRows }
}

/** 事件行（中文名 + 事件名 + 计数 + 清单外徽标） */
function EventLine({ e, tone }: { e: EventCountStat; tone: string }) {
  return (
    <li className="flex items-baseline gap-2 text-[0.6875rem]">
      <span className={`flex-1 truncate ${tone}`} title={e.event}>
        {e.label}
        <span className="text-v2-text-muted ml-1">{e.event}</span>
        {!e.known && (
          <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[0.6875rem] font-medium bg-warning/15 text-warning-text">
            清单外
          </span>
        )}
      </span>
      <span className={`tabular-nums ${tone}`}>{e.count}</span>
      <QaSuffix n={e.qaCount} />
    </li>
  )
}

/** 折叠分组（仅自测 / 有真实上报两组用）：摘要常驻、明细收起 */
function EventFoldGroup({ summary, events, tone }: { summary: string; events: EventCountStat[]; tone: string }) {
  return (
    <details className="mb-1.5">
      <summary className="cursor-pointer list-none text-[0.6875rem] text-v2-text-secondary min-h-[44px] flex items-center">
        {summary}
      </summary>
      <ul className="space-y-1 mt-1 pl-1">
        {events.map(e => <EventLine key={e.event} e={e} tone={tone} />)}
      </ul>
    </details>
  )
}

/**
 * 埋点健康：默认只显示「可能坏了」的那组（唯一需要动作的），其余折起来。
 * @param events      全部事件计数
 * @param windowDays  窗口天数（标题右侧口径小字用）
 */
function EventHealthBlock({ events, windowDays }: { events: EventCountStat[]; windowDays: number }) {
  const { dead, qaOnly, live, liveRows } = groupEvents(events)
  const unknownCount = live.filter(e => !e.known).length
  return (
    <Block title="埋点健康" note={`近 ${windowDays} 天各事件计数`}>
      <div className="text-[0.6875rem] text-v2-text-muted mb-3 leading-relaxed">
        埋点是 fire-and-forget、失败不报错（服务端 400 与 DB 约束拒绝都被静默吞掉），
        <span className="text-v2-text-secondary">「某个事件突然归零」是唯一能发现埋点坏了的信号</span>。
      </div>

      {dead.length > 0 ? (
        <div className="mb-2">
          <div className="text-[0.6875rem] text-error font-medium mb-1">
            <span aria-hidden="true">🔴</span> 可能坏了（真实与自测都为 0）：{dead.length} 个
          </div>
          <ul className="space-y-1 pl-1">
            {dead.map(e => <EventLine key={e.event} e={e} tone="text-error" />)}
          </ul>
        </div>
      ) : (
        <div className="text-[0.6875rem] text-v2-text-secondary mb-2">
          <span aria-hidden="true">✅</span>{' '}
          {qaOnly.length === 0
            ? `${events.length} 个事件全部有真实上报，埋点看起来是通的。`
            : `没有「真实与自测都为 0」的事件，埋点看起来是通的（其中 ${qaOnly.length} 个只有自测数据）。`}
        </div>
      )}

      {qaOnly.length > 0 && (
        <EventFoldGroup tone="text-v2-text-secondary"
          summary={`⚪ 仅自测有数（埋点通的，只是没人走到）：${qaOnly.length} 个`}
          events={qaOnly} />
      )}
      {live.length > 0 && (
        <EventFoldGroup tone="text-v2-text-secondary"
          summary={`✅ 有真实上报：${live.length} 个 · 共 ${liveRows} 条${unknownCount > 0 ? ` · 其中 ${unknownCount} 个是清单外事件` : ''}`}
          events={live} />
      )}
      <div className="text-[0.6875rem] text-v2-text-muted mt-2 leading-relaxed">
        「清单外」= 库里有、本看板事件清单没有（看板侧的事件名是手工对齐的副本，加新事件时要同步）。
      </div>
    </Block>
  )
}

/**
 * 单个枚举值的小片。
 * 0 次用【中性灰】而非警示色：1-2 DAU 下「某个取值本期没出现」是常态，把常态染成警示色
 * 会让整块变成满屏黄（= 等于没有黄）。真 bug 的形态是 missing（有行、字段没带），那个才染红。
 */
function EnumChip({ v }: { v: EnumValueStat }) {
  const total = v.count + v.qaCount
  const base = 'inline-flex items-baseline gap-1 px-2 py-1 rounded-[8px] text-[0.6875rem] tabular-nums'
  // 语义信息不放 title（触屏/键盘不可达，a11y 打磨包）：0 与契约外的解释走分布区底部的图例行；
  // 契约外的值再补一个可见文字后缀（不只靠色）。
  if (total === 0) {
    return (
      <span className={`${base} border border-neutral-border text-v2-text-muted`}>
        {v.value}<span className="font-medium">0</span>
      </span>
    )
  }
  return (
    <span className={`${base} bg-black/[0.03] ${v.expected ? 'text-v2-text-secondary' : 'text-warning-text'}`}>
      {v.value}
      <span className="font-medium text-v2-text-primary">{v.count}</span>
      {v.qaCount > 0 && <span className="text-v2-text-muted">+{v.qaCount} 自测</span>}
      {!v.expected && <span>· 契约外</span>}
    </span>
  )
}

/**
 * 单个枚举字段：一行摘要常驻（异常提到摘要上），取值分布折起来。
 * @param f  该字段的取值覆盖
 */
function EnumFieldRow({ f }: { f: EnumFieldCoverage }) {
  const missingTotal = f.missing + f.missingQa
  const unexpected = f.values.filter(v => !v.expected && v.count + v.qaCount > 0)
  const absent = f.values.filter(v => v.count + v.qaCount === 0)
  return (
    <div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[0.75rem] font-medium text-v2-text-primary">{f.label}</span>
        {/* missing = 该事件有行、字段却没带 —— 这才是真 bug 的形态（08-02 那三个 bug 正是如此），提为主警示 */}
        {missingTotal > 0 && (
          <span className="text-[0.6875rem] text-error font-medium tabular-nums">
            {missingTotal} 条没带这个字段（可能被 sanitize 丢了）
          </span>
        )}
        {unexpected.length > 0 && (
          <span className="text-[0.6875rem] text-warning-text">
            契约外取值 {unexpected.length} 个：{unexpected.map(v => v.value).join('、')}
          </span>
        )}
        <span className="text-[0.6875rem] text-v2-text-muted tabular-nums">
          该事件 {f.eventRows} 条<QaSuffix n={f.eventRowsQa} />
          {absent.length > 0 && ` · 未出现 ${absent.length}/${f.values.length} 个取值`}
        </span>
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer list-none text-[0.6875rem] text-v2-text-muted min-h-[44px] flex items-center">
          展开取值分布 · {f.event}.{f.field}
        </summary>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {f.values.map(v => <EnumChip key={v.value} v={v} />)}
        </div>
        {/* 图例行：原 EnumChip 的 title 信息改为可见文字（title 对触屏/键盘不可达） */}
        <div className="text-[0.625rem] text-v2-text-muted mt-1.5 leading-relaxed">
          「0」= 窗口内一次都没出现（含自测）；「契约外」= 库里出现了契约清单之外的值。
        </div>
      </details>
    </div>
  )
}

/** 枚举取值覆盖：把分布摆出来，不做自动判定 */
function EnumCoverageBlock({ fields }: { fields: EnumFieldCoverage[] }) {
  return (
    <Block title="枚举取值覆盖" note="字段没带 / 契约外取值 / 从没出现过的值">
      <div className="text-[0.6875rem] text-v2-text-muted mb-3 leading-relaxed">
        服务端对不认识的枚举值是静默丢弃：某个值一次都没出现，既可能是「该分支没触发」，
        也可能是「客户端把值拼错了 / 写死成了别的值」——分不清，所以不做自动判定，只把分布摆出来给人看。
        （2026-08-02 那批三个 bug 正是这个形态：surface 写死、mode 写死、rankingDegraded 被丢。）
        「0」含自测流量在内，也就是说：连自测都没打出来的值最可疑。
      </div>
      <div className="space-y-3">
        {fields.map(f => <EnumFieldRow key={f.key} f={f} />)}
      </div>
    </Block>
  )
}

/**
 * 「看板自己还准吗」区块的主体：数据窗口元信息 + 埋点健康 + 枚举取值覆盖。
 * 这块是仪表盘自检（我的传感器还活着吗），一周看一次，与产品健康分开。
 * @param state  useFlowHealth 的返回态（与结局分布块共用同一份数据）
 */
export function FlowSelfCheckBlock({ state }: { state: FlowHealthState }) {
  return (
    <FlowGate state={state} label="埋点自检">
      {d => {
        const qaPct = d.totalRows > 0 ? Math.round((d.qaRows / d.totalRows) * 1000) / 10 : 0
        return (
          <>
            <div className="text-[0.6875rem] text-v2-text-muted mb-3 leading-relaxed">
              窗口内埋点事件共 <span className="tabular-nums text-v2-text-secondary">{d.totalRows}</span> 条，
              其中自测（is_qa）<span className="tabular-nums text-v2-text-secondary">{d.qaRows}</span> 条 · {qaPct}%
              —— <span className="text-v2-text-secondary">所有主数字都已剔除自测流量</span>，括号里的「+N 自测」仅用于确认标记在工作、
              以及判断某条分支到底有没有被触发过。
              <br />
              真实用户数据起算日 {d.baselineStart}（更早的历史混有无法回溯标记的自测流量，见 migration 0053）。
              {d.preBaselineRows > 0 && (
                <span className="text-warning-text">　本窗口有 {d.preBaselineRows} 条早于起算日，仅供参考。</span>
              )}
            </div>
            {d.truncated && <TruncatedAlert />}
            <EventHealthBlock events={d.eventCounts} windowDays={d.windowDays} />
            <EnumCoverageBlock fields={d.enumCoverage} />
          </>
        )
      }}
    </FlowGate>
  )
}
