/**
 * @module   phrase-chunk
 * @desc     英文句子按词组切块（简单规则版，非 AI）+ 打乱工具，供「拼句练习」小游戏使用
 * @author   LingoBridge
 * @created  2026-07-01
 */

// 短功能词：与其后紧邻的一个词合并成一块（如 "in the" / "have been"）
const ARTICLES = ['a', 'an', 'the']
const PREPOSITIONS = ['to', 'in', 'on', 'at', 'for', 'of', 'with', 'from', 'by', 'about', 'into', 'onto', 'upon']
const AUX_MODALS = [
  'is', 'am', 'are', 'was', 'were', 'do', 'does', 'did', 'have', 'has', 'had',
  'will', 'would', 'can', 'could', 'should', 'must', 'may', 'might',
]
const FUNCTION_WORDS = new Set<string>([...ARTICLES, ...PREPOSITIONS, ...AUX_MODALS])

// 切块下限：合并后少于该块数则退回纯切分，避免短句被并成 1-2 块
const MIN_MERGED_CHUNKS = 3

/** 取 token 的比较用词形：小写并去掉首尾非字母数字（保留词内撇号）。 */
function cleanWord(token: string): string {
  return token.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '')
}

/** 纯标点 token（不含字母数字），用于把独立标点并入前一词。 */
function isPunctuationOnly(token: string): boolean {
  return /^[^A-Za-z0-9]+$/.test(token)
}

/**
 * 把一句英文句子按词组切块（简单规则版，非 AI）
 * 规则：
 * 1. 按空格切分成 token，独立的标点符号并入其前一词（不单独成块）
 * 2. 冠词 / 介词 / 助动词-情态动词 这类短功能词，与其后紧邻的一个词合并成一块
 * 3. 若合并后总块数少于 3，则不合并，直接按空格+标点规则切分
 * @param sentence 完整英文句子
 * @returns 切好的词组块数组，顺序即原句顺序
 */
export function chunkSentence(sentence: string): string[] {
  const raw = sentence.trim().split(/\s+/).filter(Boolean)
  if (raw.length === 0) return []

  // 规则 1：独立标点并入前一词
  const tokens: string[] = []
  for (const t of raw) {
    if (isPunctuationOnly(t) && tokens.length > 0) {
      tokens[tokens.length - 1] += t
    } else {
      tokens.push(t)
    }
  }

  // 规则 2：功能词与其后一词合并
  const merged: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (FUNCTION_WORDS.has(cleanWord(tokens[i])) && i + 1 < tokens.length) {
      merged.push(`${tokens[i]} ${tokens[i + 1]}`)
      i++
    } else {
      merged.push(tokens[i])
    }
  }

  // 规则 3：太短则退回未合并切分
  return merged.length < MIN_MERGED_CHUNKS ? tokens : merged
}

/**
 * 打乱词组块顺序，保证结果与原顺序不同（除非只有 1 个块或所有块内容相同）
 * @param chunks 原顺序词组块数组
 * @returns 打乱后的新数组（不改变入参）
 */
export function shuffleChunks(chunks: string[]): string[] {
  if (chunks.length <= 1) return [...chunks]

  const sameAsInput = (arr: string[]): boolean => arr.every((v, i) => v === chunks[i])

  const result = [...chunks]
  let guard = 0
  // Fisher-Yates；若碰巧洗回原序则重洗（元素全相同时无解，由 guard 兜底退出）
  do {
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    guard++
  } while (sameAsInput(result) && guard < 20)

  return result
}
