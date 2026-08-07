/**
 * @module   practice-session-entry-rule.test
 * @desc     全站规则守卫（静态扫描源码，不渲染页面）：
 *           规则一 —— 凡是跳转到 /practice 的调用点，都必须在跳转之前调用 startPracticeSession()。
 *           规则二 —— 练习页自己（src/app/practice/**）绝不能调 startPracticeSession()。
 *
 *           为什么要立这条规则（而不是只给现有两个入口写断言）：
 *           练习中攒下的优化句子存在 sessionStorage 里，「这一场」的身份就是开场时生成的那个 id。
 *           开场只能发生在【进入练习页的入口】：id 存 sessionStorage，页面重载时它还在，所以
 *           「重载」（不重新开场 → 句子回填）与「点进新的一场」（重新开场 → 句子清空）才能被区分开。
 *           · 漏调开场（规则一被破）：那个入口进去的每一场都不会清上一场的残留，用户会在反馈页
 *             看到上一场的句子；而且本场根本没有有效 id，中途重载照样丢句子。
 *           · 挪进练习页（规则二被破）：重载也会被算成「新的一场」，句子照样被清空 —— 等于整个修复白做。
 *           这两种错法 tsc / eslint / build / 其余单测【全都是绿的】，线上只表现为「反馈页有时候是空的」，
 *           而且几乎只在手机上复现（桌面浏览器基本不回收后台标签页）——正是 2026-08-07 修的那个 bug。
 *
 *           扫描器的已知漏判 / 误报写在文件末尾，改本文件前先读那段。
 * @author   LingoBridge
 * @created  2026-08-07
 */
import fs from 'fs'
import path from 'path'

/** 扫描根目录：本文件在 src/__tests__/ 下，上一级即 src/ */
const SRC_DIR = path.resolve(__dirname, '..')

/** 开场函数名（改名时这里要跟着改，否则守卫会静默失效） */
const START_FN = 'startPracticeSession('

/** 一个「跳去 /practice」的调用点 */
interface NavSite {
  /** 相对 src/ 的文件路径 */
  file: string
  /** 1 起算的行号 */
  line: number
  /** 该行源码（去首尾空白），进失败信息便于定位 */
  text: string
  /** 该调用点在文件中的字符下标（内部用：判断开场调用是否覆盖到它） */
  at: number
}

/** 一次全站扫描的产出（含用于自检的计数，防止扫描器空转还判绿） */
interface ScanResult {
  /** 实际读取的 .ts/.tsx 文件数 */
  fileCount: number
  /** 找到的「跳去 /practice」调用点 */
  navSites: NavSite[]
  /** 其中没有在跳转前调开场的 */
  violations: NavSite[]
  /** 练习页自己调开场的地方（规则二） */
  insidePracticePage: NavSite[]
}

/**
 * 递归收集目录下的 .ts / .tsx 文件
 * @param dir 起始目录（绝对路径）
 * @returns   文件绝对路径数组；跳过 __tests__（测试夹具里故意写的反例不该被当成产品代码告警）
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
 * 把源码里的注释内容抹成等长空格（保留换行）
 * @param src 原始源码
 * @returns   同样长度的源码副本，注释内容变成空格
 * @sideEffect 无。刻意保持长度不变，算出来的行号跟原文件完全对得上。
 *
 * 必须抹掉：本次修复在两个入口都写了「startPracticeSession 必须在这里调」的说明注释，
 * 不抹的话注释里的字样会被当成真的调用，规则一就永远绿。
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
      // 排除 'https://'。字符串字面量里裸写 '//' 会被误判为注释，只会让扫描器少看一行（漏判），不会误报。
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

/** 取某下标所在的整行文本（去首尾空白） */
function lineTextAt(src: string, offset: number): string {
  const from = src.lastIndexOf('\n', offset) + 1
  const to = src.indexOf('\n', offset)
  return src.slice(from, to === -1 ? src.length : to).trim()
}

/**
 * 跳去 /practice 的字符串字面量：'/practice' / "/practice?..." / `/practice?...`。
 * 用 (?![-\w]) 把 /practice-question（另一个页面，不是练习页）排除在外。
 */
const PRACTICE_URL_RE = /['"`]\/practice(?![-\w])/g

/** 这个字面量是不是真的用在「导航」上（而不是路由表之类的数据） */
const NAV_CALL_RE = /(navigate|push|replace|redirect|href\s*=)\s*\(?\s*$/

/** 开场调用与它要保护的跳转之间，最多隔多少字符还算「就在跳转之前」 */
const START_LOOKBACK = 400

/**
 * 全站扫描
 * @returns 扫描结果（调用点清单 + 违规清单 + 计数）
 */
function scan(): ScanResult {
  const files = collectSourceFiles(SRC_DIR)
  const navSites: NavSite[] = []
  const violations: NavSite[] = []
  const insidePracticePage: NavSite[] = []

  for (const abs of files) {
    const rel = path.relative(SRC_DIR, abs)
    const src = blankComments(fs.readFileSync(abs, 'utf8'))

    // 规则二：练习页自己不许开场
    if (rel.startsWith(`app${path.sep}practice${path.sep}`)) {
      let from = 0
      for (;;) {
        const at = src.indexOf(START_FN, from)
        if (at === -1) break
        insidePracticePage.push({ file: rel, line: lineOf(src, at), text: lineTextAt(src, at), at })
        from = at + 1
      }
    }

    // 规则一：先收集本文件所有跳去 /practice 的调用点
    const sitesInFile: NavSite[] = []
    PRACTICE_URL_RE.lastIndex = 0
    for (;;) {
      const m = PRACTICE_URL_RE.exec(src)
      if (m === null) break
      const at = m.index
      // 只认「导航」上下文：路由表 / 常量表里的 '/practice' 不算入口（如 lib/page-route.ts）
      const before = src.slice(Math.max(0, at - 40), at)
      if (!NAV_CALL_RE.test(before)) continue
      sitesInFile.push({ file: rel, line: lineOf(src, at), text: lineTextAt(src, at), at })
    }

    for (const site of sitesInFile) {
      navSites.push(site)
      const startAt = src.lastIndexOf(START_FN, site.at)
      const covered =
        startAt !== -1 &&
        site.at - startAt <= START_LOOKBACK &&
        // 一次开场只能护住紧随其后的那一个跳转：中间若还夹着别的跳转，说明这次开场是给那一个用的
        !sitesInFile.some(other => other.at > startAt && other.at < site.at)
      if (!covered) violations.push(site)
    }
  }

  return { fileCount: files.length, navSites, violations, insidePracticePage }
}

const result = scan()

describe('规则守卫一：跳去 /practice 之前必须调 startPracticeSession()', () => {
  it('扫描确实覆盖到了源码，且找得到已知的入口（防止守卫因路径/正则写错而空转、永远绿）', () => {
    // eslint-disable-next-line no-console -- 这行摘要是本守卫的体检报告，跑测试时要能一眼看到覆盖面
    console.log(
      `[规则守卫] 扫描 ${result.fileCount} 个 .ts/.tsx，找到 ${result.navSites.length} 处跳去 /practice 的调用点：\n` +
      result.navSites.map(s => `  src/${s.file}:${s.line}`).join('\n'),
    )
    expect(result.fileCount).toBeGreaterThan(50)
    // 已知入口两处：analysis 页「开始练习」、素材库「练习过的题目」卡片。将来多了只会更大。
    expect(result.navSites.length).toBeGreaterThanOrEqual(2)
    const files = result.navSites.map(s => s.file.split(path.sep).join('/'))
    expect(files).toContain('app/analysis/page.tsx')
    expect(files).toContain('components/library/PracticeTopicsTab.tsx')
  })

  it('没有任何一个入口漏调开场', () => {
    const detail = result.violations.map(v => `  src/${v.file}:${v.line}  ${v.text}`).join('\n')
    expect(
      result.violations.length === 0
        ? ''
        : '以下位置跳去了 /practice，却没有在跳转之前调用 startPracticeSession()：\n' + detail +
          '\n\n修法：把跳转改成 `startPracticeSession(); navigate(\'/practice?...\')`' +
          '（startPracticeSession 从 @/lib/storage 引）。' +
          '\n为什么必须这样：练习中攒下的优化句子按「本场 id」存 sessionStorage，开场负责生成这个 id 并清掉' +
          '上一场的残留。少了这一步，① 用户会在反馈页看到上一场的句子；② 这一场没有有效 id，' +
          '手机浏览器中途回收标签页后句子全丢（反馈页显示「这次没有要回顾的句子」）。' +
          '\n这两种坏法 tsc / eslint / build 全都抓不到，只有这条规则守得住。',
    ).toBe('')
  })
})

describe('规则守卫二：练习页自己绝不能调 startPracticeSession()', () => {
  it('src/app/practice/** 里没有开场调用', () => {
    const detail = result.insidePracticePage.map(v => `  src/${v.file}:${v.line}  ${v.text}`).join('\n')
    expect(
      result.insidePracticePage.length === 0
        ? ''
        : '练习页内部调用了 startPracticeSession()：\n' + detail +
          '\n\n修法：把这次调用挪回【进入练习页的入口】（跳转那一行之前）。' +
          '\n为什么：开场会清掉暂存的句子。放在练习页里，页面被手机浏览器回收后重载也会被算成' +
          '「新的一场」，本场句子照样清零 —— 整个「重载不丢句子」的修复就白做了，而且测试还是绿的。',
    ).toBe('')
  })
})

/**
 * 已知漏判 / 误报（改本文件前先读）
 *
 * 会漏判（扫描不出来、但线上真的会坏）：
 * 1. URL 不是字面量 —— 如 const url = buildPracticeUrl(...); navigate(url)。扫描器只认写死的 '/practice'。
 * 2. 开场与跳转拆在不同文件/函数里（父组件开场、子组件跳转），或隔了超过 START_LOOKBACK(400) 个字符。
 * 3. 用 <Link href="/practice?..."> 之类的声明式跳转：href= 已在 NAV_CALL_RE 里，但若中间还夹着别的属性
 *    （href={`...`} 之外的写法）可能对不上；全库现无此写法。
 * 4. 服务端重定向 / middleware 里跳 /practice —— 那条路根本没有 sessionStorage，本规则也管不着。
 *
 * 会误报（扫描出来但其实无害）：
 * 1. 注释、文档字符串里出现 navigate('/practice')。注释已被 blankComments 抹掉，文档字符串仍会被算作调用点。
 * 2. 一个入口连续跳两次 /practice（不存在的写法）：第二次会被判成没被开场覆盖。
 */
