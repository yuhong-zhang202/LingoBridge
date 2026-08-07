/**
 * @module   gradient-button-type-rule.test
 * @desc     全站规则守卫（静态扫描源码，不渲染页面）：
 *           规则一 —— 凡是出现在 <form> 子树内的 <GradientButton>，必须显式传 type。
 *           规则二 —— GradientButton 不传 type 时的默认值必须仍是 'button'。
 *
 *           为什么要立这条规则（而不是再给某几个按钮加回归断言）：
 *           9609d78（2026-08-03）把共用组件 GradientButton 的默认 type 改成 'button'，没有普查调用方。
 *           全站三个 <form> 的提交按钮同时退化成普通按钮、onSubmit 永不触发，用户看到「点了保存没反应」，
 *           设备考目标 / 改昵称 / 改密码三个功能一起哑了 4 天，靠用户反馈才发现；期间 tsc / eslint / build /
 *           全部单测都是绿的（type 是可选 prop，不传在类型上完全合法，渲染产物也仍是一个长得一样的 <button>）。
 *           3c9f1ea 已修，728c0dd 补了 8 条回归断言——但那 8 条只盯现有的那三个按钮：明天有人在新页面写第四个
 *           <form> 并塞进一个忘了传 type 的 GradientButton，一条都不会红。本文件守的是那条通行规则本身。
 *
 *           规则二是规则一的镜像事故：默认值若被改回 'submit'，全站 form 外的几十处 CTA 会开始误提交。
 *           这一条用真实渲染断言（而不是正则读源码）——见 describe 内注释说明理由。
 *
 *           扫描器的已知边界写在文件末尾的「已知漏判 / 误报」注释里，改动本文件前请先读那段。
 * @author   LingoBridge
 * @created  2026-08-07
 */
import fs from 'fs'
import path from 'path'
import { renderToStaticMarkup } from 'react-dom/server'
import GradientButton from '@/components/GradientButton'

/** 扫描根目录：本文件在 src/__tests__/ 下，上一级即 src/ */
const SRC_DIR = path.resolve(__dirname, '..')

/** 一处违规的定位信息 */
interface Violation {
  /** 相对 src/ 的文件路径，如 'app/profile/_components/NameModal.tsx' */
  file: string
  /** 1 起算的行号，指向 <GradientButton 起始标签所在行 */
  line: number
}

/** 一次全站扫描的产出（含用于自检的计数，防止扫描器空转还判绿） */
interface ScanResult {
  /** 实际读取的 .tsx 文件数 */
  fileCount: number
  /** 找到的 <form> 子树数量 */
  formCount: number
  /** 落在 <form> 子树内的 <GradientButton> 数量（含合规与违规） */
  buttonsInFormCount: number
  /** 其中未显式传 type 的 */
  violations: Violation[]
  /** 扫描器自身解析不下去的地方（如 <form> 找不到闭合标签），必须为空，否则计数不可信 */
  parseErrors: string[]
}

/**
 * 递归收集目录下的 .tsx 文件
 * @param dir 起始目录（绝对路径）
 * @returns   .tsx 文件绝对路径数组；跳过 __tests__ 目录（测试夹具里故意写的反例不该被当成产品代码告警）
 */
function collectTsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      out.push(...collectTsxFiles(full))
    } else if (entry.name.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

/**
 * 把源码里的注释内容抹成等长空格（保留换行）
 * @param src 原始源码
 * @returns   同样长度的源码副本，注释内容变成空格
 * @sideEffect 无。刻意保持长度不变，这样后面算出来的行号跟原文件完全对得上。
 *
 * 为什么必须抹掉：GradientButton.tsx / Chip.tsx 的 JSDoc 里就白纸黑字写着「放进 <form> 会误触发提交」，
 * 不抹的话扫描器会把这句注释当成一个真的 <form> 开标签、然后找不到 </form> 而报错。
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
      // 排除 'https://'。字符串字面量里裸写 '//' 会被误判为注释，但那只会让扫描器少看一行、
      // 不会凭空造出违规（只可能漏判，不会误报），且全库现无此写法。
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
 * 从某个 '<' 开始，找出这个起始标签结束的 '>' 的下标
 * @param src   源码（已抹注释）
 * @param start 指向 '<' 的下标
 * @returns     结束 '>' 的下标；找不到返回 -1
 *
 * 不能直接 indexOf('>')：JSX 属性里合法地存在 '>'，例如 className={cn(a > b)} 或 aria-label="a>b"。
 * 这里用一个小状态栈跟踪 {} 深度、单/双引号、模板串（含 ${}），只有栈里只剩「标签」这一层时的 '>' 才算收尾。
 * 宁可写笨一点也别漏判。
 */
function findTagEnd(src: string, start: number): number {
  type Ctx = 'tag' | 'brace' | 'squote' | 'dquote' | 'tick'
  const stack: Ctx[] = ['tag']
  let i = start + 1
  while (i < src.length) {
    const c = src[i]
    const top = stack[stack.length - 1]
    if (top === 'squote' || top === 'dquote') {
      if (c === '\\') { i += 2; continue }
      if ((top === 'squote' && c === "'") || (top === 'dquote' && c === '"')) stack.pop()
      i += 1
      continue
    }
    if (top === 'tick') {
      if (c === '\\') { i += 2; continue }
      if (c === '`') stack.pop()
      else if (c === '$' && src[i + 1] === '{') { stack.push('brace'); i += 2; continue }
      i += 1
      continue
    }
    // top 是 'tag' 或 'brace'
    if (c === "'") stack.push('squote')
    else if (c === '"') stack.push('dquote')
    else if (c === '`') stack.push('tick')
    else if (c === '{') stack.push('brace')
    else if (c === '}') stack.pop()
    else if (c === '>' && stack.length === 1) return i
    i += 1
  }
  return -1
}

/**
 * 找出某个标签名的所有起始标签位置
 * @param src  源码（已抹注释）
 * @param name 标签名，如 'form' / 'GradientButton'
 * @returns    每个起始标签 '<' 的下标数组
 *
 * 用「后面必须紧跟空白 / '>' / '/'」把 <form> 与 <formSomething>、<GradientButton> 与 <GradientButtonRow> 区分开。
 */
function findOpenTags(src: string, name: string): number[] {
  const out: number[] = []
  let from = 0
  for (;;) {
    const at = src.indexOf(`<${name}`, from)
    if (at === -1) return out
    const next = src[at + 1 + name.length]
    if (next !== undefined && (/\s/.test(next) || next === '>' || next === '/')) out.push(at)
    from = at + 1
  }
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
 * 全站扫描：找出所有落在 <form> 子树内、却没显式传 type 的 <GradientButton>
 * @returns 扫描结果（含计数与违规清单）
 *
 * 假设：<form> 不嵌套。HTML 规范里嵌套 form 本就非法，故直接把「<form 起始标签之后的第一个 </form>」
 * 当作子树终点。若将来真出现嵌套 form，本扫描器会低估子树范围（漏判），不会误报。
 */
function scanFormGradientButtons(): ScanResult {
  const files = collectTsxFiles(SRC_DIR)
  const violations: Violation[] = []
  const parseErrors: string[] = []
  let formCount = 0
  let buttonsInFormCount = 0

  for (const abs of files) {
    const rel = path.relative(SRC_DIR, abs)
    const src = blankComments(fs.readFileSync(abs, 'utf8'))
    for (const formAt of findOpenTags(src, 'form')) {
      const openEnd = findTagEnd(src, formAt)
      if (openEnd === -1) {
        parseErrors.push(`${rel}:${lineOf(src, formAt)} <form> 起始标签没找到收尾的 '>'`)
        continue
      }
      formCount += 1
      // 自闭合 <form ... />：没有子树，直接跳过
      if (src[openEnd - 1] === '/') continue
      const closeAt = src.indexOf('</form>', openEnd)
      if (closeAt === -1) {
        parseErrors.push(`${rel}:${lineOf(src, formAt)} <form> 找不到配对的 </form>`)
        continue
      }
      const subtree = src.slice(openEnd, closeAt)
      for (const btnAt of findOpenTags(subtree, 'GradientButton')) {
        buttonsInFormCount += 1
        const absBtnAt = openEnd + btnAt
        const btnEnd = findTagEnd(src, absBtnAt)
        if (btnEnd === -1) {
          parseErrors.push(`${rel}:${lineOf(src, absBtnAt)} <GradientButton> 起始标签没找到收尾的 '>'`)
          continue
        }
        const attrs = src.slice(absBtnAt, btnEnd)
        if (!/\btype\s*=/.test(attrs)) {
          violations.push({ file: rel, line: lineOf(src, absBtnAt) })
        }
      }
    }
  }

  return { fileCount: files.length, formCount, buttonsInFormCount, violations, parseErrors }
}

const scan = scanFormGradientButtons()

describe('规则守卫：<form> 内的 GradientButton 必须显式传 type', () => {
  it('扫描器本身没有解析不下去的地方（否则下面的计数与结论都不可信）', () => {
    expect(scan.parseErrors).toEqual([])
  })

  it('扫描确实覆盖到了源码（防止规则守卫因为路径写错而空转、永远绿）', () => {
    // eslint-disable-next-line no-console -- 这行摘要是本守卫的体检报告，跑测试时要能一眼看到覆盖面
    console.log(
      `[规则守卫] 扫描 ${scan.fileCount} 个 .tsx，发现 ${scan.formCount} 个 <form>，` +
      `其中 form 子树内的 <GradientButton> ${scan.buttonsInFormCount} 处`,
    )
    expect(scan.fileCount).toBeGreaterThan(50)
    // 若将来全站确实一个 <form> 都不剩了，这条可以下调；但改之前先确认不是扫描器坏了。
    expect(scan.formCount).toBeGreaterThan(0)
    expect(scan.buttonsInFormCount).toBeGreaterThan(0)
  })

  it('没有任何一个 form 内的 GradientButton 漏传 type', () => {
    const detail = scan.violations.map((v) => `  src/${v.file}:${v.line}`).join('\n')
    expect(
      scan.violations.length === 0
        ? ''
        : '以下 <GradientButton> 在 <form> 内却没有显式传 type：\n' + detail +
          '\n\n修法：提交按钮加 type="submit"，其余按钮加 type="button"。' +
          '\nGradientButton 的默认 type 是 "button"，放在 form 里不传就永远不会触发 onSubmit —— ' +
          '页面不报错、不变灰，用户只会看到「点了没反应」，tsc/eslint/build/单测全都抓不到（9609d78 就是这么哑了 4 天）。',
    ).toBe('')
  })
})

describe('规则守卫（反方向）：GradientButton 的默认 type 必须仍是 button', () => {
  // 用真实渲染而不是正则读源码：默认值可能写在解构默认参数上，也可能写成 type ?? 'button'、
  // 或者被中间层包一道；只有渲染产物里那个 type= 才是浏览器真正看到的东西。
  // react-dom/server 项目里已在用（见 profile-form-submit-guard.test.tsx），不引入新依赖。
  it('不传 type 时渲染出的是 type="button" —— 若被改回 submit，全站 form 外的 CTA 会开始误提交（9609d78 的镜像事故）', () => {
    const markup = renderToStaticMarkup(<GradientButton onClick={() => {}}>确认</GradientButton>)
    expect(markup).toContain('type="button"')
    expect(markup).not.toContain('type="submit"')
  })

  it('显式传 submit 时仍能覆盖默认值（否则 form 提交按钮全部失效）', () => {
    const markup = renderToStaticMarkup(<GradientButton type="submit">保存</GradientButton>)
    expect(markup).toContain('type="submit"')
  })
})

/**
 * 已知漏判 / 误报（改本文件前先读）
 *
 * 会漏判（扫描不出来、但线上真的会坏）：
 * 1. <form> 和按钮拆在不同文件/组件里 —— 例如父组件写 <form>{children}</form>、子组件里放 GradientButton。
 *    本扫描器只在单文件内做文本配对，跨文件的父子关系一律看不见。
 * 2. 间接渲染 —— 用变量/函数/数组承载按钮（const btn = <GradientButton .../>，form 里写 {btn}），
 *    或再包一层自定义组件（<SubmitButton /> 内部才是 GradientButton）。
 * 3. 表单不是 <form> 标签 —— 用 div + 手写回车提交、或第三方表单组件。
 * 4. 属性用扩散写法 <GradientButton {...props} /> —— 扫描器看不到 type 有没有在 props 里，会当成「没传」而误报；
 *    反过来若某处写了 type={undefined} 则会被当成「传了」而漏判。
 * 5. <form> 嵌套（HTML 非法，但 JSX 写得出来）—— 内层 </form> 会被当成外层的终点，外层剩余部分不再被检查。
 *
 * 会误报（扫描出来但其实无害）：
 * 1. form 内一个纯装饰/纯跳转的 GradientButton（比如传了 href 渲染成 <Link>，根本不是 button）也会被要求写 type。
 *    这是刻意的：多写一个 type="button" 零成本，而少写一个就是一次静默事故。
 * 2. 属性值里恰好出现 type= 字样（如 aria-label="type=submit"）会被当成传了 type。目前全库无此写法。
 */
