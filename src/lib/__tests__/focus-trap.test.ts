/**
 * @module   focus-trap.test
 * @desc     模态弹窗 Tab 焦点陷阱判定的单测（2026-08-08 FirstUseConsent 焦点逃逸修复配套）。
 *
 *           这一组是【行为】测试：真跑 resolveTabFocus、断言它给出的处置（拦不拦、把焦点送给谁）。
 *           判定抽成不碰 document 的纯函数，正是为了能在本仓库这个没有 DOM 的 jest
 *           （testEnvironment: 'node'）里测到 —— 留在组件里就只能读源码守「这段代码还在」，
 *           守不住「它把焦点判到背景里去了」。
 *
 *           边界（诚实标注）：本文件一条断言也没有真的按下过 Tab 键、也没有真的移动过焦点。
 *           验的是「给定焦点位置，判定函数指向哪」，不是「浏览器真按 Shift+Tab 后焦点果然回到弹窗」。
 *           后者只有真机 + 真读屏验得了，见交付说明。
 * @author   LingoBridge
 * @created  2026-08-08
 */
import fs from 'fs'
import path from 'path'
import { resolveTabFocus } from '@/lib/focus-trap'

/** 测试替身：一个可聚焦元素，只保留判定真正关心的东西 —— 它是谁 */
interface FakeEl { id: string }
const el = (id: string): FakeEl => ({ id })

/** 陷阱容器本身（弹窗面板，tabIndex=-1，打开时被程序化聚焦） */
const ROOT = el('面板本身')
/** 面板内某个中段元素（既不是首个也不是最后一个） */
const BACKGROUND = el('遮罩后面的背景元素')

/**
 * 按「组件里怎么调」的方式组装入参：activeInsideRoot 用与 root.contains(active) 相同的语义算出来
 * （焦点是 root 自己也算在内），避免每条用例手抄这个布尔时抄反。
 */
function decide(focusables: readonly FakeEl[], active: FakeEl | null, shiftKey: boolean) {
  const insideRoot = active !== null && (active === ROOT || focusables.includes(active))
  return resolveTabFocus<FakeEl>({ focusables, root: ROOT, active, activeInsideRoot: insideRoot, shiftKey })
}

const A = el('a')
const B = el('b')
const C = el('c')
const THREE = [A, B, C]

describe('resolveTabFocus【行为】焦点在面板本身 —— 本次修复的核心场景', () => {
  // 三个弹窗打开时聚焦的都是面板本身（而非首个按钮），此刻按 Shift+Tab，只判 `active === first`
  // 的老写法两支都不命中 → 放行 → 焦点退到遮罩后面的背景里再也回不来。
  // FirstUseConsent 是首次使用的隐私硬闸，背景完全不可交互，这一下等于把键盘用户锁在门口。
  it('刚打开就按 Shift+Tab → 拦下来，焦点送到最后一个可聚焦元素（不是放行到背景）', () => {
    expect(decide(THREE, ROOT, true)).toEqual({ kind: 'move', target: C })
  })

  it('刚打开就按 Tab（正向）→ 拦下来，焦点送到首个可聚焦元素', () => {
    expect(decide(THREE, ROOT, false)).toEqual({ kind: 'move', target: A })
  })
})

describe('resolveTabFocus【行为】两端环绕', () => {
  it('焦点在首个元素上按 Shift+Tab → 跳到最后一个', () => {
    expect(decide(THREE, A, true)).toEqual({ kind: 'move', target: C })
  })

  it('焦点在最后一个元素上按 Tab → 跳回首个', () => {
    expect(decide(THREE, C, false)).toEqual({ kind: 'move', target: A })
  })

  it('容器里只有一个可聚焦元素 → 正反向都停在它自己身上（不逸出）', () => {
    expect(decide([A], A, true)).toEqual({ kind: 'move', target: A })
    expect(decide([A], A, false)).toEqual({ kind: 'move', target: A })
  })
})

describe('resolveTabFocus【行为】陷阱中段不干预', () => {
  // 中段放行是必须的：全都拦下来会把 Tab 变成「永远在首尾之间跳」，中间的按钮和链接再也走不到。
  it('焦点在中间元素上按 Tab → 不拦截，交给浏览器默认行为', () => {
    expect(decide(THREE, B, false)).toEqual({ kind: 'pass' })
  })

  it('焦点在中间元素上按 Shift+Tab → 不拦截', () => {
    expect(decide(THREE, B, true)).toEqual({ kind: 'pass' })
  })
})

describe('resolveTabFocus【行为】焦点已经跑到容器外 —— 兜底拉回来', () => {
  it('焦点在背景元素上按 Tab → 拉回弹窗首个元素', () => {
    expect(decide(THREE, BACKGROUND, false)).toEqual({ kind: 'move', target: A })
  })

  it('焦点在背景元素上按 Shift+Tab → 拉回弹窗最后一个元素', () => {
    expect(decide(THREE, BACKGROUND, true)).toEqual({ kind: 'move', target: C })
  })

  it('焦点整个丢了（active 为 null，如掉回 body）→ 也拉回弹窗，不放任', () => {
    expect(decide(THREE, null, false)).toEqual({ kind: 'move', target: A })
    expect(decide(THREE, null, true)).toEqual({ kind: 'move', target: C })
  })
})

describe('resolveTabFocus【行为】容器里没有可聚焦元素', () => {
  // 不崩，且不能放行 —— 放行等于把焦点送进被遮罩盖住的背景。没有落点可给就原地不动。
  it('空列表 → block（拦截但不移动焦点），正反向一致', () => {
    expect(decide([], ROOT, true)).toEqual({ kind: 'block' })
    expect(decide([], ROOT, false)).toEqual({ kind: 'block' })
    expect(decide([], null, true)).toEqual({ kind: 'block' })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 判定函数再对，组件不接也白搭 —— 这一组守「FirstUseConsent 真的接上了」
// ────────────────────────────────────────────────────────────────────────────

describe('FirstUseConsent【结构】隐私硬闸的焦点陷阱确实走本判定函数', () => {
  // 明确标注是【结构】：读源码文本、断言关键代码路径存在，防的是「有人把它改回各自手写」。
  // 防不住「这段代码在真浏览器里其实没生效」—— 那只能真机 + 真读屏验，见交付说明。
  // 之所以只在这里守 FirstUseConsent 一个：ConfirmDialog / SwapCorpusDialog 的同类守卫在
  // src/__tests__/a11y-destructive-actions.test.tsx（C2②/C5），归那份文件管，不在这里重复。
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../components/FirstUseConsent.tsx'),
    'utf8',
  )

  it('引入并调用了 resolveTabFocus', () => {
    expect(src).toMatch(/import \{ resolveTabFocus \} from '@\/lib\/focus-trap'/)
    expect(src).toMatch(/resolveTabFocus<HTMLElement>\(\{/)
  })

  it('把「焦点在面板本身 / 已在容器外」的信息真的传了进去（否则那两支判定永远走不到）', () => {
    expect(src).toMatch(/root,/)
    expect(src).toMatch(/activeInsideRoot: root\.contains\(active\)/)
  })

  it('拿到 move 结论时真的移动了焦点，拿到 pass 才放行', () => {
    expect(src).toMatch(/if \(decision\.kind === 'pass'\) return/)
    expect(src).toMatch(/e\.preventDefault\(\)/)
    expect(src).toMatch(/decision\.target\.focus\(\)/)
  })

  it('陷阱真挂在 DOM 上，且面板可被程序化聚焦（否则整条链路空转）', () => {
    expect(src).toMatch(/onKeyDown=\{handleKeyDown\}/)
    expect(src).toMatch(/tabIndex=\{-1\}/)
    expect(src).toMatch(/dialogRef\.current\?\.focus\(\)/)
  })

  it('不再残留「只判 activeElement === firstEl」的老写法（本次修的就是它）', () => {
    expect(src).not.toMatch(/document\.activeElement === firstEl/)
  })
})
