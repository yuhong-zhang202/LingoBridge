/**
 * @module   ranking-algo-version-guard.test
 * @desc     规则守卫（静态扫描源码 + 数据文件，不连库、不发请求）：
 *           凡是【会改变「同一个故事得到的高/中/低集合」】的输入被改动，本测试必须变红，
 *           逼作者当场做两件事：① 更新本文件里的钉住值 ② bump `RANKING_ALGO_VERSION`。
 *
 *           ── 缺陷（已实测发生过，不是假想）──
 *           2026-07-17  5c2e8af  RANKING_ALGO_VERSION = 'v1-2026-07-17'   ← 至今未变
 *           2026-07-21  ac7efc1  新增 remap v3 映射 + 换季题库 seed
 *           2026-07-21  a7db669  remap 切 v3 + 新增 CURRENT_SEASON + db/questions.ts 三处加当季过滤
 *           07-21 一次性改了三处会改变召回集合的东西，版本号一个字没动，而【没有任何东西会发现】。
 *
 *           ── 为什么要紧（按重要性排序）──
 *           【第一位】`match.question_opened` 的 `algoVersion` 被静默污染（src/app/matching/page.tsx:611）。
 *             重排质量的最终裁决已改用真实选题行为（0050 埋点、08-01 上线、数据稀疏、正在攒月级），
 *             它靠 `algoVersion` 做唯一分层键。不 bump ⇒ 九月换季前后两批口径不同的数据被打上同一标签、
 *             汇进同一个池。原话：「一个 154 行的陈旧快照，是一批用户看到旧结果；一个被静默污染的分层键，
 *             是一整套还在攒的裁决数据在事后无法分段。前者可以重算，后者攒回来要几个月。」
 *           【第二位】存档命中判定（src/app/api/matching/route.ts:152 与 :391 的
 *             `snap.algoVersion === RANKING_ALGO_VERSION`）。历史影响面实测为 0
 *             （corpus_match_snapshots 154 行 / 版本数 1 / 最早建档 07-22，晚于换季），
 *             但现在有 154 条，九月换季会真的发生。
 *
 *           ── ⚠️ 已知残余风险，不许当作已覆盖 ──
 *           **变异清单第 7 条（直接向 `question_observation_links` 插行、不动任何文件）α 抓不到。
 *           α 通过 ≠ 覆盖完整；第 7 条是已知残余风险，β（映射指纹进快照 key）是它唯一的解。**
 *           本项目有在 Supabase SQL Editor 手跑 SQL 的既有习惯（0018–0023、0046–0051 都是这形态），
 *           那条路绕开一切文件守卫。留这段字是因为：不留证，下一个人会以为 α 是完备的。
 *
 *           ── 但 α 不是「假装工作」──
 *           scripts/remap-links.ts:67 的 REMAP_PATH 硬编码到仓库内版本化文件，
 *           07-21 那三处改动【全部落在版本化文件上】，本守卫抓 3/3 ——
 *           即 α 能抓住目前唯一一个已证实发生过的案例。两件事都成立：α 有价值，第 7 条的洞也是真的。
 *
 *           ── 怎么维护 ──
 *           钉住值失配时，用 `PIN_DUMP=1 npx jest ranking-algo-version-guard` 打印当前实际值，
 *           核对「这次改动确实该 bump」之后，把新值连同当时的 RANKING_ALGO_VERSION 一起写回 PINNED。
 *
 *           扫描器的已知漏判 / 误报写在文件末尾，改本文件前先读那段。
 * @author   LingoBridge
 * @created  2026-08-21
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { RANKING_ALGO_VERSION } from '@/lib/constants'

/** 仓库根：本文件在 src/lib/__tests__/ 下，上三级即仓库根 */
const REPO_ROOT = path.resolve(__dirname, '../../..')

// ─────────────────────────────────────────────────────────────────────────────
// 一、源码锚点扫描器
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 一个「口径输入」锚点。
 * · decl —— `const NAME = <表达式>`，取表达式原文（注释剔除，字符串内空白原样保留：prompt 的空白是语义）
 * · body —— `function NAME(...) { … }`，取函数体（注释剔除 + 串外空白压平：改注释/换行不该触发本守卫）
 * · line —— 按正则取一行（用于对象字面量里的单个属性，如 env-server 的开关默认值）
 */
type Anchor =
  | { key: string; file: string; kind: 'decl'; name: string }
  | { key: string; file: string; kind: 'body'; name: string }
  | { key: string; file: string; kind: 'line'; pattern: RegExp }

/** 一行以这些字符结尾 = 表达式还没写完（多行字符串拼接的 `+`、多行三元的 `?` 等），不能在此断句 */
const CONTINUATION_CHARS = new Set(
  ['+', '-', '*', '/', '%', ',', '.', '=', '?', ':', '&', '|', '<', '>', '^', '~', '!', '(', '[', '{'],
)

/**
 * 从引号/反引号起始位置扫到闭合引号之后。
 * @param  src  源码全文
 * @param  i    起始下标（src[i] 必须是 ' " 或 `）
 * @returns     闭合引号的下一个下标
 */
function skipQuoted(src: string, i: number): number {
  const quote = src[i]
  let j = i + 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') { j += 2; continue }
    if (c === quote) return j + 1
    j++
  }
  throw new Error(`未闭合的字符串字面量（起始下标 ${i}）`)
}

/** 扫描模式：expr = 读到表达式自然结束；block = 读一个 {…} 平衡块（含首尾花括号） */
interface ScanOptions {
  mode: 'expr' | 'block'
  /** true = 把字符串【外】的连续空白压成一个空格（函数体用）；字面量锚点一律 false */
  collapse: boolean
}

/**
 * 从 from 开始扫一段源码，剔除注释后返回原文。
 * 遇到括号/引号会跟踪嵌套；扫到文件末尾仍未闭合直接抛错（宁可红，绝不静默返回半截）。
 * @param  src   源码全文
 * @param  from  起始下标（block 模式下 src[from] 必须是 '{'）
 * @param  opts  扫描模式 + 是否压平串外空白
 * @returns      剔注释后的原文（已 trim）
 */
function scanFrom(src: string, from: number, opts: ScanOptions): string {
  const out: string[] = []
  let depth = 0
  let i = from

  /** 压平模式下把连续空白合成一个空格；非压平模式原样保留 */
  const pushSpace = (c: string): void => {
    if (!opts.collapse) { out.push(c); return }
    if (out[out.length - 1] !== ' ') out.push(' ')
  }

  while (i < src.length) {
    const c = src[i]

    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = nl === -1 ? src.length : nl
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end === -1) throw new Error(`未闭合的块注释（起始下标 ${i}）`)
      i = end + 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const end = skipQuoted(src, i)
      out.push(src.slice(i, end))
      i = end
      continue
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++
      out.push(c)
      i++
      continue
    }
    if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth < 0) throw new Error(`括号不平衡（下标 ${i}）`)
      out.push(c)
      i++
      if (opts.mode === 'block' && depth === 0) return out.join('').trim()
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      if (opts.mode === 'expr' && c === '\n' && depth === 0) {
        const acc = out.join('').trim()
        if (acc.length > 0 && !CONTINUATION_CHARS.has(acc.slice(-1))) return acc
      }
      pushSpace(c)
      i++
      continue
    }
    out.push(c)
    i++
  }
  throw new Error('扫描到文件末尾仍未结束（括号或引号不平衡？）')
}

/**
 * 取 `const NAME = <表达式>` 的表达式原文。
 * @param  src   源码全文
 * @param  name  常量名
 * @returns      表达式原文（注释已剔除）
 */
function readDecl(src: string, name: string): string {
  const re = new RegExp(`(^|\\n)[ \\t]*(export[ \\t]+)?const[ \\t]+${name}\\b`, 'g')
  const hits = [...src.matchAll(re)]
  if (hits.length !== 1) throw new Error(`锚点 const ${name} 命中 ${hits.length} 次（应为 1 次）`)
  const eq = src.indexOf('=', hits[0].index! + hits[0][0].length)
  if (eq === -1) throw new Error(`锚点 const ${name} 后面找不到 '='`)
  return scanFrom(src, eq + 1, { mode: 'expr', collapse: false })
}

/**
 * 取 `function NAME(...) { … }` 的函数体（含首尾花括号）。
 * @param  src   源码全文
 * @param  name  函数名
 * @returns      函数体（注释已剔除、串外空白已压平）
 */
function readBody(src: string, name: string): string {
  const re = new RegExp(`(^|\\n)[ \\t]*(export[ \\t]+)?(async[ \\t]+)?function[ \\t]+${name}\\b`, 'g')
  const hits = [...src.matchAll(re)]
  if (hits.length !== 1) throw new Error(`锚点 function ${name} 命中 ${hits.length} 次（应为 1 次）`)

  // 从函数名之后往后扫，取【圆括号深度归零处的第一个 `{`】= 函数体起始（跳过参数表与返回类型）
  let i = hits[0].index! + hits[0][0].length
  let paren = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') { i = skipQuoted(src, i); continue }
    if (c === '(') { paren++; i++; continue }
    if (c === ')') { paren--; i++; continue }
    if (c === '{' && paren === 0) break
    i++
  }
  if (i >= src.length) throw new Error(`锚点 function ${name} 找不到函数体起始 '{'`)
  return scanFrom(src, i, { mode: 'block', collapse: true })
}

/**
 * 按正则取一行原文（对象字面量里的单个属性用）。
 * @param  src      源码全文
 * @param  pattern  必须恰好命中一次的正则
 * @returns         命中的整行（已 trim）
 */
function readLine(src: string, pattern: RegExp): string {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  const hits = [...src.matchAll(re)]
  if (hits.length !== 1) throw new Error(`锚点正则 ${pattern} 命中 ${hits.length} 次（应为 1 次）`)
  return hits[0][0].trim()
}

/**
 * 解析一个锚点，拿到它在当前源码里的原文。
 * @param  a  锚点定义
 * @returns   原文（解析不到一律抛错，绝不返回空串——「返回 0/null 长得跟真实否定结论一模一样」）
 */
function resolveAnchor(a: Anchor): string {
  const src = fs.readFileSync(path.join(REPO_ROOT, a.file), 'utf8')
  const text =
    a.kind === 'decl' ? readDecl(src, a.name)
    : a.kind === 'body' ? readBody(src, a.name)
    : readLine(src, a.pattern)
  if (text.trim().length === 0) throw new Error(`锚点 ${a.key} 解析结果为空`)
  return text
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、锚点清单 —— 「会改变高/中/低集合」的全部输入
// ─────────────────────────────────────────────────────────────────────────────

const CONSTANTS = 'src/lib/constants.ts'
const RANKING = 'src/services/ranking.ts'
const EXTRACTION = 'src/services/extraction.ts'
const MATCHING = 'src/services/matching.ts'
const ADJACENCY = 'src/lib/observation-adjacency.ts'
const DB_QUESTIONS = 'src/lib/db/questions.ts'
const ENV_SERVER = 'src/lib/env-server.ts'
const REMAP_SCRIPT = 'scripts/remap-links.ts'

/**
 * 收录判据（唯一一条）：**改了它，同一个故事拿到的高/中/低集合可能不同。**
 * 据此【收】：两条打分路径的全部 prompt、萃取 prompt、分档阈值与合成权重、模型名、
 *   漏斗召回逻辑（含 season 过滤）、邻接表、映射脚本指向的版本化数据文件。
 * 据此【不收】：只改展示切片的 LOW_MATCH_SHOW_MAX（constants.ts:80，规则文字见 :126 —— 它不改任何
 *   分档/入库判定，只从既有 relevanceScore 派生一个展示切片）、各 ANON_ 与 REG_ 配额、超时与重试预算
 *   （只影响失败时机与可靠性，不改判定口径）、以及 RANKING_ALGO_VERSION 自身的取值（见 PINNED）。
 */
const ANCHORS: readonly Anchor[] = [
  // 分档线 / 合成权重 / 代表分 / 当季 / 模型名
  { key: 'constants#SCORE_HIGH', file: CONSTANTS, kind: 'decl', name: 'SCORE_HIGH' },
  { key: 'constants#SCORE_MID', file: CONSTANTS, kind: 'decl', name: 'SCORE_MID' },
  { key: 'constants#CURRENT_SEASON', file: CONSTANTS, kind: 'decl', name: 'CURRENT_SEASON' },
  { key: 'constants#MODEL_RANKING', file: CONSTANTS, kind: 'decl', name: 'MODEL_RANKING' },
  { key: 'constants#MODEL_EXTRACTION', file: CONSTANTS, kind: 'decl', name: 'MODEL_EXTRACTION' },
  { key: 'constants#RANKING_W1', file: CONSTANTS, kind: 'decl', name: 'RANKING_W1' },
  { key: 'constants#RANKING_W2', file: CONSTANTS, kind: 'decl', name: 'RANKING_W2' },
  { key: 'constants#RANKING_W3', file: CONSTANTS, kind: 'decl', name: 'RANKING_W3' },
  { key: 'constants#RANKING_DELTA_MID_MAX', file: CONSTANTS, kind: 'decl', name: 'RANKING_DELTA_MID_MAX' },
  { key: 'constants#RANKING_TIER_HIGH', file: CONSTANTS, kind: 'decl', name: 'RANKING_TIER_HIGH' },
  { key: 'constants#RANKING_TIER_MID', file: CONSTANTS, kind: 'decl', name: 'RANKING_TIER_MID' },
  { key: 'constants#RANKING_TIER_LOW', file: CONSTANTS, kind: 'decl', name: 'RANKING_TIER_LOW' },
  { key: 'constants#RANKING_TIER_HIDDEN', file: CONSTANTS, kind: 'decl', name: 'RANKING_TIER_HIDDEN' },
  { key: 'constants#RANKING_TIE_UNIT', file: CONSTANTS, kind: 'decl', name: 'RANKING_TIE_UNIT' },
  { key: 'constants#RANKING_TIE_MAX', file: CONSTANTS, kind: 'decl', name: 'RANKING_TIE_MAX' },

  // 重排：两条路径的 prompt + 校验/降级口径 + 代码合成
  { key: 'ranking#SYSTEM_PROMPT_SINGLE', file: RANKING, kind: 'decl', name: 'SYSTEM_PROMPT_SINGLE' },
  { key: 'ranking#SYSTEM_PROMPT_SINGLE_NDJSON', file: RANKING, kind: 'decl', name: 'SYSTEM_PROMPT_SINGLE_NDJSON' },
  { key: 'ranking#SYSTEM_PROMPT_DIM', file: RANKING, kind: 'decl', name: 'SYSTEM_PROMPT_DIM' },
  { key: 'ranking#REALIGN_INSTRUCTION', file: RANKING, kind: 'decl', name: 'REALIGN_INSTRUCTION' },
  { key: 'ranking#ECHO_PREFIX_LEN', file: RANKING, kind: 'decl', name: 'ECHO_PREFIX_LEN' },
  { key: 'ranking#ECHO_MIN_LEN', file: RANKING, kind: 'decl', name: 'ECHO_MIN_LEN' },
  { key: 'ranking#UNUSABLE_REASON_RE', file: RANKING, kind: 'decl', name: 'UNUSABLE_REASON_RE' },
  { key: 'ranking#RANKING_STREAM_SKIP_THRESHOLD', file: RANKING, kind: 'decl', name: 'RANKING_STREAM_SKIP_THRESHOLD' },
  { key: 'ranking#synthesizeScore', file: RANKING, kind: 'body', name: 'synthesizeScore' },

  // 萃取：观察点 taxonomy 的唯一真源
  { key: 'extraction#SYSTEM_PROMPT', file: EXTRACTION, kind: 'decl', name: 'SYSTEM_PROMPT' },
  { key: 'extraction#EXTRACTION_FIX_INSTRUCTION', file: EXTRACTION, kind: 'decl', name: 'EXTRACTION_FIX_INSTRUCTION' },

  // 召回漏斗：邻居阈值 + 三层逻辑 + 邻接表
  { key: 'matching#NEIGHBOR_MIN', file: MATCHING, kind: 'decl', name: 'NEIGHBOR_MIN' },
  { key: 'matching#NEIGHBOR_TARGET', file: MATCHING, kind: 'decl', name: 'NEIGHBOR_TARGET' },
  { key: 'matching#matchByStory', file: MATCHING, kind: 'body', name: 'matchByStory' },
  { key: 'adjacency#OBSERVATION_ADJACENCY', file: ADJACENCY, kind: 'decl', name: 'OBSERVATION_ADJACENCY' },

  // 召回查询本身（含 season 过滤 —— 07-21 静默改掉召回集合的那三处之一）
  { key: 'db-questions#getQuestionsByObservation', file: DB_QUESTIONS, kind: 'body', name: 'getQuestionsByObservation' },
  { key: 'db-questions#getQuestionCountByObservations', file: DB_QUESTIONS, kind: 'body', name: 'getQuestionCountByObservations' },

  // 打分路径开关的默认值（constants.ts:128 明写「切换 RANKING_DIMENSIONAL 开关须同步 bump」，
  // 但开关本身不在 constants.ts，而在 env-server.ts 的 env 对象里）
  { key: 'env-server#rankingDimensional', file: ENV_SERVER, kind: 'line', pattern: /^[ \t]*rankingDimensional:.*$/m },

  // 映射脚本指向哪一版映射（07-21 由 v2 切 v3 的那一处）
  { key: 'remap-links#REMAP_PATH', file: REMAP_SCRIPT, kind: 'decl', name: 'REMAP_PATH' },
]

// ─────────────────────────────────────────────────────────────────────────────
// 三、数据文件（整文件哈希）
// ─────────────────────────────────────────────────────────────────────────────

/** 一组按目录 + 前缀/后缀发现的数据文件（**用发现而不是硬编码清单**：新增 v4 / 新一季 seed 会自动进指纹） */
interface FileSet {
  key: string
  dir: string
  match: (name: string) => boolean
  /** 发现数量的下限（防「目录改名 → 扫到 0 个 → 因为没有反例而变绿」） */
  minCount: number
}

const FILE_SETS: readonly FileSet[] = [
  {
    key: 'data/question-observation-remap',
    dir: 'scripts/data',
    match: (n) => /^question-observation-remap\.v\d+\.json$/.test(n),
    minCount: 3,
  },
  {
    key: 'seed/ielts_questions',
    dir: 'scripts/seed',
    match: (n) => /^ielts_questions_.*\.json$/.test(n),
    minCount: 2,
  },
]

/**
 * 发现一组数据文件。
 * @param  fs_  文件组定义
 * @returns     相对仓库根的路径数组（字典序；少于 minCount 直接抛错）
 */
function discoverFiles(fs_: FileSet): string[] {
  const dir = path.join(REPO_ROOT, fs_.dir)
  const found = fs.readdirSync(dir).filter(fs_.match).sort()
  if (found.length < fs_.minCount) {
    throw new Error(`文件组 ${fs_.key} 只发现 ${found.length} 个文件（下限 ${fs_.minCount}）——目录或命名可能已变`)
  }
  return found.map((n) => `${fs_.dir}/${n}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、指纹
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 短摘要：sha256 前 12 位十六进制。
 * @param  text  被摘要的原文
 * @returns      12 位十六进制串
 */
function sha12(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)
}

/**
 * 算出当前仓库里全部口径输入的「锚点 → 短摘要」表。
 * @returns  key 有序（按插入序）的摘要表；任一锚点解析不到会抛错，不会静默少一项
 */
function currentDigests(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of ANCHORS) out[a.key] = sha12(resolveAnchor(a))
  for (const set of FILE_SETS) {
    for (const rel of discoverFiles(set)) {
      // 文件名进摘要：改名 / 新增一版都算口径变化，不能只看内容
      out[rel] = sha12(`${rel}\n${fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')}`)
    }
  }
  return out
}

/**
 * 把摘要表连同当前 RANKING_ALGO_VERSION 拼成一个总指纹。
 * 版本号进指纹是刻意的：**只 bump 不更新钉住值一样会红**，这样 PINNED 里的
 * （版本号，指纹）二元组永远是一次真实的、成对发生过的登记，不会各走各的。
 * @param  digests  锚点 → 短摘要
 * @returns         总指纹（12 位）
 */
function combinedDigest(digests: Record<string, string>): string {
  const lines = Object.keys(digests).sort().map((k) => `${k}=${digests[k]}`)
  return sha12([`algoVersion=${RANKING_ALGO_VERSION}`, ...lines].join('\n'))
}

/**
 * 钉住值：改动上面任一输入都会与它失配。
 * ⚠️ 更新它 = 一次决定，不是一次格式修正。更新前请确认「这次改动确实该 bump 版本号」，
 *    并把当时的 RANKING_ALGO_VERSION 一并写进 algoVersion 字段（二者必须同一次写入）。
 */
const PINNED = {
  algoVersion: 'v1-2026-07-17',
  combined: '07639f1d2c5c',
  digests: {
    'constants#SCORE_HIGH': 'b4944c6ff08d',
    'constants#SCORE_MID': '39fa9ec190ee',
    'constants#CURRENT_SEASON': 'a43c5951b208',
    'constants#MODEL_RANKING': '9d96d286ab41',
    'constants#MODEL_EXTRACTION': '9d96d286ab41',
    'constants#RANKING_W1': '6b86b273ff34',
    'constants#RANKING_W2': '6b86b273ff34',
    'constants#RANKING_W3': '6b86b273ff34',
    'constants#RANKING_DELTA_MID_MAX': '6b86b273ff34',
    'constants#RANKING_TIER_HIGH': '69f59c273b6e',
    'constants#RANKING_TIER_MID': 'ff5a1ae012af',
    'constants#RANKING_TIER_LOW': '811786ad1ae7',
    'constants#RANKING_TIER_HIDDEN': 'f5ca38f748a1',
    'constants#RANKING_TIE_UNIT': '6b86b273ff34',
    'constants#RANKING_TIE_MAX': '2c624232cdd2',
    'ranking#SYSTEM_PROMPT_SINGLE': 'eb67c5ca7c85',
    'ranking#SYSTEM_PROMPT_SINGLE_NDJSON': 'f223f057b278',
    'ranking#SYSTEM_PROMPT_DIM': '03a5cb27a214',
    'ranking#REALIGN_INSTRUCTION': 'bbb34ddae0d9',
    'ranking#ECHO_PREFIX_LEN': 'd59eced1ded0',
    'ranking#ECHO_MIN_LEN': '2c624232cdd2',
    'ranking#UNUSABLE_REASON_RE': '50c0cdfa4a3f',
    'ranking#RANKING_STREAM_SKIP_THRESHOLD': '0e1a3f942235',
    'ranking#synthesizeScore': '360474330db4',
    'extraction#SYSTEM_PROMPT': 'e6c7cc56369b',
    'extraction#EXTRACTION_FIX_INSTRUCTION': 'c494575c070c',
    'matching#NEIGHBOR_MIN': '4e07408562be',
    'matching#NEIGHBOR_TARGET': 'ef2d127de37b',
    'matching#matchByStory': '981670b39058',
    'adjacency#OBSERVATION_ADJACENCY': 'ea3018d8cfe3',
    'db-questions#getQuestionsByObservation': '7da4cd1f6fde',
    'db-questions#getQuestionCountByObservations': 'b8f32b4a1ef0',
    'env-server#rankingDimensional': '66028cebd708',
    'remap-links#REMAP_PATH': '2405ad6c1822',
    'scripts/data/question-observation-remap.v1.json': 'c4215541a7b0',
    'scripts/data/question-observation-remap.v2.json': 'b85337fd64b1',
    'scripts/data/question-observation-remap.v3.json': '4083b745dac3',
    'scripts/seed/ielts_questions_2026_05_enriched.json': '3ff0e1deb12c',
    'scripts/seed/ielts_questions_enriched.json': '30bec07c7a25',
  } as Record<string, string>,
}

/** 断言失败时打在最前面的那句话——它才是这个测试的产出，指纹只是触发器 */
const FAILURE_HINT = [
  '你改了会改变高/中/低集合的输入。',
  '请同时 ① 更新本测试的钉住值（PINNED） ② bump `RANKING_ALGO_VERSION`。**只改一个仍然红。**',
  '',
  '为什么不能只改一个：`match.question_opened` 的 algoVersion 是重排质量最终裁决的唯一分层键（matching/page.tsx:611），',
  '不 bump 会让换季前后两批口径不同的数据被打上同一标签、事后无法分段——那套数据攒回来要几个月。',
  '其次是存档命中判定（api/matching/route.ts:152 与 :391），不 bump 用户会一直看到旧口径的冻结存档。',
  '',
  '重新生成钉住值：PIN_DUMP=1 npx jest ranking-algo-version-guard',
].join('\n')

/**
 * 带上 FAILURE_HINT 重抛断言错误（jest 的 expect 不收自定义消息，但要保留它的 diff）。
 * @param  assert  实际的断言闭包
 */
function withHint(assert: () => void): void {
  try {
    assert()
  } catch (e) {
    throw new Error(`${FAILURE_HINT}\n\n${e instanceof Error ? e.message : String(e)}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 五、测试
// ─────────────────────────────────────────────────────────────────────────────

describe('扫描器自检（防「判据在那条路上不存在 → 恒绿」）', () => {
  it('每个锚点都解析到了非空内容', () => {
    for (const a of ANCHORS) {
      expect(`${a.key}:${resolveAnchor(a).length > 0}`).toBe(`${a.key}:true`)
    }
    expect(ANCHORS.length).toBe(34)
  })

  it('抓到的确实是那几段东西（内容特征断言，不是长度也不是计数）', () => {
    const textOf = (key: string): string => resolveAnchor(ANCHORS.find((a) => a.key === key)!)

    // 阈值 / 当季：直接比字面值，值错了立刻看得出来
    expect(textOf('constants#SCORE_HIGH')).toBe('85')
    expect(textOf('constants#SCORE_MID')).toBe('60')
    expect(textOf('constants#CURRENT_SEASON')).toBe("'2026-05'")
    expect(textOf('matching#NEIGHBOR_MIN')).toBe('3')
    expect(textOf('matching#NEIGHBOR_TARGET')).toBe('5')

    // prompt：抓的是整段模板字面量（首尾都要在，防只抓到开头一截）
    const single = textOf('ranking#SYSTEM_PROMPT_SINGLE')
    expect(single.startsWith('`你是雅思口语备考教练')).toBe(true)
    expect(single).toContain('【判定主线】')
    expect(single.endsWith('也各自完整写一遍。`')).toBe(true)
    expect(textOf('ranking#SYSTEM_PROMPT_SINGLE_NDJSON')).toContain('NDJSON 格式')
    expect(textOf('ranking#SYSTEM_PROMPT_DIM')).toContain('need_other_story')

    // 多行字符串拼接：末段也要抓到（只抓第一段是最容易犯的错）
    expect(textOf('ranking#REALIGN_INSTRUCTION')).toContain('你上次的输出没有通过校验')
    expect(textOf('ranking#REALIGN_INSTRUCTION')).toContain('也不要 markdown 代码块。')
    expect(textOf('extraction#EXTRACTION_FIX_INSTRUCTION')).toContain('也不要 markdown 代码块。')

    // 萃取 prompt：49 个观察点清单行首尾都在
    const taxonomy = textOf('extraction#SYSTEM_PROMPT')
    expect(taxonomy).toContain('EMO_01｜')
    expect(taxonomy).toContain('VAL_03｜')
    expect([...taxonomy.matchAll(/^([A-Z]{3}_\d{2})｜/gm)]).toHaveLength(49)

    // 邻接表：49 行邻居都在
    const adj = textOf('adjacency#OBSERVATION_ADJACENCY')
    expect([...adj.matchAll(/^\s*[A-Z]{3}_\d{2}: \[/gm)]).toHaveLength(49)

    // 函数体：抓到了关键语句，且注释已被剔干净（这是「改注释不该变红」的实现依据）
    const funnel = textOf('matching#matchByStory')
    expect(funnel).toContain('NEIGHBOR_MIN')
    expect(funnel).toContain('OBSERVATION_ADJACENCY[primary.pointCode]')
    expect(funnel).toContain('rankQuestionsStreaming')
    expect(funnel).not.toContain('第三层·邻居增援')
    expect(funnel).not.toContain('//')
    expect(funnel).not.toContain('/*')
    const recall = textOf('db-questions#getQuestionsByObservation')
    expect(recall).toContain("eq('questions.season', CURRENT_SEASON)")
    expect(recall).not.toContain('//')
    expect(textOf('db-questions#getQuestionCountByObservations')).toContain('CURRENT_SEASON')

    // 映射版本 / 打分路径开关
    expect(textOf('remap-links#REMAP_PATH')).toContain("'question-observation-remap.v3.json'")
    expect(textOf('env-server#rankingDimensional')).toBe("rankingDimensional: process.env.RANKING_DIMENSIONAL === '1',")
  })

  it('锚点解析不到时抛错，绝不静默返回空串', () => {
    // 「路径写错 / 正则不匹配 → 返回 0 → 长得跟真实的否定结论一模一样」是本项目四天内出过六次的事故形态。
    // 下面逐条把「解析不到 / 认错人 / 扫飞了」的每条路都逼出异常。
    expect(() => readDecl('const OTHER = 1\n', 'SCORE_MID')).toThrow(/命中 0 次/)
    expect(() => readDecl('const A = 1\nconst A = 2\n', 'A')).toThrow(/命中 2 次/)
    expect(() => readBody('const x = 1\n', 'matchByStory')).toThrow(/命中 0 次/)
    expect(() => readLine('nothing here\n', /^[ \t]*rankingDimensional:.*$/m)).toThrow(/命中 0 次/)
    expect(() => readDecl('const A = {1,2\n', 'A')).toThrow(/未结束/)
    expect(() => resolveAnchor({ key: 'x', file: 'src/lib/constants.ts', kind: 'decl', name: 'NO_SUCH_CONST' }))
      .toThrow(/命中 0 次/)
  })

  it('数据文件发现器扫到了文件（目录改名/清空会当场变红，而不是「没有反例」）', () => {
    for (const set of FILE_SETS) {
      expect(discoverFiles(set).length).toBeGreaterThanOrEqual(set.minCount)
    }
    expect(discoverFiles(FILE_SETS[0])).toContain('scripts/data/question-observation-remap.v3.json')
  })

  it('注释与展示切片的改动不进指纹（这条定义了守卫的边界，别删）', () => {
    // 指纹的 key 集合本身就是边界声明：LOW_MATCH_SHOW_MAX / ANON_* 一律不在里面。
    // 依据 constants.ts:76-82 —— B 类兜底上限是【展示上限】，不改任何分档/入库判定。
    const keys = Object.keys(currentDigests())
    expect(keys.some((k) => k.includes('LOW_MATCH_SHOW_MAX'))).toBe(false)
    expect(keys.some((k) => k.includes('ANON_'))).toBe(false)
    expect(keys.some((k) => k.includes('RANKING_ALGO_VERSION'))).toBe(false)
  })
})

describe('钉住值：口径输入 ↔ RANKING_ALGO_VERSION', () => {
  const digests = currentDigests()

  if (process.env.PIN_DUMP === '1') {
    // 维护通道：钉住值失配时用它打印当前实际值（确认「这次确实该 bump」之后再写回 PINNED）
    console.log('PIN_DUMP algoVersion:', RANKING_ALGO_VERSION)
    console.log('PIN_DUMP combined:', combinedDigest(digests))
    console.log('PIN_DUMP digests:', JSON.stringify(digests, null, 2))
  }

  it('全部口径输入的指纹与钉住值逐项一致', () => {
    withHint(() => {
      expect(digests).toEqual(PINNED.digests)
    })
  })

  it('总指纹（含当前 RANKING_ALGO_VERSION）与钉住值一致', () => {
    withHint(() => {
      expect(combinedDigest(digests)).toBe(PINNED.combined)
    })
  })

  it('钉住值登记的 algoVersion 就是当前生效的那个', () => {
    withHint(() => {
      expect(PINNED.algoVersion).toBe(RANKING_ALGO_VERSION)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 已知漏判 / 误报（改本文件前先读）：
//
// 【漏判·第一位，且是设计上的洞】① **变异清单第 7 条（直接向 `question_observation_links` 插行、
//   不动任何文件）α 抓不到。α 通过 ≠ 覆盖完整；第 7 条是已知残余风险，β（映射指纹进快照 key）是它
//   唯一的解。** 本项目有在 Supabase SQL Editor 手跑 SQL 的既有习惯（0018–0023、0046–0051 都是这形态），
//   那条路绕开一切文件守卫。同理，题库本身在库里被直接 UPDATE（改题面 / 改 season）也抓不到。
//   ⚠️ 这一条**没有做实测**（实施时不许连生产库），是按「本守卫只读文件」推出来的必然结论，
//   不是跑出来的结果 —— 其余 10 条变异都是逐条真跑的，只有它不是。
//
// 【漏判】② 本守卫**无法机械强制「真的 bump 了」**。静态测试拿不到「上一次的值」，只要有人把 PINNED
//   整块按当前实际值重写、不动版本号，它就是绿的。它强制的是【必须停下来看一眼】，以及让
//   （版本号，指纹）成对留证。真正想让「不 bump 就用不了」成立，只有把口径指纹并进存档 key（β）。
//
// 【漏判】③ 只钉「输入」，不钉「模型的行为」。同一个 prompt、同一个模型名，上游模型权重更新了，
//   高/中/低集合照样会变——那不是本守卫能覆盖的，靠金标回归与真实选题行为兜。
//
// 【漏判】④ 依赖链只钉一层：prompt 里的 ${ECHO_PREFIX_LEN} 已单独钉住，但若将来 prompt 里插入新的
//   外部变量、或漏斗逻辑被抽到新模块，新模块不会自动进清单。加逻辑时同步加锚点。
//
// 【误报】⑤ 邻接表 / 函数体的**纯格式重排**（换行、缩进）会让 decl 锚点变红（decl 刻意不压平空白——
//   prompt 的空白是语义，压平会漏掉真实改动）。body 锚点已剔注释 + 压平串外空白，改注释不会红。
//
// 【边界】⑥ 扫描器是手写小状态机，不是 TS 解析器：假定被锚定的表达式里没有【含花括号或引号的正则
//   字面量】、模板字符串的 ${} 里没有反引号。当前 9 个 decl 锚点都满足；违反时会抛「括号不平衡」
//   之类的异常（响亮地红），不会静默给出半截原文。
//
// 【故意不收】⑦ scripts/data/observation-points-seed.json（DB 参照表种子）：它同时承载展示名与
//   雷达图阈值，改个显示名就变红属于过敏；而它真正影响召回的部分（49 个 code 的集合）已由
//   extraction 的 SYSTEM_PROMPT（taxonomy 唯一真源）+ 邻接表两处钉住。
// ─────────────────────────────────────────────────────────────────────────────
