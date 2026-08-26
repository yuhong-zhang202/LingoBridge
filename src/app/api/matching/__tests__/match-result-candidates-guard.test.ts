/**
 * @module   match-result-candidates-guard.test
 * @desc     规则守卫（静态扫描源码 + 读契约常量，不发请求、不连库）：
 *           `match.result` 的候选池明细字段 `candidates` 一旦被删掉、改形状、或**在某条发事件的路径上漏写**，
 *           本测试必须变红。
 *
 *           ── 为什么要立这条规则（不是给字段写个断言就完了）──
 *           这个字段是「88.5% 的空手到底是重排判错还是召回给错题」的唯一分辨依据，而它最可能的死法
 *           **不是被删**，是**在某条分支上没写**：全站有三处发 match.result（阻塞路一处 + 流式的
 *           「读档命中」「新算」各一处），少写一处那条路上的 `candidates` 就永远缺失，
 *           而**缺字段和「候选池真的是空的」在库里长得一模一样**，tsc / eslint / build / 其余单测全绿。
 *           本项目已有同款前科：2026-08-02 流式两处漏 isQa，生产 match.result 全部 is_qa=false，
 *           几周后拉数据才发现。故本文件守的是【结构规则】：三处、且三处都从同一个函数取 props。
 *
 *           ── 分工（缺一不可，别以为静态扫描就够）──
 *           · 本文件      = 结构规则（几处发、是不是同一个真源、契约字段名还在不在）；
 *           · route.test  = 行为断言（四条真实路径 fresh/cache/joined/零召回 各跑一遍，验值）。
 *           静态扫描只看「有没有调用」，看不出「调用在哪个分支里」——那一层由行为断言兜。
 *
 *           扫描器的已知漏判 / 误报写在文件末尾，改本文件前先读那段。
 * @author   LingoBridge
 * @created  2026-08-26
 */
import fs from 'fs'
import path from 'path'
import { MATCH_RESULT_CANDIDATES_MAX, SERVER_ONLY_EVENTS } from '@/lib/event-schema'

/** 仓库根：本文件在 src/app/api/matching/__tests__/ 下，上五级即仓库根 */
const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const ROUTE_FILE = 'src/app/api/matching/route.ts'
const SCHEMA_FILE = 'src/lib/event-schema.ts'

/**
 * 读一个仓库内文件的全文。
 * @param  rel  相对仓库根的路径
 * @returns     文件全文（读不到直接抛错，绝不返回空串——空串会让下面所有断言「因为没有反例」而变绿）
 */
function readSrc(rel: string): string {
  const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
  if (text.trim().length === 0) throw new Error(`${rel} 读到空文件`)
  return text
}

/**
 * 从 `(` 开始扫一段平衡括号，返回括号【内】的原文。
 * 跟踪字符串与注释：参数里带 `//` 中文注释、带引号串都不会把扫描带偏。
 * @param  src   源码全文
 * @param  open  起始下标（src[open] 必须是 '('）
 * @returns      括号内原文
 */
function readBalanced(src: string, open: number): string {
  if (src[open] !== '(') throw new Error(`readBalanced 起点不是 '('（下标 ${open}）`)
  let depth = 0
  let i = open
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = nl === -1 ? src.length : nl
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end === -1) throw new Error('未闭合的块注释')
      i = end + 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === quote) break
        j++
      }
      if (j >= src.length) throw new Error(`未闭合的字符串字面量（下标 ${i}）`)
      i = j + 1
      continue
    }
    if (c === '(') { depth++; i++; continue }
    if (c === ')') {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
      i++
      continue
    }
    i++
  }
  throw new Error('扫描到文件末尾仍未闭合（括号不平衡？）')
}

/**
 * 取出 route.ts 里每一处 `logEvent(...)` 调用的实参原文。
 * @param  src  route.ts 全文
 * @returns     实参原文数组（按出现顺序）
 */
function logEventCallArgs(src: string): string[] {
  const out: string[] = []
  const re = /\blogEvent\(/g
  for (const m of src.matchAll(re)) {
    out.push(readBalanced(src, m.index! + m[0].length - 1))
  }
  return out
}

const ROUTE_SRC = readSrc(ROUTE_FILE)
const SCHEMA_SRC = readSrc(SCHEMA_FILE)
const LOG_EVENT_ARGS = logEventCallArgs(ROUTE_SRC)
/** 发 match.result 的那几处 logEvent 实参 */
const MATCH_RESULT_ARGS = LOG_EVENT_ARGS.filter((a) => a.includes("'match.result'"))

describe('扫描器自检（防「判据在那条路上不存在 → 恒绿」）', () => {
  it('扫到了 logEvent 调用，且其中确有发 match.result 的', () => {
    // 正则失配 / 文件改名 → 数组为空 → 下面每一条断言都会因为「没有反例」而变绿。先把这条路堵死。
    expect(LOG_EVENT_ARGS.length).toBeGreaterThan(0)
    expect(MATCH_RESULT_ARGS.length).toBeGreaterThan(0)
  })

  it('括号扫描器抓的是完整实参，不是半截', () => {
    // 每一处实参都必须自带 event 与 props 两个 key —— 抓半截时这条会挂
    for (const arg of MATCH_RESULT_ARGS) {
      expect(arg).toContain('event:')
      expect(arg).toContain('props:')
    }
  })

  it('括号/引号不平衡时抛错，绝不静默返回半截', () => {
    expect(() => readBalanced('f(a, b', 1)).toThrow(/未闭合/)
    expect(() => readBalanced("f('unclosed", 1)).toThrow(/未闭合/)
    // 正常输入：下标 1 才是 '('（下标 0 是 'f'），起点给错会命中上面那条「起点不是」
    expect(() => readBalanced('f(a)', 1)).not.toThrow()
    expect(() => readBalanced('abc', 0)).toThrow(/起点不是/)
  })
})

describe('规则一：发 match.result 的路径恰好三处，且三处共用同一份 props 真源', () => {
  it('route.ts 里 match.result 恰好出现三处，且全在 logEvent 调用里', () => {
    // 三处 = 阻塞路一处 + 流式「读档命中」「新算」各一处。
    // ⚠️ 新增第四条路径时这里必然变红，这是设计意图：逼作者当场确认新路径也带 candidates
    //   （漏带的后果是那条路上的 candidates 永远缺失，而缺字段与「候选池真的是空的」长得一模一样）。
    expect(MATCH_RESULT_ARGS).toHaveLength(3)
    // 字面量总数也必须是 3：这一条堵的是「绕开 logEvent 另起一处写库」
    expect([...ROUTE_SRC.matchAll(/'match\.result'/g)]).toHaveLength(3)
  })

  it('三处的 props 都由 matchResultEventProps 产出，没有第二份手抄的字面量', () => {
    for (const arg of MATCH_RESULT_ARGS) {
      expect(arg).toContain('matchResultEventProps(')
      // 手抄一份内联 props 的特征：把 primaryCode / candidateCount 直接写在调用里。
      // 2026-08-26 之前 handleBuffered 正是这个形态，于是「加字段只改一处函数」会漏掉它。
      expect(arg).not.toContain('primaryCode:')
      expect(arg).not.toContain('candidateCount:')
    }
  })

  it('matchResultEventProps 全仓只有一处定义（防又分叉出第二份）', () => {
    expect([...ROUTE_SRC.matchAll(/function matchResultEventProps\b/g)]).toHaveLength(1)
  })
})

describe('规则二：candidates 字段本身的形状没被改掉', () => {
  /** matchResultEventProps 的函数体原文 */
  const body = (() => {
    const at = ROUTE_SRC.indexOf('function matchResultEventProps')
    if (at < 0) throw new Error('route.ts 里找不到 matchResultEventProps')
    const brace = ROUTE_SRC.indexOf('{', ROUTE_SRC.indexOf(')', at))
    return ROUTE_SRC.slice(brace, ROUTE_SRC.indexOf('\n}\n', brace))
  })()

  it('四个字段名一个不少（改名 = 分析 SQL 全部失效，必须当场知道）', () => {
    expect(body).toContain('candidates:')
    for (const key of ['id:', 'score:', 'isPrimary:', 'obs:']) expect(body).toContain(key)
  })

  it('未打分写 null，绝不回填占位分（match-level 的 `?? 100` 覆辙）', () => {
    expect(body).toContain('q.relevanceScore ?? null')
    expect(body).not.toMatch(/relevanceScore\s*\?\?\s*(0|100)\b/)
  })

  it('上限走 event-schema 的常量，不在 route 里另写一个数字', () => {
    expect(body).toContain('MATCH_RESULT_CANDIDATES_MAX')
    expect(body).toMatch(/\.slice\(0, MATCH_RESULT_CANDIDATES_MAX\)/)
  })

  it('排的是副本，绝不就地 sort result.questions（那是要发给用户的展示序）', () => {
    // 埋点就地 sort = 埋点改产品行为。行为面由 route.test 的「不改展示序」用例兜，这里守写法。
    expect(body).not.toMatch(/result\.questions\.sort\(/)
    expect(body).toMatch(/\.map\(/)
  })
})

describe('规则三：契约与上限仍在 event-schema（埋点契约的唯一真源）', () => {
  it('MatchResultCandidate 接口与四个字段都在', () => {
    expect(SCHEMA_SRC).toContain('export interface MatchResultCandidate')
    for (const key of ['id: string', 'score: number | null', 'isPrimary: boolean', 'obs: string']) {
      expect(SCHEMA_SRC).toContain(key)
    }
  })

  it('上限是安全阀而不是采样：必须 ≥ 生产实测的最大候选数 91', () => {
    // 为什么钉这条而不是钉死 100：上限一旦低于真实最大候选数，就从「安全阀」变成了「按分采样」，
    // 而**选样的依据（重排分）正是被怀疑的那个东西** —— 若重排判错，那道用户其实能答的题
    // 恰恰会被压到低位切掉，数据就只能证明「重排自认最高的几道不行」，永远证不了「池子里有没有能答的」。
    expect(Number.isInteger(MATCH_RESULT_CANDIDATES_MAX)).toBe(true)
    expect(MATCH_RESULT_CANDIDATES_MAX).toBeGreaterThanOrEqual(91)
  })

  it('match.result 仍是服务端专属事件（不走 /api/events 的 sanitize）', () => {
    // 这条是 candidates 能存在的前提：/api/events 的 sanitize 是「字段逐个显式列出、未匹配一律丢」，
    // 哪天有人把 match.result 挪进 ClientEventPropsMap 走客户端上报，candidates 会被整个丢掉，
    // 且**丢得静默**（事件照常落库，只有这一个字段消失）。故此处钉住它的归属。
    expect([...SERVER_ONLY_EVENTS]).toContain('match.result')
    expect(SCHEMA_SRC).not.toMatch(/'match\.result':\s*\{/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 已知漏判 / 误报（改本文件前先读）：
//
// 【漏判】① 只看「有没有调用」，不看「调用在哪个分支里」。把某处 logEvent 塞进一个永远进不去的 if，
//   本规则照样判绿 —— 行为面由 __tests__/route.test.ts 的「候选池明细」describe（fresh / cache /
//   joined / 零召回 / 截断 / 展示序 六条真实路径）兜。两边缺一不可。
// 【漏判】② 判「三处」用的是字符串 'match.result' 在 route.ts 里的出现次数。若将来有人把事件名抽成
//   常量再引用（如 `event: MATCH_RESULT_EVENT`），本规则会数成 0 处 —— 但「扫描器自检」那条会当场变红
//   （MATCH_RESULT_ARGS 为空），不会静默放行。
// 【漏判】③ 字段名断言是子串匹配，认不出「字段在但值算错」（例如 obs 误取 pointName 而非 code）。
//   那一层同样由 route.test 的值断言兜。
// 【误报】④ `toHaveLength(3)` 是硬编码快照。**新增第四条发 match.result 的路径时它必然变红，这是设计
//   意图**：逼作者回来确认新路径也走了 matchResultEventProps，而不是默默漏掉一条路的 candidates。
// 【边界】⑤ 本文件只管 route.ts 这一条链路。若将来别的服务端模块也发 match.result，
//   规则一的「三处」会变红 —— 届时应把新出处一并纳入本规则，而不是放宽数字。
// ─────────────────────────────────────────────────────────────────────────────
