/**
 * @module   analysis-stream-parse.test
 * @desc     增量段解析器的「正确性不变式」测试：对任意合法 full JSON 的任意分块方式，
 *           增量吐出的段严格等于 JSON.parse 的对应部分（structureLabel 相等、focusPoint 序列
 *           深等于 .focusPoints、phraseGroup 序列深等于 .phrases）。覆盖逐字符/随机切点/整块、
 *           字符串内含 {}"、转义引号与反斜杠、focusPoints 2 点/3 点、phrases 多组、键乱序、前导 ```json 围栏。
 * @author   LingoBridge
 * @created  2026-08-01
 */
import { AnalysisStreamParser, type AnalysisStreamSection } from '@/lib/analysis-stream-parse'

/** 把 full 按给定分块方式喂进解析器，收集吐出的段 */
function feed(full: string, chunks: string[]): AnalysisStreamSection[] {
  const out: AnalysisStreamSection[] = []
  const parser = new AnalysisStreamParser((s) => out.push(s))
  for (const c of chunks) parser.push(c)
  return out
}

/** 把段序列还原成 { structureLabel, focusPoints, phrases } 以便与 JSON.parse 深比 */
function reassemble(sections: AnalysisStreamSection[]): {
  structureLabel: string | undefined
  focusPoints: unknown[]
  phrases: unknown[]
} {
  let structureLabel: string | undefined
  const focusPoints: unknown[] = []
  const phrases: unknown[] = []
  for (const s of sections) {
    if (s.kind === 'structureLabel') structureLabel = s.value
    else if (s.kind === 'focusPoint') focusPoints.push(s.value)
    else phrases.push(s.value)
  }
  return { structureLabel, focusPoints, phrases }
}

/** 固定大小硬切（故意不对齐任何结构边界） */
function fixedChunks(s: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
  return out
}

/** 逐字符切 */
function perChar(s: string): string[] {
  return s.split('')
}

/** mulberry32：确定性伪随机，保证测试可复现 */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 用随机切点把 s 切成若干块 */
function randomChunks(s: string, rand: () => number): string[] {
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    const step = 1 + Math.floor(rand() * 9)  // 1..9
    out.push(s.slice(i, i + step))
    i += step
  }
  return out
}

/**
 * 核心断言：对给定 full JSON，用多种分块方式喂解析器，每种都必须严格等于 JSON.parse 的对应部分。
 */
function assertInvariant(full: string): void {
  const parsed = JSON.parse(full) as {
    structureLabel: string
    focusPoints: unknown[]
    phrases: unknown[]
  }

  const chunkings: string[][] = [
    [full],                         // 整块
    perChar(full),                  // 逐字符
    fixedChunks(full, 3),
    fixedChunks(full, 7),
    fixedChunks(full, 13),
  ]
  // 再叠加多组随机切点
  for (let seed = 1; seed <= 20; seed++) {
    chunkings.push(randomChunks(full, mulberry32(seed)))
  }

  for (const chunks of chunkings) {
    const got = reassemble(feed(full, chunks))
    expect(got.structureLabel).toEqual(parsed.structureLabel)
    expect(got.focusPoints).toEqual(parsed.focusPoints)
    expect(got.phrases).toEqual(parsed.phrases)
  }
}

describe('AnalysisStreamParser · 正确性不变式（任意分块 === JSON.parse 对应部分）', () => {
  test('P1. Part 2：structureLabel + focusPoints 3 点 + phrases 多组', () => {
    const obj = {
      structureLabel: '交代背景 · 讲清重点 · 补得更完整',
      focusPoints: [
        { title: '交代背景', desc: '一句话带过时间、谁、什么事。' },
        { title: '讲清重点', desc: '把冲突的起因讲到位。' },
        { title: '补得更完整', desc: '补上感受和结果，这里最拉分。' },
      ],
      phrases: [
        { group: '经过', items: [
          { text: 'talked it out', meaning: '把话说开', scene: '两人化解误会时' },
          { text: 'cleared the air', meaning: '消除隔阂', scene: '关系缓和时' },
        ] },
        { group: '感受', items: [
          { text: 'kind of relieved', meaning: '有点松了口气', scene: '压力解除后' },
        ] },
        { group: '行为', items: [
          { text: 'reached out first', meaning: '主动联系', scene: '主动示好时' },
        ] },
      ],
    }
    assertInvariant(JSON.stringify(obj))
  })

  test('P2. Part 1：focusPoints 2 点', () => {
    const obj = {
      structureLabel: '开门见山 · 点到即止',
      focusPoints: [
        { title: '怎么起手', desc: '先说你做的事，别铺垫。' },
        { title: '收在哪', desc: '挑一个真实小细节点一下就够。' },
      ],
      phrases: [
        { group: '行为', items: [{ text: 'hit the gym', meaning: '去健身', scene: '日常运动' }] },
        { group: '时间', items: [{ text: 'after work', meaning: '下班后', scene: '交代时间' }] },
        { group: '感受', items: [{ text: 'pretty tired', meaning: '挺累的', scene: '描述状态' }] },
      ],
    }
    assertInvariant(JSON.stringify(obj))
  })

  test('P3. 字符串内含 {}[]" 与转义引号/反斜杠（scanner 必须忽略字符串内的结构符）', () => {
    // 用 JSON.stringify 保证合法，值本身塞进各种会误导裸扫描的字符
    const obj = {
      structureLabel: '含 {大括号} 和 [方括号] 的标签',
      focusPoints: [
        { title: '带引号', desc: '别只说 "I was scared"，要给动作' },
        { title: '带反斜杠', desc: '路径 like C:\\Users\\me 和结尾反斜杠 \\' },
      ],
      phrases: [
        { group: '经过', items: [
          { text: 'the breakdown of who did what', meaning: '谁做了什么的分工', scene: '说明分工时' },
          { text: 'showed the records', meaning: '出示记录', scene: '拿证据时' },
        ] },
      ],
    }
    assertInvariant(JSON.stringify(obj))
  })

  test('P4. 键乱序（phrases 在前、structureLabel 在中、focusPoints 在后）', () => {
    // 手写乱序 JSON，确保解析不依赖键顺序
    const full = `{
      "phrases": [
        { "group": "感受", "items": [ { "text": "so glad", "meaning": "很高兴", "scene": "开心时" } ] }
      ],
      "structureLabel": "乱序也要对",
      "focusPoints": [
        { "title": "第一点", "desc": "说明一。" },
        { "title": "第二点", "desc": "说明二。" }
      ]
    }`
    assertInvariant(full)
  })

  test('P5. 前导 ```json 围栏 + 前后空白（从第一个顶层 { 起扫，忽略闭合后一切）', () => {
    const obj = {
      structureLabel: '围栏也能剥',
      focusPoints: [{ title: '要点', desc: '说明。' }],
      phrases: [{ group: '行为', items: [{ text: 'go for a walk', meaning: '散步', scene: '休闲时' }] }],
    }
    const full = '```json\n' + JSON.stringify(obj, null, 2) + '\n```\n'
    // assertInvariant 里的 JSON.parse 需纯 JSON，这里单独构造期望值比对
    const parsed = obj
    const chunkings: string[][] = [[full], perChar(full), fixedChunks(full, 5)]
    for (let seed = 1; seed <= 10; seed++) chunkings.push(randomChunks(full, mulberry32(seed)))
    for (const chunks of chunkings) {
      const got = reassemble(feed(full, chunks))
      expect(got.structureLabel).toEqual(parsed.structureLabel)
      expect(got.focusPoints).toEqual(parsed.focusPoints)
      expect(got.phrases).toEqual(parsed.phrases)
    }
  })

  test('P6. 尽早吐出：structureLabel 在 focusPoints/phrases 之前完成时应先被吐', () => {
    const obj = {
      structureLabel: '先来的',
      focusPoints: [{ title: 'a', desc: 'aa' }],
      phrases: [{ group: 'g', items: [{ text: 't', meaning: 'm', scene: 's' }] }],
    }
    const full = JSON.stringify(obj)
    const sections = feed(full, [full])
    expect(sections.map((s) => s.kind)).toEqual(['structureLabel', 'focusPoint', 'phraseGroup'])
  })

  test('P7. 数字/布尔等非目标键的值被正确跳过，不影响目标段', () => {
    const full = `{
      "version": 3,
      "ok": true,
      "structureLabel": "混入无关键",
      "note": null,
      "focusPoints": [ { "title": "t", "desc": "d" } ],
      "phrases": [ { "group": "g", "items": [ { "text": "x", "meaning": "y", "scene": "z" } ] } ]
    }`
    const parsed = JSON.parse(full) as { structureLabel: string; focusPoints: unknown[]; phrases: unknown[] }
    for (const chunks of [[full], perChar(full), fixedChunks(full, 4)]) {
      const got = reassemble(feed(full, chunks))
      expect(got.structureLabel).toEqual(parsed.structureLabel)
      expect(got.focusPoints).toEqual(parsed.focusPoints)
      expect(got.phrases).toEqual(parsed.phrases)
    }
  })
})
