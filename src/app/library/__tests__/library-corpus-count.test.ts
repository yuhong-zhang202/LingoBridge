/**
 * @module   library-corpus-count.test
 * @desc     守卫：素材库首屏的语料计数【只数语料条数，且只发一个请求】。
 *
 *   【为什么要有这组测试】2026-08-08 前，本页首屏会把整份语料列表拉进来，并对【每一条】语料
 *   再发 2 个请求（getCorpusPointCodes + getQuestionCountByObservations）算出 matchedCount /
 *   dimension —— 即 1 + 2N 个请求。而这两个字段的唯一消费者 MyStoriesTab 早已是全仓零引用的
 *   孤儿组件（替代品 MyCorpusTab 于 04efb70 上线），算出来的东西一个字都没显示给任何人。
 *   最贵的一位生产用户有 59 条语料 = 119 个请求，全部白跑。
 *   已连同 MyStoriesTab、全局 MyStory 类型一并删除，本组测试防止它悄悄长回来。
 *
 *   【每条守的是行为还是结构，逐条标注】
 *     · describe 一：守【行为】—— 真调 listMyCorpus，用假 supabase client 记账，断言返回行数
 *       即计数、且整个取数只碰 corpus 一张表一次。这是真实返回值与真实调用次数。
 *     · describe 二：守【结构】—— 对 page.tsx / types.ts 源码做文本断言。
 *       ⚠️ 诚实标注：本仓库无 jsdom / testing-library 且禁止新增依赖，渲染不了 LibraryPage，
 *       所以「首屏实际发几个请求」这件事测不到运行时，只能钉住写法：首屏取数不得再出现
 *       per-corpus 的 map(async / 那两个函数的 import。它守的是【结构不是行为】——
 *       有人换个写法绕过去（比如新写一个同样逐条派生的辅助函数）本守卫抓不到。
 *
 *   【触发本守卫后怎么办】不要改测试来迁就实现。要恢复「已匹配 N 道题」这类逐条派生的展示，
 *   正确做法是让【展示它的那个组件】自己批量取数（一次请求拿回全部语料的匹配数），
 *   而不是把 1 + 2N 的循环放回首屏。
 * @author   LingoBridge
 * @created  2026-08-08
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

jest.mock('@/lib/supabase', () => ({
  getSupabase: jest.fn(),
  ensureSession: jest.fn(() => Promise.resolve('u1')),
}))

import { listMyCorpus } from '@/lib/db/corpus'
import { getSupabase } from '@/lib/supabase'

const mockGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>

/** 造 N 行 corpus 表行（snake_case，字段取 mapCorpusRow 用得到的那些）。 */
function makeRows(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c-${i}`,
    user_id: 'u1',
    source: 'voice',
    raw_text: `原文 ${i}`,
    cleaned_text: null,
    summary: null,
    audio_url: null,
    status: 'extracted',
    created_at: '2026-08-08T00:00:00Z',
  }))
}

/**
 * 装一个记账用的假 supabase client：记下每次 .from() 的表名，链式方法一路返回自身，
 * 末端 await 时给出预置的行。
 * @param rows 让查询返回的行
 * @returns    tables —— 被查过的表名（按调用顺序）
 */
function mockClient(rows: Record<string, unknown>[]): { tables: string[] } {
  const tables: string[] = []
  const builder = {
    select: () => builder,
    order: () => Promise.resolve({ data: rows, error: null }),
  }
  const from = (table: string): typeof builder => {
    tables.push(table)
    return builder
  }
  mockGetSupabase.mockReturnValue({ from } as unknown as ReturnType<typeof getSupabase>)
  return { tables }
}

// ── 一、【行为】计数口径 = 语料条数，且只发一个请求 ──────────────────────────────
describe('素材库首屏语料计数 · 口径与请求数', () => {
  beforeEach(() => jest.clearAllMocks())

  it('计数 = listMyCorpus 的行数（3 行就是 3，不折算成对子数）', async () => {
    mockClient(makeRows(3))
    const corpus = await listMyCorpus()
    expect(corpus.length).toBe(3)
  })

  it('无对子的语料照样算进去（生产里 97% 的语料没绑对子，不能漏）', async () => {
    // 假 client 不接 corpus_question_matches / anki_cards，能返回就说明计数与对子无关
    mockClient(makeRows(5))
    await expect(listMyCorpus().then((c) => c.length)).resolves.toBe(5)
  })

  it('0 条语料返回 0，不抛错（新用户首屏）', async () => {
    mockClient([])
    await expect(listMyCorpus().then((c) => c.length)).resolves.toBe(0)
  })

  it('取这个数只碰 corpus 一张表一次 —— 不再逐条派生（59 条语料曾要发 119 个请求）', async () => {
    const { tables } = mockClient(makeRows(59))
    const corpus = await listMyCorpus()
    expect(corpus.length).toBe(59)
    expect(tables).toEqual(['corpus'])
  })
})

// ── 二、【结构】首屏取数写法：不得再出现 per-corpus 的额外请求 ───────────────────
describe('LibraryPage 源码守卫 · 首屏不得逐条派生（守结构，非行为）', () => {
  const SRC = join(process.cwd(), 'src')
  /** 剥掉注释再断言：本次改动特意在注释里写明「以前调过什么、为什么删」，不剥会把说明当代码抓。范式同 a11y-destructive-actions.test。 */
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const readCode = (rel: string): string => stripComments(readFileSync(join(SRC, rel), 'utf8'))
  const page = readCode('app/library/page.tsx')
  const viewTypes = readCode('app/library/types.ts')
  const libTypes = readCode('lib/types.ts')

  it('首屏取数只数行数：出现 corpus.length，不出现 corpus.map', () => {
    expect(page).toContain('corpus.length')
    expect(page).not.toMatch(/corpus\.map\(/)
  })

  it('不再 import 那两个 per-corpus 取数函数（它们本身没删，别处可用，只是首屏不该调）', () => {
    expect(page).not.toContain('getCorpusPointCodes')
    expect(page).not.toContain('getQuestionCountByObservations')
  })

  it('首屏没有任何 async 回调式的逐条派生（Promise.all + map(async 是旧形态特征）', () => {
    expect(page).not.toContain('Promise.all')
    expect(page).not.toMatch(/map\(async/)
  })

  it('两套 UI 的 props 里不再有 stories 列表，只有 corpusCount 一个数', () => {
    expect(viewTypes).not.toMatch(/stories:\s*MyStory\[\]/)
    expect(viewTypes).toContain('corpusCount: number')
  })

  it('全局 types 里 MyStory / matchedCount 已随孤儿组件一并删除', () => {
    expect(libTypes).not.toMatch(/export interface MyStory\b/)
    expect(libTypes).not.toContain('matchedCount')
  })

  it('「已攒下 N 条」与「我的语料」计数同源：两套 UI 的总计都用 corpusCount 相加', () => {
    for (const f of ['app/library/LibraryMobile.tsx', 'app/library/LibraryDesktop.tsx']) {
      const src = readCode(f)
      expect(src).toContain('const totalCount = corpusCount + cards.length')
      expect(src).not.toContain('stories.length')
    }
  })
})
