/**
 * @module   session-polishes.test
 * @desc     本场优化句子暂存（storage.ts）的场景守卫 —— 钉死「练习中途页面被重载，句子不能丢」这条修复，
 *           以及它的三条边界：不串场、不被深链误回填、存储不可用时不比修复前更糟。
 *
 *   为什么这些场景值得单独立测：手机浏览器（iOS Safari / Android Chrome）内存吃紧会回收后台标签页，
 *   而口语练习最容易中途锁屏 / 切 App —— 页面重载后纯内存的 polishHistory 归零，用户点「结束」
 *   写进去的是空数组，反馈页显示「这次没有要回顾的句子」。桌面几乎不复现，所以线上只有手机在报。
 *   这类 bug tsc / eslint / build 全绿，只有场景测能守。
 *
 *   本文件只测 storage 这一层的不变式；「usePolish 真的调了回填、真的边攒边存」在
 *   hooks/__tests__/practice-polish-persistence.test.tsx 里用真实 hook 守（两层缺一都会漏）。
 *   jest 默认 node 环境无 window/sessionStorage，沿用 qa-flag-client-events.test.ts 的垫片写法。
 * @author   LingoBridge
 * @created  2026-08-07
 */
import {
  startPracticeSession,
  setSessionPolishes,
  getSessionPolishes,
  resumeSessionPolishes,
  clearSessionPolishes,
  type PracticeSessionScope,
} from '@/lib/storage'
import type { SessionPolish } from '@/lib/types'

/** 本场句子在 sessionStorage 里的键（与 storage.ts 私有常量同值：老格式兼容那条必须能直接写脏数据进去） */
const SESSION_KEY = 'lingobridge:session_polishes'

/** 一场练习的题目参数（= 练习页 URL query 四件套） */
const SCOPE_A: PracticeSessionScope = { questionId: 'q-A', storyId: 's-A', level: '6.0', review: false }
/** 另一场：questionId 不同，其余相同 */
const SCOPE_B: PracticeSessionScope = { questionId: 'q-B', storyId: 's-A', level: '6.0', review: false }

/**
 * 造一条优化条目
 * @param n 序号（进句子内容，便于断言顺序）
 * @returns 一条 SessionPolish
 */
function polish(n: number): SessionPolish {
  return { original: `原句 ${n}`, optimized: `optimized ${n}`, note: `说明 ${n}`, part: 1, questionEn: 'Describe a place' }
}

/** 可控的 storage 垫片：throwOn 里的方法会抛错，用来模拟无痕模式 / 配额耗尽 */
function makeStorage(throwOn: ReadonlyArray<'getItem' | 'setItem' | 'removeItem'> = []): Storage {
  const map = new Map<string, string>()
  const boom = (name: string): never => { throw new DOMException(`模拟存储不可用：${name}`) }
  return {
    getItem: (k: string) => (throwOn.includes('getItem') ? boom('getItem') : map.get(k) ?? null),
    setItem: (k: string, v: string) => (throwOn.includes('setItem') ? boom('setItem') : void map.set(k, v)),
    removeItem: (k: string) => (throwOn.includes('removeItem') ? boom('removeItem') : void map.delete(k)),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size },
  } as Storage
}

/** 装上 window / sessionStorage 垫片（storage.ts 用裸 sessionStorage，两处都要有） */
function installStorage(store: Storage): void {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { sessionStorage: store }
  g.sessionStorage = store
}

beforeEach(() => {
  installStorage(makeStorage())
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>
  delete g.window
  delete g.sessionStorage
  jest.restoreAllMocks()
})

describe('场景 1 · 正常一场：优化 3 句 → 结束 → 反馈页拿到 3 句', () => {
  test('每优化一句就落一次盘，结束后反馈页读到全部 3 句', () => {
    startPracticeSession()
    const memory: SessionPolish[] = []          // 相当于练习页内存里的 polishHistory
    for (let i = 1; i <= 3; i++) {
      memory.push(polish(i))
      setSessionPolishes([...memory], SCOPE_A)  // 边攒边存
      expect(getSessionPolishes()).toHaveLength(i)
    }
    setSessionPolishes(memory, SCOPE_A)         // 点「结束」的收口写入
    expect(getSessionPolishes().map(p => p.optimized)).toEqual(['optimized 1', 'optimized 2', 'optimized 3'])
  })
})

describe('场景 2 · 中途重载（本次要修的 bug）', () => {
  test('优化 3 句 → 页面被浏览器回收重载 → 回填拿回 3 句 → 结束仍是 3 句', () => {
    startPracticeSession()
    const before = [polish(1), polish(2), polish(3)]
    setSessionPolishes(before, SCOPE_A)

    // 内存清零：页面被回收后重新加载，React state 从零开始，只能靠回填
    const resumed = resumeSessionPolishes(SCOPE_A)
    expect(resumed.map(p => p.optimized)).toEqual(['optimized 1', 'optimized 2', 'optimized 3'])

    // 点「结束」：写的是回填后的那份，不会拿空数组把存好的句子盖掉（修复前正是盖成了空）
    setSessionPolishes(resumed, SCOPE_A)
    expect(getSessionPolishes()).toHaveLength(3)
  })

  test('重载发生在一句都还没优化时，回填是空数组、不报错', () => {
    startPracticeSession()
    expect(resumeSessionPolishes(SCOPE_A)).toEqual([])
  })
})

describe('场景 3 · 不串场：上一场没看反馈就走，新一场必须从 0 开始', () => {
  test('A 场 3 句 → 从入口开 B 场 → B 场回填 0 句、反馈页也读到 0 句', () => {
    startPracticeSession()
    setSessionPolishes([polish(1), polish(2), polish(3)], SCOPE_A)

    startPracticeSession()   // 入口开新的一场
    expect(resumeSessionPolishes(SCOPE_B)).toEqual([])
    expect(getSessionPolishes()).toEqual([])
  })

  test('开新场后即使题目参数与上一场完全相同（同一题再练一次），也从 0 开始', () => {
    startPracticeSession()
    setSessionPolishes([polish(1)], SCOPE_A)
    startPracticeSession()
    expect(resumeSessionPolishes(SCOPE_A)).toEqual([])
  })

  test('每次开场的 id 都不同（同一个 id 会让上一场的句子被当成本场的）', () => {
    const first = startPracticeSession()
    const second = startPracticeSession()
    expect(first).not.toBe('')
    expect(second).not.toBe(first)
  })
})

describe('场景 4 · 不经入口直接开 URL（历史 / 书签）：参数对不上就不回填', () => {
  test('存的是 A 场的句子，当前 URL 是 B 题 → 不回填', () => {
    startPracticeSession()
    setSessionPolishes([polish(1), polish(2)], SCOPE_A)
    expect(resumeSessionPolishes(SCOPE_B)).toEqual([])
  })

  test('四个参数任意一个不同都不回填（level / review / storyId 各一例）', () => {
    startPracticeSession()
    setSessionPolishes([polish(1)], SCOPE_A)
    expect(resumeSessionPolishes({ ...SCOPE_A, level: '7.0' })).toEqual([])
    expect(resumeSessionPolishes({ ...SCOPE_A, review: true })).toEqual([])
    expect(resumeSessionPolishes({ ...SCOPE_A, storyId: 's-别的' })).toEqual([])
    // 反向确认：四个都一致时确实回填得到（否则上面三条可能是因为回填整体失效才绿的）
    expect(resumeSessionPolishes(SCOPE_A)).toHaveLength(1)
  })

  test('从来没开过场（没有本场 id）→ 即使参数一致也不回填', () => {
    // 直接把一份「像是上一场留下的」数据塞进去，但不调 startPracticeSession
    setSessionPolishes([polish(1)], SCOPE_A)
    expect(resumeSessionPolishes(SCOPE_A)).toEqual([])
    // 但反馈页那条路不受影响：拿到什么展示什么（结束→反馈的交接不做身份核对）
    expect(getSessionPolishes()).toHaveLength(1)
  })
})

describe('场景 5 · 老格式兼容：发版那一刻正在练习的用户，存的是裸数组', () => {
  test('getSessionPolishes 读得出裸数组、不抛', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([polish(1), polish(2)]))
    expect(getSessionPolishes().map(p => p.optimized)).toEqual(['optimized 1', 'optimized 2'])
  })

  test('老格式没有 id / 参数可核对 → 不回填，但也绝不抛', () => {
    startPracticeSession()
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([polish(1)]))
    expect(() => resumeSessionPolishes(SCOPE_A)).not.toThrow()
    expect(resumeSessionPolishes(SCOPE_A)).toEqual([])
  })

  test('脏数据（非 JSON / null / 数字）一律当空，不抛', () => {
    for (const raw of ['{坏掉的 json', 'null', '42', '"字符串"']) {
      sessionStorage.setItem(SESSION_KEY, raw)
      expect(getSessionPolishes()).toEqual([])
      expect(resumeSessionPolishes(SCOPE_A)).toEqual([])
    }
  })
})

describe('场景 6 · 存储不可用（无痕模式 / 配额耗尽）：不崩、不卡，退回修复前的行为', () => {
  test('setItem 抛异常：开场返回空串、写入返回 false、读一律空，全程不抛', () => {
    installStorage(makeStorage(['setItem']))
    expect(startPracticeSession()).toBe('')
    expect(setSessionPolishes([polish(1)], SCOPE_A)).toBe(false)
    expect(getSessionPolishes()).toEqual([])
    expect(resumeSessionPolishes(SCOPE_A)).toEqual([])
    expect(() => clearSessionPolishes()).not.toThrow()
  })

  test('getItem 抛异常：读一律空，写入不因读 id 失败而抛', () => {
    installStorage(makeStorage(['getItem']))
    expect(() => startPracticeSession()).not.toThrow()
    expect(setSessionPolishes([polish(1)], SCOPE_A)).toBe(false)   // 内部要读本场 id，读就抛 → 记日志返回 false
    expect(getSessionPolishes()).toEqual([])
    expect(resumeSessionPolishes(SCOPE_A)).toEqual([])
  })

  test('removeItem 抛异常：开场不抛，且绝不把上一场的句子当成本场的回填', () => {
    // 先在可用的存储里攒下 A 场的句子，再把 removeItem 打坏 —— 模拟「清不掉上一场」
    startPracticeSession()
    setSessionPolishes([polish(1)], SCOPE_A)
    const broken = makeStorage(['removeItem'])
    broken.setItem('lingobridge:practice_session_id', 'old-id')
    broken.setItem(SESSION_KEY, JSON.stringify({ sessionId: 'old-id', scope: SCOPE_A, items: [polish(1)] }))
    installStorage(broken)

    expect(() => startPracticeSession()).not.toThrow()
    // 清不掉旧句子时，宁可这一场不回填，也不能把上一场的句子串进来
    expect(resumeSessionPolishes(SCOPE_A)).toEqual([])
  })

  test('SSR（无 window）：读空、写 false、开场空串，不抛', () => {
    const g = globalThis as unknown as Record<string, unknown>
    delete g.window
    delete g.sessionStorage
    expect(startPracticeSession()).toBe('')
    expect(setSessionPolishes([polish(1)], SCOPE_A)).toBe(false)
    expect(getSessionPolishes()).toEqual([])
    expect(resumeSessionPolishes(SCOPE_A)).toEqual([])
    expect(() => clearSessionPolishes()).not.toThrow()
  })
})

describe('清场（反馈页处理完所有卡片）：只清句子，且不改「刷新反馈页仍看得到卡片」以外的行为', () => {
  test('clearSessionPolishes 后反馈页读到空', () => {
    startPracticeSession()
    setSessionPolishes([polish(1)], SCOPE_A)
    expect(getSessionPolishes()).toHaveLength(1)
    clearSessionPolishes()
    expect(getSessionPolishes()).toEqual([])
  })
})
