/**
 * @module   dashboard/dashboard-page-verbatim.test
 * @desc     **拆分重构的前端搬运守卫**（P1）——把重构前 `dashboard/page.tsx` 的每一行「有意义的代码」
 *           钉成金标；重构后这些行必须仍**原样存在**于 `page.tsx` 或 `_sections/` 下的某个文件里。
 *
 *   【为什么不用渲染快照】`DashboardPage` 是 client component，数据靠 `useEffect` + `apiFetch` 取，
 *   `renderToStaticMarkup` 只能拿到加载态，快照不到任何真实数字或分支。而页面里 14 个局部组件
 *   （GrowthFunnel / PhaseCostBreakdown / UserCostBreakdown …）当前**未导出**，也无法单独渲染。
 *   故改用「文本层面的搬运审计」：不证明渲染结果相同，但能抓住**搬运途中被顺手改掉的那一行**——
 *   这正是纯重构最容易、也最难被发现的翻车方式。
 *
 *   【它能抓什么 / 不能抓什么】
 *     能抓：改了条件、改了阈值、改了文案、改了 className、漏搬了某一行、把三元判断反了。
 *     不能抓：行被搬走但从未被渲染（编排顺序错）、props 传错值。
 *            → 那两类由后端金标（数字层）+ 产品方真机（视觉层）兜底。CLAUDE.md 明载
 *              「本项目所有 UI bug 零次来自自动检查、全来自真机」，本守卫不假装替代真机。
 *
 *   ⚠️ **实施重构的人不得修改本文件与金标**。若断言转红，正确处理是把那一行原样搬回去，
 *      而不是把金标里的行删掉。确需改动只能由人明示。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import fs from 'fs'
import path from 'path'

const ROOT = path.join(__dirname, '..')
const GOLDEN = path.join(__dirname, '__golden__', 'page-lines.json')

/**
 * 归一化一份源码为「有意义的代码行」集合。
 * 刻意剔除的东西都是**重构中合法会变**的：
 *   - import / export 语句（拆文件必然重排）
 *   - 纯符号行（`{` `}` `)` `>` 等，搬运中缩进与换行位置合法变化）
 *   - 空行与整行注释（注释另有「口径注释必须原样搬运」的单独断言，不混在这里）
 *   - 行首尾空白与行内连续空白（缩进层级在拆分后必然改变）
 * @param src 源码全文
 * @returns 归一化后的行集合
 */
function meaningfulLines(src: string): Set<string> {
  const out = new Set<string>()
  for (const raw of src.split('\n')) {
    const line = raw.trim().replace(/\s+/g, ' ')
    if (!line) continue
    if (/^(import|export)\b/.test(line)) continue
    if (/^\/\//.test(line) || /^\/?\*/.test(line)) continue
    if (line.length < 12) continue                 // 纯符号/极短片段：拆分中必然重排，噪声大于价值
    out.add(line)
  }
  return out
}

/** 递归收集目录下所有 .tsx/.ts 源码 */
function readTree(dir: string): string {
  if (!fs.existsSync(dir)) return ''
  let acc = ''
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) { if (name !== '__tests__' && name !== '__golden__') acc += readTree(p); continue }
    if (/\.tsx?$/.test(name)) acc += fs.readFileSync(p, 'utf8') + '\n'
  }
  return acc
}

/** 重构后代码可能落在的位置：page.tsx 本体 + 新建的 _sections/ */
function currentSources(): string {
  return fs.readFileSync(path.join(ROOT, 'page.tsx'), 'utf8') + '\n' + readTree(path.join(ROOT, '_sections'))
}

describe('dashboard/page.tsx · 拆分重构搬运守卫', () => {
  it('重构前的每一行有意义代码，重构后仍原样存在', () => {
    const current = meaningfulLines(currentSources())

    // 金标缺失 = 首次建立（仅重构前允许）；已存在则只比对，绝不覆写。
    if (!fs.existsSync(GOLDEN)) {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true })
      fs.writeFileSync(GOLDEN, JSON.stringify([...current].sort(), null, 2) + '\n', 'utf8')
      throw new Error(`金标不存在，已生成 ${GOLDEN}；请提交后重跑（本次视为失败，避免"自动生成即通过"）`)
    }

    const golden: string[] = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))
    const missing = golden.filter(l => !current.has(l))
    if (missing.length) {
      throw new Error(
        `有 ${missing.length} 行在重构后消失或被改写（纯重构不该发生）。前 20 行：\n` +
        missing.slice(0, 20).map(l => '  · ' + l).join('\n') +
        `\n\n若确系有意改动，请由人明示后再更新金标——实施者不得自行删改金标。`,
      )
    }
    expect(missing).toEqual([])
  })

  it('关键口径注释必须原样保留（丢了以后一定会被误读）', () => {
    const src = currentSources()
    // 这些是 page.tsx 里记录「数字为什么不能这样读」的注释片段。
    // 取短特征串而非整句：注释允许换行重排，但**语义关键词一个都不能少**。
    const MUST_KEEP = [
      '位置记忆',        // 折叠区顺序刻意不做动态排序的理由
      '惰性 useState',   // CollapsibleSection 的 open 只算一次
      '数据驱动',        // 「出事了吗」的 defaultOpen
    ]
    const lost = MUST_KEEP.filter(k => !src.includes(k))
    expect(lost).toEqual([])
  })
})
