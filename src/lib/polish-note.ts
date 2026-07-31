/**
 * @module   polish-note
 * @desc     「换个说法」note 契约字符串的纯解析逻辑 —— 把模型输出的单 string note 拆成
 *           「语法」「词组表达优化」两段结构。从 PolishNote 组件抽出为纯函数：既供组件渲染，
 *           又能在 jest（node 环境、无 JSX 变换）里直接单测。不含任何 React / DOM 依赖。
 * @author   LingoBridge
 * @created  2026-07-31
 */

/** 解释区一条改动项 */
export interface NoteItem {
  /** 类型前缀（仅语法段有，如「时态」）；无则 undefined */
  type?: string
  /** 原片段（弱化显示） */
  from: string
  /** 改法（最重显示） */
  to: string
  /** 无箭头无法切分时的整行原文（此时 from/to 留空，raw 直接展示） */
  raw?: string
}

/** 解释区一段（语法 / 词组） */
export interface NoteSection {
  kind: 'grammar' | 'phrase'
  items: NoteItem[]
}

// 段头容错集：模型可能带全角/半角冒号或用长名
const GRAMMAR_HEADS = new Set(['语法', '语法：', '语法:'])
const PHRASE_HEADS = new Set(['词组', '词组：', '词组:', '词组表达优化', '表达'])

/**
 * 把 note 契约字符串解析成两段结构；无法识别契约格式时返回 null（调用方回退整段 <p>）
 * @param note  模型输出的单 string（内部以 \n 组织成「语法」「词组」两段）
 * @returns     命中契约 → 非空 NoteSection 数组；未命中 / 解析后皆空 → null
 */
export function parseNote(note: string): NoteSection[] | null {
  const lines = note.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  // 无任何行命中段头 → 判定非契约格式，交回调用方按普通段落渲染
  const hasHead = lines.some((l) => GRAMMAR_HEADS.has(l) || PHRASE_HEADS.has(l))
  if (!hasHead) return null

  const grammar: NoteItem[] = []
  const phrase: NoteItem[] = []
  let current: 'grammar' | 'phrase' | null = null

  for (const line of lines) {
    if (GRAMMAR_HEADS.has(line)) {
      current = 'grammar'
      continue
    }
    if (PHRASE_HEADS.has(line)) {
      current = 'phrase'
      continue
    }
    if (current === null) continue // 段头之前的游离行，忽略
    const arrowIdx = line.search(/→|->/)
    if (arrowIdx < 0) {
      // 无箭头：整行 raw 兜底展示
      ;(current === 'grammar' ? grammar : phrase).push({ from: '', to: '', raw: line })
      continue
    }
    const arrowLen = line[arrowIdx] === '→' ? 1 : 2
    const left = line.slice(0, arrowIdx).trim()
    const to = line.slice(arrowIdx + arrowLen).trim()
    if (current === 'grammar') {
      // 语法段左侧再按第一个中/英文冒号切「类型 / 原片段」
      const colonIdx = left.search(/：|:/)
      if (colonIdx >= 0) {
        grammar.push({ type: left.slice(0, colonIdx).trim(), from: left.slice(colonIdx + 1).trim(), to })
      } else {
        grammar.push({ from: left, to })
      }
    } else {
      phrase.push({ from: left, to })
    }
  }

  const sections: NoteSection[] = []
  if (grammar.length > 0) sections.push({ kind: 'grammar', items: grammar })
  if (phrase.length > 0) sections.push({ kind: 'phrase', items: phrase })
  // 解析后两段皆空 → 回退整段 <p>
  return sections.length > 0 ? sections : null
}
