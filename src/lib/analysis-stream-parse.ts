/**
 * @module   analysis-stream-parse
 * @desc     题目分析（单个 JSON）的容错「增量段解析器」。分析是单次 LLM 调用产出的一整个 JSON
 *           （{ structureLabel, focusPoints[], phrases[] }），本模块边收流式文本块边解析，
 *           每当一段完成即通过回调尽早吐出：structureLabel 字符串、focusPoints 每个元素对象、
 *           phrases 每个元素对象。仅用于「逐段预览」；权威返回仍由服务层对累积全文做最终解析。
 *
 *           正确性不变式（本模块命根，见 __tests__）：对任意合法 full JSON 字符串 S 的任意分块方式，
 *           增量吐出的段严格等于 JSON.parse(S) 的对应部分——structureLabel 相等、focusPoint 序列
 *           深等于 .focusPoints、phraseGroup 序列深等于 .phrases。每段 value 由 JSON.parse(该段完整切片)
 *           得到（切片边界对了，正确性自然对）。
 * @author   LingoBridge
 * @created  2026-08-01
 */
import type { AnalysisFocusPoint, AnalysisPhraseGroup } from '@/lib/types'

/** 增量吐出的一段：三类之一，value 均由 JSON.parse 该段完整切片得到 */
export type AnalysisStreamSection =
  | { kind: 'structureLabel'; value: string }
  | { kind: 'focusPoint'; value: AnalysisFocusPoint }
  | { kind: 'phraseGroup'; value: AnalysisPhraseGroup }

/** 段完成时的回调 */
export type OnAnalysisSection = (section: AnalysisStreamSection) => void

const WS = new Set([' ', '\n', '\t', '\r'])

/**
 * 从 s[start] 起扫一个 JSON 字符串（start 必须指向起始引号 `"`），返回闭合引号之后的下标（exclusive）。
 * 正确处理转义：`\` 转义其后一个字符（含 `\"`、`\\`），只用于「找闭合引号」时跳过一个字符即可
 * （`\uXXXX` 的 u 与 hex 都非 `"`/`\`，天然被逐字跳过，值本身交给 JSON.parse）。
 * @returns  闭合后下标；若缓冲在闭合前耗尽（半个字符串）返回 -1，等下次 push 再拼
 */
function scanString(s: string, start: number): number {
  let i = start + 1
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') {
      if (i + 1 >= s.length) return -1  // 转义符后的字符还没到，等续块
      i += 2
      continue
    }
    if (c === '"') return i + 1
    i++
  }
  return -1
}

/**
 * 从 s[start] 起扫一个对象/数组（start 指向 `{` 或 `[`），返回匹配闭合括号之后的下标（exclusive）。
 * 字符串内部的 `{}[]"` 与转义均被正确忽略，故能处理任意嵌套（如 phraseGroup 的 items 数组）。
 * @returns  闭合后下标；若缓冲耗尽仍未闭合返回 -1
 */
function scanContainer(s: string, start: number): number {
  let depth = 0
  let inStr = false
  let i = start
  while (i < s.length) {
    const c = s[i]
    if (inStr) {
      if (c === '\\') {
        if (i + 1 >= s.length) return -1
        i += 2
        continue
      }
      if (c === '"') inStr = false
      i++
      continue
    }
    if (c === '"') { inStr = true; i++; continue }
    if (c === '{' || c === '[') { depth++; i++; continue }
    if (c === '}' || c === ']') {
      depth--
      i++
      if (depth === 0) return i
      continue
    }
    i++
  }
  return -1
}

/**
 * 从 s[start] 起扫「一个完整 JSON 值」（start 已指向非空白的值首字符），返回值之后的下标（exclusive）。
 * 字符串→scanString、对象/数组→scanContainer、基本量（数字/true/false/null）扫到分隔符（`,}]` 或空白）为止。
 * @returns  值之后下标；不完整（缓冲耗尽、基本量后还没见到分隔符）返回 -1
 */
function scanValue(s: string, start: number): number {
  const c = s[start]
  if (c === '"') return scanString(s, start)
  if (c === '{' || c === '[') return scanContainer(s, start)
  let i = start
  while (i < s.length) {
    const ch = s[i]
    if (ch === ',' || ch === '}' || ch === ']' || WS.has(ch)) return i
    i++
  }
  return -1  // 基本量未见分隔符，可能被切断（如 "12" | "34"），等续块
}

/**
 * 容错增量 JSON 段解析器。喂 push(chunk)，每当一段完成即通过 onSection 尽早吐出。
 * 不假设键顺序（structureLabel / focusPoints / phrases 任意先后皆可）；容忍前导 ```json 围栏与前后空白
 * （从第一个顶层 `{` 起扫，忽略顶层对象闭合后的一切）。
 */
export class AnalysisStreamParser {
  private buf = ''
  private pos = 0
  private phase: 'seek' | 'inObj' | 'done' = 'seek'
  /** 非 null 时表示正处在某个关注数组内部，逐个元素吐出 */
  private arrayKind: 'focusPoint' | 'phraseGroup' | null = null

  /**
   * @param onSection  段完成回调（尽早触发；顺序与源 JSON 中出现顺序一致）
   */
  constructor(private readonly onSection: OnAnalysisSection) {}

  /**
   * 喂入一块文本（可能在任意字节处被切断），尽力向前解析并吐出已完成的段。
   * @param chunk  流式文本块
   * @sideEffect   对完成的段调用 onSection
   */
  push(chunk: string): void {
    this.buf += chunk
    this.run()
  }

  /** 跳过空白，返回首个非空白下标；若到缓冲末尾仍全是空白/为空返回 -1（等续块） */
  private skipWs(i: number): number {
    let j = i
    while (j < this.buf.length) {
      if (WS.has(this.buf[j])) { j++; continue }
      return j
    }
    return -1
  }

  /** 主循环：每轮要么推进 pos / 切换 phase，要么因缺数据 return，绝不空转 */
  private run(): void {
    for (;;) {
      if (this.phase === 'done') return

      if (this.phase === 'seek') {
        const idx = this.buf.indexOf('{', this.pos)
        if (idx < 0) { this.pos = this.buf.length; return }  // 顶层对象还没到
        this.pos = idx + 1
        this.phase = 'inObj'
        continue
      }

      // 正处在关注数组内部：逐元素吐
      if (this.arrayKind) {
        const p = this.skipWs(this.pos)
        if (p < 0) return
        const c = this.buf[p]
        if (c === ']') { this.pos = p + 1; this.arrayKind = null; continue }
        if (c === ',') { this.pos = p + 1; continue }
        const end = scanValue(this.buf, p)
        if (end < 0) { this.pos = p; return }  // 元素未闭合，停在元素首、等续块
        const kind = this.arrayKind
        const parsed: unknown = JSON.parse(this.buf.slice(p, end))
        this.pos = end  // 先推进再回调，回调若重入也不会重吐
        if (kind === 'focusPoint') {
          this.onSection({ kind: 'focusPoint', value: parsed as AnalysisFocusPoint })
        } else {
          this.onSection({ kind: 'phraseGroup', value: parsed as AnalysisPhraseGroup })
        }
        continue
      }

      // 顶层对象内：解析 key: value
      const kp = this.skipWs(this.pos)
      if (kp < 0) return
      const kc = this.buf[kp]
      if (kc === '}') { this.pos = kp + 1; this.phase = 'done'; return }
      if (kc === ',') { this.pos = kp + 1; continue }
      if (kc !== '"') { this.pos = kp + 1; continue }  // 越过意外字符，防空转

      const keyEnd = scanString(this.buf, kp)
      if (keyEnd < 0) { this.pos = kp; return }  // 键未闭合，回到键首等续块
      const key = JSON.parse(this.buf.slice(kp, keyEnd)) as string

      const colon = this.skipWs(keyEnd)
      if (colon < 0) { this.pos = kp; return }  // 冒号还没到，回到键首重扫（幂等）
      if (this.buf[colon] !== ':') { this.pos = colon + 1; continue }  // 越过意外字符

      const valStart = this.skipWs(colon + 1)
      if (valStart < 0) { this.pos = kp; return }  // 值首还没到，回到键首重扫

      if (key === 'focusPoints' || key === 'phrases') {
        if (this.buf[valStart] === '[') {
          this.pos = valStart + 1
          this.arrayKind = key === 'focusPoints' ? 'focusPoint' : 'phraseGroup'
          continue
        }
        // 值不是数组（异常）：整体跳过
        const end = scanValue(this.buf, valStart)
        if (end < 0) { this.pos = kp; return }
        this.pos = end
        continue
      }

      if (key === 'structureLabel') {
        const end = scanValue(this.buf, valStart)
        if (end < 0) { this.pos = kp; return }
        if (this.buf[valStart] === '"') {
          const parsed: unknown = JSON.parse(this.buf.slice(valStart, end))
          this.pos = end
          this.onSection({ kind: 'structureLabel', value: parsed as string })
        } else {
          this.pos = end  // 值不是字符串（异常）：跳过不吐
        }
        continue
      }

      // 其它键：跳过其值
      const end = scanValue(this.buf, valStart)
      if (end < 0) { this.pos = kp; return }
      this.pos = end
    }
  }
}
