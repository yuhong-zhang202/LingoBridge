'use client'
/**
 * @module   dashboard/RecentCallsTable
 * @desc     API 调用明细表格，可在「最近」（时间序）/「最贵」（成本降序 Top-N）/「失败」三视图间切换。
 *           最贵用于抓某次异常昂贵的调用——时间序前 20 条抓不到；
 *           失败是每日失败柱图的下钻出口，额外给出错误类型列（区分系统故障与用户输入问题）。
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { useState } from 'react'
import { formatCny } from '@/lib/format-cost'

type Log = { id: string; created_at: string; service: string; endpoint: string
  usage_amount: number; usage_unit: string; estimated_cost_cny: number; latency_ms: number; status: string
  metadata?: { phase?: string; cost_source?: string; error_kind?: string } | null }
const SVC: Record<string, [string, string]> = {
  doubao_asr:    ['豆包 ASR',      '#D4875A'],
  qwen_flash:    ['千问 Qwen',     '#7BA699'],
  qwen_plus:     ['千问 Plus',     '#6FA8C8'],
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
const BASE_COLS = ['时间', '服务', '接口', '用量', '费用', '延迟', '状态']
// 失败视图多一列「错误类型」：不加的话一屏全是"失败"两个字，没有任何可判断的信息
const FAILED_COLS = [...BASE_COLS, '错误类型']
const SHOW = 20
type Mode = 'recent' | 'costly' | 'failed'
const MODE_LABEL: Record<Mode, string> = { recent: '最近', costly: '最贵', failed: '失败' }
// 空态文案分视图给：失败视图沿用「暂无调用记录」会让人以为查询坏了，实际是"这段时间没出事"
const EMPTY_TEXT: Record<Mode, string> = {
  recent: '暂无调用记录', costly: '暂无调用记录', failed: '本期无失败调用',
}
// error_kind 中文名：user_input = 用户输入问题（如没有人声的空录音），服务本身是好的；
// 缺该键的历史行按系统故障计（口径不追溯改写，与 API 侧 isSystemError 一致）
const ERROR_KIND_LABEL: Record<string, string> = { user_input: '用户输入' }
// 时间列按东八区（UTC+8，香港节点无夏令时）展示，与看板其余"今日/日界"口径一致；
// DB 存 UTC，直接用浏览器本地时区会随访问者所在地漂移。折算后统一取 getUTC* 读墙上钟。
const HK_OFFSET_MS = 8 * 60 * 60 * 1000
/**
 * 调用明细表格，可在「最近」/「最贵」/「失败」三视图切换
 * @param recentLogs  时间序最新调用（最多 30 条，表格展示前 20）
 * @param costlyLogs  按成本降序的 Top-N 调用
 * @param failedLogs  区间内全部失败调用（时间倒序），每日失败柱图的下钻出口
 */
export default function RecentCallsTable({ recentLogs, costlyLogs, failedLogs }: { recentLogs: Log[]; costlyLogs: Log[]; failedLogs: Log[] }) {
  const [mode, setMode] = useState<Mode>('recent')
  const source  = mode === 'recent' ? recentLogs : mode === 'costly' ? costlyLogs : failedLogs
  // 「最近」是无限增长的时间序，截前 20 条即可；「最贵」「失败」本身已是有界榜单，全量展示
  const visible = mode === 'recent' ? source.slice(0, SHOW) : source
  const extra   = mode === 'recent' ? recentLogs.length - SHOW : 0
  const cols    = mode === 'failed' ? FAILED_COLS : BASE_COLS
  return (
    <div className="bg-white rounded-[16px] border border-black/[0.05] overflow-hidden">
      <div className="px-4 py-3 border-b border-black/[0.04] flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-v2-text-primary">调用明细</h2>
        {/* 视图切换：最近（时间序）/ 最贵（成本降序 Top-N）/ 失败。命中区 min-h-[44px] 达触控标准 */}
        <div className="flex bg-black/[0.03] rounded-full p-0.5 gap-0.5" role="group" aria-label="调用明细视图">
          {(['recent', 'costly', 'failed'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
              className={`inline-flex items-center justify-center min-h-[44px] px-3 rounded-full text-[11px] font-medium transition-colors ${mode === m ? 'bg-white text-v2-text-primary shadow-sm' : 'text-v2-text-muted'}`}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
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
                  <td className="px-3 py-2 text-v2-text-secondary whitespace-nowrap">{log.latency_ms}ms</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${log.status === 'success' ? 'bg-success' : 'bg-error'}`} />
                      <span className="text-v2-text-secondary">{log.status === 'success' ? '成功' : '失败'}</span>
                    </span>
                  </td>
                  {/* 错误类型仅失败视图给：用户输入问题（空录音等）不算故障，混在一起会淹掉真故障 */}
                  {mode === 'failed' && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      {log.metadata?.error_kind
                        ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-warning/15 text-warning-text">
                            {ERROR_KIND_LABEL[log.metadata.error_kind] ?? log.metadata.error_kind}
                          </span>
                        : <span className="text-v2-text-secondary">系统故障</span>}
                    </td>
                  )}
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
