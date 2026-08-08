/**
 * @module   focus-trap
 * @desc     模态弹窗的 Tab 焦点陷阱 —— 算出「这一下 Tab / Shift+Tab 该把焦点送到哪」。
 *
 *           为什么需要：模态弹窗打开时背景被遮罩盖住、不可交互。焦点一旦逸出到遮罩后面，用键盘
 *           或读屏的人就在「看不见也点不到」的东西上转圈 —— 硬闸场景（首次使用的隐私同意）里更狠，
 *           那等于卡死在门口连产品都进不去，只能关掉重开。
 *
 *           单独抽成不碰 document 的纯函数，有两个原因：
 *           ① 本仓库 jest 跑在 node 环境、没有 DOM，判定逻辑留在组件里就只能靠读源码守「这段代码还在」，
 *              守不住「它判错了方向」；抽出来那一层才测得到行为。
 *           ② 这套判定此前是三个弹窗各抄一份手写的，同一个洞已经漏过两次（ConfirmDialog 43a798d、
 *              SwapCorpusDialog 60ff06f，都是反向分支只判 `active === first`、漏掉「焦点在面板本身」）。
 *              收敛到一处，下次补漏只补一处。
 *
 *           【当前只有 FirstUseConsent 接了它】ConfirmDialog / SwapCorpusDialog 仍是各自手写那一份，
 *           虽已修好、不暴露该洞，但没有收编进来。原因不是漏了：
 *           src/__tests__/a11y-destructive-actions.test.tsx 的 C2②/C5 是结构守卫，用正则逐字 grep 那两个
 *           组件里的 `e.preventDefault(); last.focus()` / `active === root`。改成调用本函数，那些字面写法
 *           消失、守卫立刻变红（实测红 3 条），而唯一让它变绿的办法是去改守卫本身 —— 实施者改守卫让自己
 *           的改动通过，是不能碰的红线。收编要连同守卫一起升级（守「import 了 resolveTabFocus 并调用」，
 *           判定行为交给 lib/__tests__/focus-trap.test.ts 守），那是另一次独立改动，须与守卫的作者协调。
 * @author   LingoBridge
 * @created  2026-08-08
 */

/**
 * 一次 Tab 按键的处置结论。
 * - `pass`  不拦截，交给浏览器默认的 Tab 行为（焦点还在陷阱中段，默认行为本来就是对的）
 * - `block` 拦截但不移动焦点：容器里一个可聚焦元素都没有，放行等于把焦点送出容器，宁可原地不动
 * - `move`  拦截并把焦点移到 target
 */
export type TabFocusDecision<T> =
  | { kind: 'pass' }
  | { kind: 'block' }
  | { kind: 'move'; target: T }

/** {@link resolveTabFocus} 的入参 */
export interface TabFocusInput<T> {
  /** 陷阱容器内按文档顺序排列的可聚焦元素（由调用方各自的 selector 决定谁算「可聚焦」） */
  focusables: readonly T[]
  /** 陷阱容器本身。弹窗打开时焦点常常就落在它身上（面板 tabIndex=-1 + 程序化 focus） */
  root: T
  /** 当前焦点所在元素；焦点丢失（如 document.activeElement 已不是元素）时传 null */
  active: T | null
  /** 当前焦点是否位于容器子树内。约定与 `root.contains(active)` 一致：焦点就是 root 自己时也算 true */
  activeInsideRoot: boolean
  /** 是否按住了 Shift（反向 Tab） */
  shiftKey: boolean
}

/**
 * 判定一次 Tab / Shift+Tab 该如何处置焦点
 * @param input 见 {@link TabFocusInput}
 * @returns     处置结论；调用方按 kind 决定要不要 preventDefault、要不要 focus(target)
 *
 * 三类要拦的位置，正反向对称：
 * ① 焦点在边界元素上（反向时的首个 / 正向时的最后一个）—— 经典的两端环绕；
 * ② 焦点在【容器本身】上 —— 弹窗刚打开就是这个状态。`root.contains(root)` 为真、又不等于首个元素，
 *    只判 `active === first` 的写法会在这里放行，一按 Shift+Tab 焦点就退到遮罩后面的背景里回不来；
 * ③ 焦点已经在容器外 —— 兜底：无论怎么跑出去的，下一次 Tab 都把人拉回弹窗，而不是让他在背景里继续走。
 */
export function resolveTabFocus<T>(input: TabFocusInput<T>): TabFocusDecision<T> {
  const { focusables, root, active, activeInsideRoot, shiftKey } = input

  // 容器里没有可聚焦元素：没有任何落点可给，但也绝不能放行（放行 = 焦点走进被遮罩盖住的背景）
  if (focusables.length === 0) return { kind: 'block' }

  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const atRootOrOutside = active === root || !activeInsideRoot

  if (shiftKey) {
    if (active === first || atRootOrOutside) return { kind: 'move', target: last }
    return { kind: 'pass' }
  }
  if (active === last || atRootOrOutside) return { kind: 'move', target: first }
  return { kind: 'pass' }
}
