/**
 * @module   flow-shape.test
 * @desc     步骤条形态标识与序列派生的守卫 —— 钉死产品方拍板的那张派生表，
 *           以及两条「不做就一定 ship 成 bug」的降级边界：
 *             · 读不到标识 → 全量 5 步（与改动前逐点一致）；
 *             · 序列里没有当前步 → 全量 5 步。少了这条，STEPS.findIndex 返回 -1 →
 *               桌面步骤名空白、所有点显示「未到达」，移动端整条变灰。
 *               最典型的真实路径：文字路径整理失败回落 /restructure（形态是 text，人却站在「整理」这一步）。
 *
 *   jest 默认 node 环境无 window/sessionStorage，沿用 session-polishes.test.ts 的垫片写法。
 * @author   LingoBridge
 * @created  2026-08-27
 */
import {
  STEPS, deriveSteps, setFlowShape, readFlowShape, clearFlowShape,
  type FlowShape, type StepKey,
} from '@/lib/flow-shape'

/** 形态标识在 sessionStorage 里的键（与 flow-shape.ts 私有常量同值：脏数据那条要能直接写进去） */
const KEY = 'lingobridge:flow_shape'

/** 可控的 storage 垫片：throwOn 里的方法会抛错，用来模拟无痕模式 / 配额耗尽 */
function makeStorage(throwOn: ReadonlyArray<'getItem' | 'setItem' | 'removeItem'> = []): Storage {
  const map = new Map<string, string>()
  const boom = (name: string): never => { throw new Error(`模拟存储不可用：${name}`) }
  return {
    getItem: (k: string) => (throwOn.includes('getItem') ? boom('getItem') : map.get(k) ?? null),
    setItem: (k: string, v: string) => (throwOn.includes('setItem') ? boom('setItem') : void map.set(k, v)),
    removeItem: (k: string) => (throwOn.includes('removeItem') ? boom('removeItem') : void map.delete(k)),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size },
  } as Storage
}

function installStorage(store: Storage): void {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { sessionStorage: store }
  g.sessionStorage = store
}

beforeEach(() => installStorage(makeStorage()))
afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>
  delete g.window
  delete g.sessionStorage
})

/** 取标签序列，断言更可读 */
function labels(shape: FlowShape | null, current: StepKey): string[] {
  return deriveSteps(shape, current).map((s) => s.label)
}

describe('deriveSteps · 产品方拍板的派生表（四种组合）', () => {
  it('voice × story：故事 → 整理 → 题目 → 分析 → 练习（5 点）', () => {
    expect(labels({ mode: 'voice', flow: 'story' }, 'matching')).toEqual(['故事', '整理', '题目', '分析', '练习'])
  })
  it('text × story：故事 → 题目 → 分析 → 练习（4 点，无「整理」）', () => {
    expect(labels({ mode: 'text', flow: 'story' }, 'matching')).toEqual(['故事', '题目', '分析', '练习'])
  })
  it('voice × ielts：故事 → 整理 → 分析 → 练习（4 点，无「题目」）', () => {
    expect(labels({ mode: 'voice', flow: 'ielts' }, 'analysis')).toEqual(['故事', '整理', '分析', '练习'])
  })
  it('text × ielts：故事 → 分析 → 练习（3 点）', () => {
    expect(labels({ mode: 'text', flow: 'ielts' }, 'analysis')).toEqual(['故事', '分析', '练习'])
  })

  it('雅思流不再把「题目」显示成已完成 —— 序列里根本没有它（今天就有的 bug 顺带修掉）', () => {
    for (const mode of ['voice', 'text'] as const) {
      expect(deriveSteps({ mode, flow: 'ielts' }, 'analysis').map((s) => s.key)).not.toContain('matching')
    }
  })

  it('派生只是筛选、绝不改顺序：任一形态的序列都是全量 5 步的子序列', () => {
    const order = STEPS.map((s) => s.key)
    for (const mode of ['voice', 'text'] as const) {
      for (const flow of ['story', 'ielts'] as const) {
        const keys = deriveSteps({ mode, flow }, 'story').map((s) => s.key)
        expect(keys).toEqual(order.filter((k) => keys.includes(k)))
      }
    }
  })
})

describe('deriveSteps · 安全降级（不做就一定 ship 成 bug）', () => {
  it('读不到标识 → 全量 5 步，且每一页的当前步都能定位到（findIndex 不为 -1）', () => {
    const all: StepKey[] = ['story', 'restructure', 'matching', 'analysis', 'practice']
    for (const step of all) {
      const steps = deriveSteps(null, step)
      expect(steps).toHaveLength(5)
      expect(steps.findIndex((s) => s.key === step)).toBeGreaterThanOrEqual(0)
    }
  })

  it('当前步不在序列里 → 退回全量 5 步（文字路径回落 /restructure 这条真实路径）', () => {
    expect(labels({ mode: 'text', flow: 'story' }, 'restructure')).toEqual(['故事', '整理', '题目', '分析', '练习'])
    expect(labels({ mode: 'text', flow: 'ielts' }, 'restructure')).toEqual(['故事', '整理', '题目', '分析', '练习'])
  })

  it('穷举「任意形态 × 任意页面」：当前步一律能被定位到，绝不出现 -1', () => {
    const all: StepKey[] = ['story', 'restructure', 'matching', 'analysis', 'practice']
    for (const mode of ['voice', 'text'] as const) {
      for (const flow of ['story', 'ielts'] as const) {
        for (const step of all) {
          const steps = deriveSteps({ mode, flow }, step)
          expect(steps.findIndex((s) => s.key === step)).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})

describe('形态标识的读写', () => {
  it('写完能原样读回', () => {
    setFlowShape({ mode: 'text', flow: 'ielts' })
    expect(readFlowShape()).toEqual({ mode: 'text', flow: 'ielts' })
  })

  it('clearFlowShape 之后读到 null → 消费方降级回 5 步（兜底回整理页那条窄路要的正是这个）', () => {
    setFlowShape({ mode: 'text', flow: 'story' })
    clearFlowShape()
    expect(readFlowShape()).toBeNull()
    expect(deriveSteps(readFlowShape(), 'restructure')).toHaveLength(5)
  })

  it('脏数据 / 非法枚举 / 非 JSON 一律读成 null，绝不抛', () => {
    for (const dirty of ['{"mode":"typing","flow":"story"}', '{"mode":"text"}', 'not-json', '[]']) {
      sessionStorage.setItem(KEY, dirty)
      expect(readFlowShape()).toBeNull()
    }
  })

  it('存储不可用（无痕模式）：写不报错、读回 null，退化成 5 步而不是崩页', () => {
    installStorage(makeStorage(['setItem', 'getItem', 'removeItem']))
    expect(() => setFlowShape({ mode: 'text', flow: 'story' })).not.toThrow()
    expect(() => clearFlowShape()).not.toThrow()
    expect(readFlowShape()).toBeNull()
  })

  it('SSR（无 window）：读写都不抛，读到 null', () => {
    const g = globalThis as unknown as Record<string, unknown>
    delete g.window
    delete g.sessionStorage
    expect(() => setFlowShape({ mode: 'voice', flow: 'story' })).not.toThrow()
    expect(readFlowShape()).toBeNull()
  })
})
