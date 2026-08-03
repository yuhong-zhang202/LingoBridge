/**
 * @module   lib/page-route.test
 * @desc     page.view 的 pathname → route 映射红线。三件事：
 *           ① 隐私：喂带 query / hash 的路径（含 `?h=` handoff key，可反查用户原文）时，
 *              产出【只可能是枚举 code】，绝不含任何 query 片段 —— 这是 P3 埋点的最高红线；
 *           ② 白名单：表外路径一律 'other'，不做前缀匹配、不兜底回路径原文；
 *           ③ 清单同步：PAGE_ROUTE 与映射表互相钉住，且 src/app 下每个 page.tsx 都必须已登记 ——
 *              漏登记的后果是「那一页的浏览全糊进 other」，不报错、只在看板上体现，故用测试挡在上线前。
 * @author   LingoBridge
 * @created  2026-08-03
 */
import fs from 'fs'
import path from 'path'
import { toPageRoute, PATH_TO_ROUTE } from '@/lib/page-route'
import { PAGE_ROUTE } from '@/lib/event-schema'

describe('toPageRoute · 白名单映射', () => {
  test.each(Object.entries(PATH_TO_ROUTE))('%s → %s', (pathname, route) => {
    expect(toPageRoute(pathname)).toBe(route)
  })

  test.each([
    ['/foo'],                 // 不存在的页面
    ['/write/extra'],         // 表内路径的子路径：刻意不做前缀匹配，不许算成 write
    ['/WRITE'],               // 大小写近似
    ['/write.'],              // 形近
    ['//write'],              // 双斜杠
    [''],                     // 空串
  ])('表外路径 %s → other', (pathname) => {
    expect(toPageRoute(pathname)).toBe('other')
  })

  test('null / undefined → other，不抛错', () => {
    expect(toPageRoute(null)).toBe('other')
    expect(toPageRoute(undefined)).toBe('other')
  })

  test('尾斜杠与根路径', () => {
    expect(toPageRoute('/write/')).toBe('write')
    expect(toPageRoute('/anki/review/')).toBe('anki_review')
    expect(toPageRoute('/')).toBe('home')
  })
})

describe('🔴 隐私红线 · 产出绝不含 query / hash / 路径原文', () => {
  // 这些是本项目 URL 上真实出现过的参数；`h` 是 handoff key —— 能反查到用户故事原文。
  const WITH_QUERY: Array<[string, string]> = [
    ['/matching?h=SECRET_HANDOFF_KEY_9f3a', 'matching'],
    ['/practice-question?qid=123e4567-e89b-12d3-a456-426614174000', 'practice_question'],
    ['/analysis?corpusId=abcd-efgh&h=zzz', 'analysis'],
    ['/restructure#我的故事原文片段', 'restructure'],
    ['/write?text=%E6%88%91%E7%9A%84%E7%A7%81%E5%AF%86', 'write'],
  ]
  test.each(WITH_QUERY)('%s 只产出枚举 code %s', (input, expected) => {
    expect(toPageRoute(input)).toBe(expected)
  })

  test('产出恒为 PAGE_ROUTE 里的值，且不含输入里的任何 query 片段', () => {
    const inputs = [
      ...WITH_QUERY.map(([i]) => i),
      '/未登记的页面?h=SECRET_HANDOFF_KEY_9f3a',   // 表外 + 带敏感 query
      '/foo/bar?token=abc#frag',
      'https://lingobridge.app/matching?h=SECRET_HANDOFF_KEY_9f3a', // 有人喂了完整 URL
    ]
    for (const input of inputs) {
      const out: string = toPageRoute(input)
      // ① 只可能是契约里的枚举值（编译期已保证，这里再钉一道运行时证据）
      expect(PAGE_ROUTE as readonly string[]).toContain(out)
      // ② 输入里的敏感片段一个都不许出现在产出里
      for (const secret of ['SECRET_HANDOFF_KEY_9f3a', 'h=', 'qid=', 'corpusId=', 'token=', '?', '#', '/', '%E6']) {
        expect(out).not.toContain(secret)
      }
    }
  })
})

describe('清单同步 · PAGE_ROUTE ↔ 映射表 ↔ src/app 实际路由', () => {
  test('PAGE_ROUTE 里除 other 外的每个值都在映射表里有归属（否则那个枚举值永远不会出现）', () => {
    const mapped = new Set(Object.values(PATH_TO_ROUTE))
    for (const route of PAGE_ROUTE) {
      if (route === 'other') continue
      expect(mapped).toContain(route)
    }
  })

  test('映射表里没有重复的 route（两个路径共用一个 code 会让两页的数据混在一起）', () => {
    const values = Object.values(PATH_TO_ROUTE)
    expect(new Set(values).size).toBe(values.length)
  })

  /**
   * 扫 src/app 下所有 page.tsx，还原出它们的路由路径。
   * 跳过 api（不是页面）、_ 前缀私有目录、__tests__；括号路由组不产生路径段。
   * @param  dir      当前目录绝对路径
   * @param  route    该目录对应的路由前缀
   * @param  out      收集器
   * @returns         无
   */
  function collectRoutes(dir: string, route: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === 'page.tsx') out.push(route === '' ? '/' : route)
      if (!entry.isDirectory()) continue
      const name = entry.name
      if (name === 'api' || name === '__tests__' || name.startsWith('_')) continue
      // 括号目录 = Next 的路由组，不进 URL
      const seg = name.startsWith('(') && name.endsWith(')') ? '' : `/${name}`
      collectRoutes(path.join(dir, name), route + seg, out)
    }
  }

  test('src/app 下每个 page.tsx 的路由都已登记进映射表（新加页面忘了登记 → 那页浏览全糊进 other）', () => {
    const routes: string[] = []
    collectRoutes(path.join(process.cwd(), 'src/app'), '', routes)
    // 起码要扫到十几个页面；扫到 0 个说明这个护栏本身失效了（目录结构变了/路径错了）
    expect(routes.length).toBeGreaterThan(10)
    // 含动态段（[id]）的路由会在这里红掉 —— 那是刻意的：动态段必须先决定映射成哪个不含 id 的枚举值。
    for (const r of routes) expect(Object.keys(PATH_TO_ROUTE)).toContain(r)
  })
})
