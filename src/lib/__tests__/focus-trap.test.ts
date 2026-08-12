/**
 * @module   focus-trap.test
 * @desc     模态弹窗 Tab 焦点陷阱判定的单测（2026-08-08 FirstUseConsent 焦点逃逸修复配套）。
 *
 *           这一组是【行为】测试：真跑 resolveTabFocus、断言它给出的处置（拦不拦、把焦点送给谁）。
 *           判定抽成不碰 document 的纯函数，正是为了能在本仓库这个没有 DOM 的 jest
 *           （testEnvironment: 'node'）里测到 —— 留在组件里就只能读源码守「这段代码还在」，
 *           守不住「它把焦点判到背景里去了」。
 *
 *           2026-08-08 追加两组，针对「三处陷阱的选择器漏了 :not([disabled])」这条缺陷：
 *           ① 【行为】FOCUSABLE_SELECTOR 选出来的候选里不含 disabled 元素，接上 resolveTabFocus 后
 *              first / last 也不会落到灰掉的按钮上；
 *           ② 【结构】防复发规则守卫 —— 做焦点陷阱的组件一律用共用常量，不许手写选择器字符串。
 *
 *           边界（诚实标注）：本文件一条断言也没有真的按下过 Tab 键、也没有真的移动过焦点。
 *           验的是「给定焦点位置，判定函数指向哪」，不是「浏览器真按 Shift+Tab 后焦点果然回到弹窗」。
 *           后者只有真机 + 真读屏验得了，见交付说明。
 *           选择器那一组同理：本仓库无 jsdom（且禁止新增依赖），用的是本文件自带的迷你选择器求值器，
 *           不是浏览器的 CSS 引擎 —— 它只保证「这串选择器按 CSS 语义该选中谁」，不保证 Safari 真这么选。
 *           该求值器已在 scratchpad 里与 jsdom/nwsapi 对拍过三种选择器、结果逐字一致（不进仓库依赖）。
 * @author   LingoBridge
 * @created  2026-08-08
 */
import fs from 'fs'
import path from 'path'
import { FOCUSABLE_SELECTOR, resolveTabFocus } from '@/lib/focus-trap'

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

// ════════════════════════════════════════════════════════════════════════════
// FOCUSABLE_SELECTOR —— 「谁算可聚焦」（2026-08-08 三处陷阱漏 :not([disabled]) 的配套）
// ════════════════════════════════════════════════════════════════════════════

/** 测试替身：一个 DOM 元素，只保留选择器判定用得上的三样 —— 它是谁、什么标签、挂了哪些属性 */
interface FakeDomEl {
  /** 便于断言时人眼辨认 */
  id: string
  /** 标签名，小写 */
  tag: string
  /** 属性表：键存在即「有这个属性」，值为属性值（无值属性如 disabled 用空串） */
  attrs: Record<string, string>
}

/** 选择器列表里一个逗号分句解析后的形态 */
interface ParsedClause {
  /** 标签名限制；`[tabindex]:not(...)` 这种不限标签时为 null */
  tag: string | null
  /** 该分句上挂的属性条件 */
  tests: { name: string; value: string | null; negated: boolean }[]
}

/**
 * 解析一串 CSS 选择器列表（只支持本项目真正用到的语法）
 * @param selector 形如 `button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])`
 * @returns        分句数组
 * @sideEffect     遇到看不懂的语法直接抛错 —— 宁可让测试炸掉，也不能默默判过。
 *
 * 为什么要自己写：本仓库 jest 跑在 node、没有 DOM，也不许为测试新增 jsdom 依赖。没有求值器就只能
 * 断言「常量字符串等于某个字面量」，那种断言把 bug 和它的修正一起焊死 —— 选择器写错了照样绿。
 * 覆盖面刻意做窄：只认「可选标签名 + 若干 [属性] / :not([属性])」。将来常量用上更复杂的语法（组合子、
 * 伪类、:is 等），这里会抛错而不是漏判，那时再决定是扩求值器还是改用真 DOM。
 */
function parseSelectorList(selector: string): ParsedClause[] {
  return selector.split(',').map((raw) => {
    const clause = raw.trim()
    const tag = /^[a-zA-Z][\w-]*/.exec(clause)?.[0] ?? null
    let rest = clause.slice(tag === null ? 0 : tag.length)
    const tests: ParsedClause['tests'] = []
    while (rest.length > 0) {
      const m = /^(?::not\(\[([^\]]+)\]\)|\[([^\]]+)\])/.exec(rest)
      if (m === null) {
        throw new Error(`迷你选择器求值器看不懂的片段：${JSON.stringify(rest)}（出自分句 ${JSON.stringify(clause)}）`)
      }
      const negated = m[1] !== undefined
      const body = m[1] ?? m[2]
      const eq = body.indexOf('=')
      tests.push({
        name: eq === -1 ? body : body.slice(0, eq),
        value: eq === -1 ? null : body.slice(eq + 1).replace(/^["']|["']$/g, ''),
        negated,
      })
      rest = rest.slice(m[0].length)
    }
    return { tag, tests }
  })
}

/**
 * 判断一个假元素是否命中某个分句
 * @param clause 已解析的分句
 * @param el     假元素
 * @returns      命中为 true
 */
function matchesClause(clause: ParsedClause, el: FakeDomEl): boolean {
  if (clause.tag !== null && clause.tag.toLowerCase() !== el.tag.toLowerCase()) return false
  return clause.tests.every((t) => {
    const present = Object.prototype.hasOwnProperty.call(el.attrs, t.name)
    const hit = t.value === null ? present : present && el.attrs[t.name] === t.value
    return t.negated ? !hit : hit
  })
}

/**
 * 模拟 `root.querySelectorAll(selector)`
 * @param selector 选择器列表
 * @param els      容器内的元素，**按文档顺序**排列
 * @returns        命中任一分句的元素，仍按文档顺序
 * @sideEffect     无。
 *
 * 结果按入参顺序（＝文档顺序）返回、与分句书写顺序无关，这正是 querySelectorAll 的规定行为
 * （DOM 标准 §4.2.6 结果按 tree order），也是「统一分句顺序不会改变 first/last」这个论断的依据。
 */
function queryAll(selector: string, els: readonly FakeDomEl[]): FakeDomEl[] {
  const clauses = parseSelectorList(selector)
  return els.filter((el) => clauses.some((c) => matchesClause(c, el)))
}

/** 一个弹窗面板内的元素夹具，按文档顺序；覆盖「正常按钮 / 灰掉的按钮 / 链接 / 输入框 / 面板自己」 */
const PANEL: FakeDomEl[] = [
  { id: '说明链接',        tag: 'a',        attrs: { href: '/privacy' } },
  { id: '主CTA',           tag: 'button',   attrs: {} },
  { id: '提交中的按钮',    tag: 'button',   attrs: { disabled: '' } },
  { id: '昵称输入框',      tag: 'input',    attrs: {} },
  { id: '灰掉的输入框',    tag: 'input',    attrs: { disabled: '' } },
  { id: '自定义可聚焦项',  tag: 'span',     attrs: { tabindex: '0' } },
  { id: '面板本身',        tag: 'div',      attrs: { tabindex: '-1' } },
  { id: '锚点无href',      tag: 'a',        attrs: {} },
  { id: '末尾的取消按钮',  tag: 'button',   attrs: { disabled: '' } },
]
const ids = (els: readonly FakeDomEl[]): string[] => els.map((e) => e.id)

/** 本次修复前三处陷阱手写的那一份（漏 :not([disabled])），只在测试里留作对照 */
const BUGGY_SELECTOR_BEFORE_FIX = 'button, a[href], [tabindex]:not([tabindex="-1"])'
/** FirstUseConsent 修复前的书写顺序（分句集合与共用常量的 button/a/tabindex 三句一致，只是 a 打头） */
const CONSENT_ORDER_BEFORE_FIX = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

describe('FOCUSABLE_SELECTOR【行为】disabled 元素不得进候选集', () => {
  // 【行为】的含义：真的把常量字符串跑过一遍求值器、断言它选出谁 —— 不是比对字符串字面量。
  // 边界：求值器是本文件手写的（无 jsdom），只保证 CSS 语义，不保证浏览器真这么选。
  it('求值器解析常量时不抛错（语法超出求值器覆盖面时要炸，不许默默判过）', () => {
    expect(() => parseSelectorList(FOCUSABLE_SELECTOR)).not.toThrow()
  })

  it('选出的候选按文档顺序，且三个 disabled 元素一个都不在里面', () => {
    const got = queryAll(FOCUSABLE_SELECTOR, PANEL)
    expect(ids(got)).toEqual(['说明链接', '主CTA', '昵称输入框', '自定义可聚焦项'])
    expect(ids(got)).not.toContain('提交中的按钮')
    expect(ids(got)).not.toContain('灰掉的输入框')
    expect(ids(got)).not.toContain('末尾的取消按钮')
  })

  it('面板自己（tabindex="-1"）与无 href 的 <a> 也不在候选里', () => {
    const got = ids(queryAll(FOCUSABLE_SELECTOR, PANEL))
    expect(got).not.toContain('面板本身')
    expect(got).not.toContain('锚点无href')
  })

  it('输入框在候选里 —— ProfileModal 用 children 承载改昵称 / 改密码的输入框，漏掉就 Tab 不到自己正在填的框', () => {
    expect(ids(queryAll(FOCUSABLE_SELECTOR, PANEL))).toContain('昵称输入框')
  })
})

describe('FOCUSABLE_SELECTOR【行为】接上 resolveTabFocus：first / last 不会落到灰掉的按钮上', () => {
  // 这一组把两层串起来，正是本次缺陷的形状：选择器把 disabled 按钮算进 last → Tab 到边界时
  // 判定函数忠实地把焦点送给它 → 而 focus() 对 disabled 元素是空操作 → 焦点原地不动或掉回 <body>。
  const root: FakeDomEl = { id: '面板本身', tag: 'div', attrs: { tabindex: '-1' } }
  const focusables = queryAll(FOCUSABLE_SELECTOR, PANEL)

  /** 按组件里的调法组装入参 */
  const decideWith = (list: readonly FakeDomEl[], active: FakeDomEl | null, shiftKey: boolean) =>
    resolveTabFocus<FakeDomEl>({
      focusables: list,
      root,
      active,
      activeInsideRoot: active !== null && (active === root || list.includes(active)),
      shiftKey,
    })

  it('刚打开就按 Shift+Tab → 焦点送到「自定义可聚焦项」，而不是灰掉的「末尾的取消按钮」', () => {
    const d = decideWith(focusables, root, true)
    expect(d).toEqual({ kind: 'move', target: focusables[focusables.length - 1] })
    expect(d.kind === 'move' && d.target.id).toBe('自定义可聚焦项')
  })

  it('正向 Tab 到末尾时回环到「说明链接」，且首项不是任何 disabled 元素', () => {
    const last = focusables[focusables.length - 1]
    const d = decideWith(focusables, last, false)
    expect(d.kind === 'move' && d.target.id).toBe('说明链接')
  })

  it('全部按钮都 disabled 时候选集为空 → block（拦住但不动焦点），绝不放行到背景', () => {
    // SwapCorpusDialog 换语料进行中就是这个状态：主 CTA loading→disabled、「保留当前」disabled。
    const allDisabled: FakeDomEl[] = [
      { id: '换语料中', tag: 'button', attrs: { disabled: '' } },
      { id: '保留当前', tag: 'button', attrs: { disabled: '' } },
    ]
    const list = queryAll(FOCUSABLE_SELECTOR, allDisabled)
    expect(list).toEqual([])
    expect(decideWith(list, root, true)).toEqual({ kind: 'block' })
    expect(decideWith(list, root, false)).toEqual({ kind: 'block' })
  })
})

describe('FOCUSABLE_SELECTOR【行为】与修复前的两份手写选择器对照', () => {
  // 这一组是本文件的「自带变异验证」：证明上面那些断言真的抓得住这个 bug，而不是碰巧全绿。
  it('修复前那份（漏 :not([disabled])）会把灰掉的按钮算成 last —— 焦点送过去等于什么都没发生', () => {
    const buggy = queryAll(BUGGY_SELECTOR_BEFORE_FIX, PANEL)
    expect(buggy[buggy.length - 1].id).toBe('末尾的取消按钮')
    expect(buggy[buggy.length - 1].attrs).toHaveProperty('disabled')
    // 修好之后 last 换了人 —— 两份选择器给出的结论确实不同，断言不是空转
    const fixed = queryAll(FOCUSABLE_SELECTOR, PANEL)
    expect(fixed[fixed.length - 1].id).not.toBe(buggy[buggy.length - 1].id)
  })

  it('分句书写顺序不影响结果：FirstUseConsent 原来的 a 打头写法与共用常量选出的顺序一致', () => {
    // 只比 button / a[href] / [tabindex] 三句共有的部分，故夹具里排除 input（老写法本来就不含）
    const noInputs = PANEL.filter((e) => e.tag !== 'input')
    expect(ids(queryAll(CONSENT_ORDER_BEFORE_FIX, noInputs))).toEqual(ids(queryAll(FOCUSABLE_SELECTOR, noInputs)))
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 防复发规则守卫：做焦点陷阱的组件必须用共用常量，不许手写选择器
// ════════════════════════════════════════════════════════════════════════════

/** 扫描根目录：本文件在 src/lib/__tests__/ 下，上两级即 src/ */
const SRC_DIR = path.resolve(__dirname, '../..')

/** 共用常量自己的家。它当然要写字面量，是唯一豁免。 */
const SELECTOR_HOME = 'lib/focus-trap.ts'

/** 一处违规 */
interface SelectorViolation {
  /** 相对 src/ 的路径 */
  file: string
  /** 1 起算的行号 */
  line: number
  /** 违规种类 */
  kind: '手写了可聚焦选择器字面量' | '没有引入 FOCUSABLE_SELECTOR'
}

/** 一次全站扫描的产出（含自检计数，防止扫描器空转还判绿） */
interface SelectorScan {
  /** 实际读取的源码文件数 */
  fileCount: number
  /** 认定为「焦点陷阱」的候选文件（相对 src/ 路径） */
  trapFiles: string[]
  /** 违规清单 */
  violations: SelectorViolation[]
}

/**
 * 把源码里的注释抹成等长空格（保留换行）
 * @param src 原始源码
 * @returns   同长度副本，注释内容变空格
 * @sideEffect 无。刻意保持长度不变，这样算出来的行号跟原文件对得上。
 *
 * 必须抹：lib/focus-trap.ts 的顶注里就白纸黑字写着 `a[href]` 和 `[tabindex]` 用于解释设计取舍，
 * 不抹的话它自己会被判成「手写选择器」。已知边界：字符串字面量里裸写 '//' 会被当注释（只会漏判、不会误报）。
 */
function blankComments(src: string): string {
  const chars = src.split('')
  let i = 0
  while (i < chars.length) {
    const two = src.slice(i, i + 2)
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? chars.length : end + 2
      for (let k = i; k < stop; k++) if (chars[k] !== '\n') chars[k] = ' '
      i = stop
      continue
    }
    if (two === '//' && src[i - 1] !== ':') {
      let stop = src.indexOf('\n', i)
      if (stop === -1) stop = chars.length
      for (let k = i; k < stop; k++) chars[k] = ' '
      i = stop
      continue
    }
    i += 1
  }
  return chars.join('')
}

/**
 * 递归收集 src 下的 .ts / .tsx（跳过 __tests__ 与 node_modules）
 * @param dir 起始目录（绝对路径）
 * @returns   绝对路径数组
 */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      out.push(...collectSourceFiles(full))
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

/**
 * 把字符下标换算成 1 起算的行号
 * @param src    源码
 * @param offset 字符下标
 * @returns      行号
 */
function lineOf(src: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === '\n') line += 1
  return line
}

/**
 * 全站扫描：做焦点陷阱的文件有没有偷偷手写可聚焦选择器
 * @returns 扫描结果（含候选清单与违规清单）
 *
 * 「做焦点陷阱」的识别口径：源码里出现 Tab 键判定（`!== 'Tab'` / `=== 'Tab'`）。六处陷阱全都有，
 * 而普通的 Tab 型 UI 组件（文件名带 Tab 的那些）不会写这个键名判定，不会被误抓。
 * 口径宁可窄一点：漏抓一个新陷阱只是守不到，误抓一个无关文件会逼人改无辜代码。
 */
function scanFocusTrapSelectors(): SelectorScan {
  const files = collectSourceFiles(SRC_DIR)
  const trapFiles: string[] = []
  const violations: SelectorViolation[] = []

  for (const abs of files) {
    const rel = path.relative(SRC_DIR, abs)
    if (rel === SELECTOR_HOME) continue
    const src = blankComments(fs.readFileSync(abs, 'utf8'))
    if (!/(?:!==|===)\s*['"]Tab['"]/.test(src)) continue
    trapFiles.push(rel)

    // 手写选择器的特征：字符串里出现 a[href] / [tabindex] / button:not( 任一
    for (const m of src.matchAll(/a\[href\]|\[tabindex\]|button:not\(/g)) {
      violations.push({ file: rel, line: lineOf(src, m.index), kind: '手写了可聚焦选择器字面量' })
    }
    // 光不手写还不够 —— 得真的把共用常量用起来（宽松匹配 import 写法，别让守卫依赖某种排版）
    if (!/import\s*\{[^}]*\bFOCUSABLE_SELECTOR\b[^}]*\}\s*from\s*['"]@\/lib\/focus-trap['"]/.test(src)) {
      violations.push({ file: rel, line: 1, kind: '没有引入 FOCUSABLE_SELECTOR' })
    }
  }

  return { fileCount: files.length, trapFiles: trapFiles.sort(), violations }
}

const selectorScan = scanFocusTrapSelectors()

describe('规则守卫【结构】做焦点陷阱的组件必须用 FOCUSABLE_SELECTOR，不许手写', () => {
  it('扫描确实覆盖到了源码，且认出的焦点陷阱不少于已知的 6 处（防止路径写错导致本守卫永远绿）', () => {
    // eslint-disable-next-line no-console -- 这行摘要是本守卫的体检报告，跑测试时要能一眼看到覆盖面
    console.log(
      `[焦点陷阱守卫] 扫描 ${selectorScan.fileCount} 个 .ts/.tsx，认出 ${selectorScan.trapFiles.length} 处焦点陷阱：\n  ` +
      selectorScan.trapFiles.join('\n  '),
    )
    expect(selectorScan.fileCount).toBeGreaterThan(50)
    // 2026-08-08 实际 6 处：ConfirmDialog / FirstUseConsent / QuotaReached / SwapCorpusDialog /
    // AnkiRegisterGate / ProfileModal。将来只增不减；真要下调先确认不是扫描器坏了。
    expect(selectorScan.trapFiles.length).toBeGreaterThanOrEqual(6)
  })

  it('没有任何一处焦点陷阱手写选择器或漏用共用常量', () => {
    const detail = selectorScan.violations
      .map((v) => `  src/${v.file}:${v.line}  ${v.kind}`)
      .join('\n')
    expect(
      selectorScan.violations.length === 0
        ? ''
        : '以下焦点陷阱没有使用共用的可聚焦元素选择器：\n' + detail +
          "\n\n修法：`import { FOCUSABLE_SELECTOR } from '@/lib/focus-trap'`，" +
          '把手写的那串选择器字面量换成 FOCUSABLE_SELECTOR。' +
          '\n为什么不许手写：同一句选择器手抄六份，2026-08-08 普查时已经飘了三份 —— ' +
          'SwapCorpusDialog / QuotaReached / AnkiRegisterGate 都漏了 `:not([disabled])`。' +
          '漏掉它的后果是：灰掉的按钮仍被算成 first / last，而 focus() 对 disabled 元素是空操作，' +
          '于是焦点原地不动、甚至掉回 <body> —— 偏偏发生在「用户点了提交正在等结果」那几秒，' +
          '焦点陷阱在最需要它的时候失效。tsc / eslint / build / 其余单测全都抓不到。',
    ).toBe('')
  })
})
