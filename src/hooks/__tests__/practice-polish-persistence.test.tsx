/**
 * @module   practice-polish-persistence.test
 * @desc     usePolish ↔ storage 的接线守卫 —— 光测 storage 那一层不够：storage 全对、而 hook 没调回填 /
 *           没边攒边存，线上照样丢句子（那正是修复前的样子）。本文件用【真实 usePolish + 真实 storage】
 *           （只把 apiFetch / track 打桩）钉死三条：
 *             1. 边攒边存 —— 每优化成功一句，sessionStorage 立刻多一条，不等到点「结束」；
 *             2. 重载回填 —— 重新挂载（= 页面被手机浏览器回收后重载）时 polishHistory 的初始值就是已攒的那批，
 *                且必须来自 useState 初始化器（首帧就有，不能是 useEffect 补的一帧空态）；
 *             3. 判据 —— 开了新的一场、或题目参数对不上（历史/书签直接开 URL）时，初始值必须是空。
 *
 *   【harness 说明】jest 是 node 环境、项目没有 jsdom / testing-library（不为此引新依赖），
 *   故用 react-dom/server 渲染一个只调 usePolish 的探针组件把返回值捞出来。SSR 里 useState 的
 *   setter 在渲染结束后是 no-op（React 官方行为），所以：
 *     · 「首帧拿到什么」= 探针那次渲染读到的 polishHistory —— 这正是要守的初始化器语义，观测是真的；
 *     · 「优化过程中内存里累积成什么」在 SSR 里观测不到（state 不会更新），故本文件对优化后的断言
 *       一律落在【sessionStorage 的实际内容】上 —— 而那恰恰就是本次修复的要害（内存本来就会丢）。
 *     · 「点结束写什么」由练习页负责（handleEnd 写的是 hook 的 polishHistory），这里用「重新挂载后的
 *       初始值」代表那一刻的内存值：两者在修复后必须相等，不等就是回填坏了。
 * @author   LingoBridge
 * @created  2026-08-07
 */
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn() }))
jest.mock('@/lib/client-events', () => ({ track: jest.fn() }))

import { type JSX } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { usePolish } from '@/hooks/usePolish'
import {
  startPracticeSession,
  setSessionPolishes,
  getSessionPolishes,
  type PracticeSessionScope,
} from '@/lib/storage'
import { apiFetch } from '@/lib/api-client'
import type { PracticeScaffold } from '@/lib/types'

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>

const SCOPE_A: PracticeSessionScope = { questionId: 'q-A', storyId: 's-A', level: '6.0', review: false }
const SCOPE_B: PracticeSessionScope = { questionId: 'q-B', storyId: 's-A', level: '6.0', review: false }

const SCAFFOLD: PracticeScaffold = {
  part: 2,
  questionForAI: 'Describe a place you like',
  displayEn: 'Describe a place you like',
  displayZh: '描述一个你喜欢的地方',
  focusPoints: [],
  part3Questions: [],
  level: '6.0',
}

/** 最小 sessionStorage 垫片（node 环境无 window/sessionStorage） */
function installStorage(): void {
  const map = new Map<string, string>()
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size },
  } as Storage
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { sessionStorage: store }
  g.sessionStorage = store
}

/**
 * 挂载一次练习页（只挂 usePolish 这一块），把 hook 的返回值捞出来
 * @param  scope 本次挂载时 URL 上的题目参数
 * @returns      usePolish 的返回值（polishHistory 是首帧的值 = 初始化器的产物）
 */
function mountPractice(scope: PracticeSessionScope): ReturnType<typeof usePolish> {
  const box: { api: ReturnType<typeof usePolish> | null } = { api: null }
  function Probe(): JSX.Element {
    box.api = usePolish({
      level: scope.level,
      scope,
      scaffold: SCAFFOLD,
      popupRef: { current: null },
      onTrialQuota: () => {},
      onConsentDenied: () => {},
    })
    return <span>{box.api.polishHistory.length}</span>
  }
  const markup = renderToStaticMarkup(<Probe />)
  if (box.api === null) throw new Error('探针没跑起来（renderToStaticMarkup 没调用组件）')
  // 首帧渲染产物里就带着条数：证明回填来自 useState 初始化器，而不是 useEffect 补的第二帧
  expect(markup).toBe(`<span>${box.api.polishHistory.length}</span>`)
  return box.api
}

/** 让下一次 /api/practice/polish 返回一条可用的优化结果 */
function nextPolishOk(optimized: string): void {
  mockApiFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ needsWork: true, optimized, note: '换个更自然的说法' }), { status: 200 }),
  )
}

beforeEach(() => {
  installStorage()
  jest.clearAllMocks()
})

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>
  delete g.window
  delete g.sessionStorage
})

describe('边攒边存：优化成功一句就落一次盘，不等到点「结束」', () => {
  test('优化 3 句 → sessionStorage 里逐句累加到 3 条（顺序与内容原样）', async () => {
    startPracticeSession()
    const api = mountPractice(SCOPE_A)
    expect(getSessionPolishes()).toEqual([])

    for (const [i, text] of ['optimized 1', 'optimized 2', 'optimized 3'].entries()) {
      nextPolishOk(text)
      await api.runPolish(`原句 ${i + 1}`)
      expect(getSessionPolishes()).toHaveLength(i + 1)
    }
    const saved = getSessionPolishes()
    expect(saved.map(p => p.optimized)).toEqual(['optimized 1', 'optimized 2', 'optimized 3'])
    expect(saved.map(p => p.original)).toEqual(['原句 1', '原句 2', '原句 3'])
    // 归档字段照旧取自 scaffold（这块行为不能被本次改动碰坏）
    expect(saved[0].part).toBe(2)
    expect(saved[0].questionEn).toBe('Describe a place you like')
  })

  test('「这句已经够好」（needsWork=false）不入库，与修复前一致', async () => {
    startPracticeSession()
    const api = mountPractice(SCOPE_A)
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ needsWork: false, optimized: '', note: '' }), { status: 200 }),
    )
    await api.runPolish('已经挺好的一句')
    expect(getSessionPolishes()).toEqual([])
  })

  test('优化失败（500）不写存储，也不清掉已攒的句子', async () => {
    startPracticeSession()
    const api = mountPractice(SCOPE_A)
    nextPolishOk('optimized 1')
    await api.runPolish('原句 1')
    mockApiFetch.mockResolvedValueOnce(new Response('{}', { status: 500 }))
    await api.runPolish('原句 2')
    expect(getSessionPolishes().map(p => p.optimized)).toEqual(['optimized 1'])
  })
})

describe('重载回填：页面被回收后重新挂载，句子必须还在', () => {
  test('攒了 3 句 → 重新挂载 → 首帧 polishHistory 就是那 3 句', async () => {
    startPracticeSession()
    const first = mountPractice(SCOPE_A)
    for (const text of ['optimized 1', 'optimized 2', 'optimized 3']) {
      nextPolishOk(text)
      await first.runPolish('原句')
    }

    // 页面被浏览器回收 → 重载：新的 hook 实例、内存全零
    const afterReload = mountPractice(SCOPE_A)
    expect(afterReload.polishHistory.map(p => p.optimized)).toEqual(['optimized 1', 'optimized 2', 'optimized 3'])

    // 练习页点「结束」写的就是这份 polishHistory —— 不再是空数组把存好的句子盖掉
    setSessionPolishes(afterReload.polishHistory, SCOPE_A)
    expect(getSessionPolishes()).toHaveLength(3)
  })

  test('重载后继续优化，接着往后攒（不覆盖、不从头来）', async () => {
    startPracticeSession()
    const first = mountPractice(SCOPE_A)
    nextPolishOk('optimized 1')
    await first.runPolish('原句 1')

    const afterReload = mountPractice(SCOPE_A)
    nextPolishOk('optimized 2')
    await afterReload.runPolish('原句 2')
    expect(getSessionPolishes().map(p => p.optimized)).toEqual(['optimized 1', 'optimized 2'])
  })
})

describe('回填判据：只有「本场 id 在 + 题目参数一致」才回填', () => {
  test('从入口开了新的一场 → 首帧是空的（不串上一场的句子）', async () => {
    startPracticeSession()
    const first = mountPractice(SCOPE_A)
    nextPolishOk('optimized 1')
    await first.runPolish('原句 1')

    startPracticeSession()                       // 入口开 B 场
    expect(mountPractice(SCOPE_B).polishHistory).toEqual([])
    expect(getSessionPolishes()).toEqual([])     // 反馈页那一路也读到 0 句
  })

  test('不经入口、直接开 URL 且题目参数不一致 → 首帧是空的', async () => {
    startPracticeSession()
    const first = mountPractice(SCOPE_A)
    nextPolishOk('optimized 1')
    await first.runPolish('原句 1')

    expect(mountPractice(SCOPE_B).polishHistory).toEqual([])
  })

  test('存储彻底不可用（无痕模式）：挂载不崩、优化不崩，首帧就是空的', async () => {
    const g = globalThis as unknown as Record<string, unknown>
    const boom = (): never => { throw new DOMException('模拟无痕模式') }
    const store = { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 } as unknown as Storage
    g.window = { sessionStorage: store }
    g.sessionStorage = store
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const api = mountPractice(SCOPE_A)
    expect(api.polishHistory).toEqual([])
    nextPolishOk('optimized 1')
    await expect(api.runPolish('原句 1')).resolves.toBeUndefined()   // 不抛、不卡住
    jest.restoreAllMocks()
  })
})
