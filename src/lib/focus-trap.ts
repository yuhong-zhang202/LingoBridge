/**
 * @module   focus-trap
 * @desc     模态弹窗的 Tab 焦点陷阱，两件东西：
 *           ① {@link FOCUSABLE_SELECTOR} —— 「谁算可聚焦」的唯一选择器（五个弹窗共用，2026-08-08 收编）；
 *           ② {@link resolveTabFocus}   —— 「这一下 Tab / Shift+Tab 该把焦点送到哪」的判定。
 *           两者收编进度不同：选择器六处焦点陷阱已全部接上；判定目前只有 FirstUseConsent 接（原因见下）。
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
 * 焦点陷阱里「谁算可聚焦」的唯一选择器。做焦点陷阱的组件一律用它，不许各自手写字符串。
 *
 * 为什么收编（2026-08-08）：这句选择器此前在**六处**焦点陷阱里各手写一份，普查发现**飘了三份** ——
 * SwapCorpusDialog / QuotaReached / AnkiRegisterGate 都漏了 `:not([disabled])`。
 * 漏掉它不是「多算一个元素」这种轻伤：`focus()` 对 disabled 元素是**空操作**，灰掉的按钮一旦被算成
 * first / last，Tab 走到边界时焦点原地不动、甚至就留在 <body> 上。而按钮变灰恰恰发生在
 * 「用户点了提交、正在等结果」那几秒 —— 焦点陷阱在最需要它的时候失效。
 * 实测可达：SwapCorpusDialog 换语料进行中，面板里两颗按钮同时 disabled。
 *
 * 【分句的书写顺序不影响结果】querySelectorAll 按**文档顺序**返回，与选择器列表里各分句谁写在前无关
 * （DOM 标准 §4.2.6：match a selector against a tree 的结果按 tree order）。所以把原先 FirstUseConsent
 * 的 `a[href]` 打头统一成 `button` 打头，不改变任何一处的 first / last。已用真 DOM 引擎（jsdom/nwsapi）对拍确认。
 *
 * 【刻意没加的加固】不再排除 `[aria-hidden="true"]` / `[inert]` / 隐藏元素，理由：
 * ① inert 与 aria-hidden 都是**整棵子树**生效，而属性选择器只能命中挂着该属性的那一个元素本身，
 *    最常见的「inert 容器 + 内部按钮」根本盖不住 —— 半吊子的排除比不排除更危险，因为它看起来像已经处理了；
 * ② display:none / visibility:hidden 压根不是选择器能表达的（focus() 对它们同样是空操作），
 *    要治得在运行时按可见性过滤（参考 lib/focus-handoff.ts 的 isRendered），那是另一件独立的事；
 * ③ 六处陷阱里一个 aria-hidden / inert / display:none 的可聚焦元素都没有（2026-08-08 普查），加了买不到东西。
 *    注意 AvatarModal 那个 `sr-only` 的 file input 不属此列：sr-only 是 clip 隐藏、**仍然可聚焦**，
 *    读屏用户正是靠它上传头像，进候选集是对的。
 * disabled 之所以是例外：它是挂在元素自己身上的原生属性，选择器能精确表达，且是这几处陷阱真会进入的状态。
 *
 * 【覆盖范围】含 input / select / textarea：ProfileModal 用 children 承载 NameModal / PasswordModal /
 * ExamGoalModal / AvatarModal 的输入框，漏掉它们等于键盘用户 Tab 不到自己正在填的那个框。
 * 已知边界：`input:not([disabled])` 会连 `<input type="hidden">` 一起选中（focus() 对它同样是空操作），
 * 全库现无此写法（2026-08-08 普查）；哪天有了，这里要补 `:not([type="hidden"])`。
 *
 * 【用它的人还要管一件事】收紧后「候选集为空」从不可能变成了可能（全部按钮 disabled 时）。
 * 空集必须**拦截但不移动焦点**（见 {@link resolveTabFocus} 的 `block`），绝不能放行 —— 放行等于
 * 把焦点送进被遮罩盖住的背景。
 */
export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
  /** 陷阱容器内按文档顺序排列的可聚焦元素（谁算「可聚焦」由 {@link FOCUSABLE_SELECTOR} 统一决定） */
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
