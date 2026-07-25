'use client'
/**
 * @module   dashboard/RecentCallsTable
 * @desc     API 调用明细表格，可在「最近」（时间序）/「最贵」（成本降序 Top-N）/「失败」三视图间切换；
 *           调用方可用 views 限定只渲染其中某几个视图（故障组只给失败、技术明细组给最近/最贵）。
 *           · 失败视图列序 = 环节 / 错误码 / 服务 / 延迟 / 费用 / 时间：删「状态」（全是失败、零信息）、
 *             删「接口/用量」，把环节提到最前、时间挪到最右，并展示 error_code（hover/小字见 error_message），
 *             让「并发超限 / 真故障」一眼可辨。
 *           · 最近/最贵视图列序保持原样（时间 / 服务 / 接口 / 用量 / 费用 / 延迟 / 状态）。
 *           · 延迟一律以秒展示（保留 1 位小数），与看板其余口径统一。
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { useState } from 'react'
import { formatCny } from '@/lib/format-cost'

type Log = { id: string; created_at: string; service: string; endpoint: string
  usage_amount: number; usage_unit: string; estimated_cost_cny: number; latency_ms: number; status: string
  metadata?: { phase?: string; cost_source?: string; error_kind?: string; error_code?: string; error_message?: string; logId?: string } | null }
const SVC: Record<string, [string, string]> = {
  doubao_asr:    ['豆包 ASR',      '#D4875A'],
  qwen_flash:    ['千问 Qwen',     '#7BA699'],
  qwen_plus:     ['千问 Plus',     '#6FA8C8'],
}
// 环节（metadata.phase）中文名：与 dashboard/route.ts 的 PHASE_META 同源。失败视图「环节」列据此显示，
// 缺 phase（埋点前的历史失败行）显示「未标注」而非生 key。
const PHASE_LABEL: Record<string, string> = {
  extraction: '观察点萃取', ranking: '题目重排', matching: '匹配', analysis: '侧重点分析',
  coach: '教练对话', phrases: '词组生成', pronounce: '发音提示', restructure: '语料整理',
  polish: '单句润色', transcribe: '语音转写', anki_answer: '卡背生成', other: '其他',
}
// 承载文字改用 v2-text-secondary（达 AA 对比度），服务色只做左侧圆点点缀，不再压白当文字色（a11y 正文级）。
function Badge({ s }: { s: string }) {
  const [n, c] = SVC[s] ?? [s, '#A89990']
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border border-black/[0.06] bg-black/[0.02] text-v2-text-secondary">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />{n}
    </span>
  )
}
// 估/实角标：区分回退估算（estimate）与真实计费（actual）。缺 cost_source（如 ASR 按真实时长）视为实。
function SourceTag({ src }: { src?: string }) {
  const isEstimate = src === 'estimate'
  return (
    <span className={`inline-flex items-center px-1 py-px rounded text-[9px] font-medium ${isEstimate ? 'bg-warning/15 text-warning-text' : 'bg-tag-success-bg text-tag-success-text'}`}>
      {isEstimate ? '估' : '实'}
    </span>
  )
}
// 最近/最贵视图列序（含成功行，故保留「状态」）。失败视图列序独立、见 FAILED_COLS。
const BASE_COLS = ['时间', '服务', '接口', '用量', '费用', '延迟', '状态']
// 失败视图列序（pm 方案 §2.1）：环节提到最前、时间挪到最右，删状态/接口/用量，新增错误码。
const FAILED_COLS = ['环节', '错误码', '服务', '延迟', '费用', '时间']
const SHOW = 20
type Mode = 'recent' | 'costly' | 'failed'
const MODE_LABEL: Record<Mode, string> = { recent: '最近', costly: '最贵', failed: '失败' }
// 空态文案分视图给：失败视图沿用「暂无调用记录」会让人以为查询坏了，实际是"这段时间没出事"
const EMPTY_TEXT: Record<Mode, string> = {
  recent: '暂无调用记录', costly: '暂无调用记录', failed: '本期无失败调用',
}
// error_kind 中文名：user_input = 用户输入问题（如没有人声的空录音）；capacity = 容量繁忙（并发超限、人多稍等）。
// 二者服务本身都是好的、不计系统故障；缺该键的失败按系统故障计（与 API 侧 isSystemError 一致）。
const ERROR_KIND_LABEL: Record<string, string> = { user_input: '用户输入', capacity: '容量繁忙' }
// 时间列按东八区（UTC+8，香港节点无夏令时）展示，与看板其余"今日/日界"口径一致；
// DB 存 UTC，直接用浏览器本地时区会随访问者所在地漂移。折算后统一取 getUTC* 读墙上钟。
const HK_OFFSET_MS = 8 * 60 * 60 * 1000
/** 毫秒转秒（1 位小数）：延迟展示单位全看板统一为秒 */
function toSec(ms: number): string {
  return (ms / 1000).toFixed(1)
}
/** 环节中文名：缺 phase 显示「未标注」（埋点前历史失败行） */
function phaseName(log: Log): string {
  const p = log.metadata?.phase
  if (!p) return '未标注'
  return PHASE_LABEL[p] ?? p
}
/** error_kind 小徽标：仅在有 kind 时渲染，暖色提示「非系统故障」；无则不占位 */
function KindChip({ kind }: { kind?: string }) {
  if (!kind) return null
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-warning/15 text-warning-text whitespace-nowrap">
      {ERROR_KIND_LABEL[kind] ?? kind}
    </span>
  )
}

/**
 * 调用明细表格，可在「最近」/「最贵」/「失败」视图切换（由 views 决定渲染哪些）
 * @param recentLogs  时间序最新调用（最多 30 条，表格展示前 20）
 * @param costlyLogs  按成本降序的 Top-N 调用
 * @param failedLogs  区间内全部失败调用（时间倒序），每日失败柱图的下钻出口
 * @param views       可切换的视图集合（默认三个全给）；单视图时不渲染切换器
 * @param defaultMode 初始视图（默认取 views 首项）
 */
export default function RecentCallsTable({
  recentLogs, costlyLogs, failedLogs,
  views = ['recent', 'costly', 'failed'], defaultMode,
}: {
  recentLogs: Log[]; costlyLogs: Log[]; failedLogs: Log[]
  views?: Mode[]; defaultMode?: Mode
}) {
  const [mode, setMode] = useState<Mode>(defaultMode ?? views[0])
  const source  = mode === 'recent' ? recentLogs : mode === 'costly' ? costlyLogs : failedLogs
  // 「最近」是无限增长的时间序，截前 20 条即可；「最贵」「失败」本身已是有界榜单，全量展示
  const visible = mode === 'recent' ? source.slice(0, SHOW) : source
  const extra   = mode === 'recent' ? recentLogs.length - SHOW : 0
  const cols    = mode === 'failed' ? FAILED_COLS : BASE_COLS
  return (
    <div className="bg-white rounded-[16px] border border-black/[0.05] overflow-hidden">
      <div className="px-4 py-3 border-b border-black/[0.04] flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-v2-text-primary">{mode === 'failed' && views.length === 1 ? '失败明细' : '调用明细'}</h2>
        {/* 视图切换：命中区 min-h-[44px] 达触控标准。单视图（如故障组只给失败）时不渲染切换器 */}
        {views.length > 1 && (
          <div className="flex bg-black/[0.03] rounded-full p-0.5 gap-0.5" role="group" aria-label="调用明细视图">
            {views.map(m => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                className={`inline-flex items-center justify-center min-h-[44px] px-3 rounded-full text-[11px] font-medium transition-colors ${mode === m ? 'bg-white text-v2-text-primary shadow-sm' : 'text-v2-text-muted'}`}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-black/[0.04]">
              {cols.map(h => <th key={h} className="px-3 py-2 text-left font-medium text-v2-text-muted whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={cols.length} className="px-3 py-10 text-center text-v2-text-muted">{EMPTY_TEXT[mode]}</td>
              </tr>
            )}
            {visible.map(log => {
              const d = new Date(new Date(log.created_at).getTime() + HK_OFFSET_MS)  // 折算到东八区墙上钟
              const hm = `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`
              // 最贵/失败视图的记录可能跨天，仅显示时:分会歧义，补月/日
              const when = mode === 'recent' ? hm : `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hm}`
              if (mode === 'failed') {
                // 失败视图列序：环节 / 错误码 / 服务 / 延迟 / 费用 / 时间
                return (
                  <tr key={log.id} className="border-b border-black/[0.03] hover:bg-cream-subtle transition-colors">
                    <td className="px-3 py-2 text-v2-text-secondary whitespace-nowrap">{phaseName(log)}</td>
                    {/* 错误码 + 供应商 message（hover title + 小字）：一眼分「并发超限 45000292 / 真故障」 */}
                    <td className="px-3 py-2" title={log.metadata?.error_message ?? undefined}>
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className="text-v2-text-primary" style={{ fontFamily: 'monospace', fontSize: 10 }}>
                          {log.metadata?.error_code ?? '—'}
                        </span>
                        <KindChip kind={log.metadata?.error_kind} />
                      </div>
                      {log.metadata?.error_message && (
                        <div className="text-[9px] text-v2-text-muted max-w-[200px] truncate">{log.metadata.error_message}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap"><Badge s={log.service} /></td>
                    <td className="px-3 py-2 text-v2-text-secondary whitespace-nowrap tabular-nums">{toSec(log.latency_ms)}s</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-semibold text-v2-text-primary tabular-nums">{formatCny(log.estimated_cost_cny)}</span>
                        <SourceTag src={log.metadata?.cost_source} />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-v2-text-muted whitespace-nowrap">{when}</td>
                  </tr>
                )
              }
              // 最近/最贵视图列序（原样）：时间 / 服务 / 接口 / 用量 / 费用 / 延迟 / 状态
              return (
                <tr key={log.id} className="border-b border-black/[0.03] hover:bg-cream-subtle transition-colors">
                  <td className="px-3 py-2 text-v2-text-muted whitespace-nowrap">{when}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><Badge s={log.service} /></td>
                  <td className="px-3 py-2 text-v2-text-muted whitespace-nowrap"
                    style={{ fontFamily: 'monospace', fontSize: 10 }}>
                    {log.endpoint.split('/').pop() ?? log.endpoint}
                  </td>
                  <td className="px-3 py-2 text-v2-text-secondary whitespace-nowrap">{log.usage_amount.toFixed(1)} {log.usage_unit}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-semibold text-v2-text-primary tabular-nums">{formatCny(log.estimated_cost_cny)}</span>
                      <SourceTag src={log.metadata?.cost_source} />
                    </span>
                  </td>
                  <td className="px-3 py-2 text-v2-text-secondary whitespace-nowrap tabular-nums">{toSec(log.latency_ms)}s</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${log.status === 'success' ? 'bg-success' : 'bg-error'}`} />
                      <span className="text-v2-text-secondary">{log.status === 'success' ? '成功' : '失败'}</span>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {extra > 0 && (
        <div className="px-4 py-2.5 text-center text-[11px] text-v2-text-muted border-t border-black/[0.04]">
          还有 {extra} 条记录未显示
        </div>
      )}
    </div>
  )
}
