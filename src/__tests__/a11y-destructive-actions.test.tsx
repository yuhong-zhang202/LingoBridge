/**
 * @module   a11y-destructive-actions.test
 * @desc     三条破坏性操作无障碍缺陷的回归守卫（2026-08-08 修复）。三条的共同点是：对用鼠标的明眼人
 *           完全无感，产品方自己怎么点都测不出来 —— 所以必须由测试盯着，不能靠人肉复看。
 *
 *           C1 隐形删除按钮：SwipeToDelete 的红底删除按钮常驻 DOM、只是被卡片盖住。未滑出时若不摘出
 *              Tab 顺序与读屏，靠键盘导航的用户会在每一张卡上撞到一个看不见的「删除」，回车即真删。
 *           C2 确认框对键盘/读屏用户等于不存在：无初始聚焦 / 无 Tab 陷阱 / 关闭不归还焦点。
 *           C3 live 容器不常驻：读屏要提前盯住已存在的 live 容器才能在文本变化时朗读；随消息一起被
 *              创建的容器往往来不及注册，那句「已删除」会整条丢失。
 *
 *           ⚠️ 本仓库没有 jsdom / testing-library（且本次禁止新增依赖），因此**没有一条断言是真的按下了
 *           Tab 键或回车**。每个 describe 上都标了它守的到底是「行为」还是「结构」：
 *             - 行为：真跑了产品代码并断言其输出（renderToStaticMarkup 的渲染产物、announce() 的调用效果）
 *             - 结构：读源码文本断言关键代码路径存在（焦点、按键这类只能这样守）
 *           结构类断言防的是「有人把这段删了/改回去了」，防不住「这段代码在真浏览器里其实没生效」。
 *           后者只能真机 + 真读屏验，见交付说明。
 * @author   LingoBridge
 * @created  2026-08-08
 */
import fs from 'fs'
import path from 'path'
import { renderToStaticMarkup } from 'react-dom/server'
import SwipeToDelete from '@/components/library/SwipeToDelete'
import ConfirmDialog from '@/components/ConfirmDialog'
import A11yAnnouncer, { announce, getAnnouncement, subscribeAnnouncements } from '@/components/A11yAnnouncer'

/** 扫描根目录：本文件在 src/__tests__/ 下，上一级即 src/ */
const SRC_DIR = path.resolve(__dirname, '..')

/**
 * 读取 src 下某个文件的源码
 * @param rel 相对 src/ 的路径
 * @returns   源码文本
 */
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(SRC_DIR, rel), 'utf8')
}

/**
 * 抹掉源码里的注释
 * @param src 原始源码
 * @returns   去掉块注释与行注释后的源码
 * @sideEffect 无。
 *
 * 必须抹：本次修复在 SwipeToDelete.tsx 末尾写了一大段「为什么确认做在组件内部」的说明，里面白纸黑字
 * 出现 `<SwipeToDelete onDelete={...}>` 和「调用 onDelete」，不抹的话下面数 onDelete 调用次数会数错。
 * 已知边界：字符串字面量里裸写 '//' 会被当成注释（只会少看一段，不会凭空造出违规）；这几个文件里没有。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * 递归收集目录下的 .tsx 文件（跳过 __tests__ / node_modules）
 * @param dir 起始目录（绝对路径）
 * @returns   .tsx 文件绝对路径数组
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

// ────────────────────────────────────────────────────────────────────────────
// C1 —— 隐形的删除按钮
// ────────────────────────────────────────────────────────────────────────────

describe('C1【行为】未滑出时，SwipeToDelete 的删除按钮不可聚焦、不被读屏拾取', () => {
  // 真渲染组件、断言浏览器最终看到的那串属性。offset 初始为 0 ＝ 卡片盖住红底 ＝ 未滑出。
  const markup = renderToStaticMarkup(
    <SwipeToDelete onDelete={() => {}}><div>卡片内容</div></SwipeToDelete>,
  )
  const delButton = markup.match(/<button\b[^>]*>/)?.[0] ?? ''

  it('渲染产物里确实有那颗红底删除按钮（防止选择器写错导致本组断言空转）', () => {
    expect(delButton).not.toBe('')
    expect(markup).toContain('删除')
  })

  it('带 aria-hidden="true" —— 否则读屏会在每张卡上念出一句看不见的「删除」', () => {
    expect(delButton).toContain('aria-hidden="true"')
  })

  it('带 tabindex="-1" —— 否则 Tab 导航会停在这颗看不见的按钮上', () => {
    expect(delButton).toContain('tabindex="-1"')
  })

  it('带 disabled —— 兜住「被程序化聚焦后按回车」这条路', () => {
    expect(delButton).toContain('disabled')
  })

  it('未滑出时不渲染确认弹窗（确认框只在点了删除之后才出现）', () => {
    expect(markup).not.toContain('role="dialog"')
  })
})

describe('C1【结构】滑出后必须恢复可聚焦，否则手势用户反而用不了', () => {
  const src = stripComments(readSrc('components/library/SwipeToDelete.tsx'))

  it('三个属性都绑在 revealed 上，不是写死的常量', () => {
    expect(src).toMatch(/aria-hidden=\{!revealed\}/)
    expect(src).toMatch(/tabIndex=\{revealed \? 0 : -1\}/)
    expect(src).toMatch(/disabled=\{!revealed\}/)
  })

  it('revealed 由实际滑动位移推出（写死 false 会让手势用户永远点不到删除）', () => {
    expect(src).toMatch(/const revealed = offset <= REVEALED_PX/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// C1 之二 —— 没有任何调用方还是「一按即删」
// ────────────────────────────────────────────────────────────────────────────

describe('C1【结构】规则守卫：SwipeToDelete 的删除按钮不得一按即删', () => {
  // 本次修复把二次确认做进了组件内部（而不是要求每个调用方各接一遍），理由见 SwipeToDelete.tsx 末尾注释。
  // 因此「没有任何调用方一按即删」这条规则，等价于「组件内部确实把 onDelete 挡在了确认框后面」。
  // 下面同时守两头：① 组件真的挡了 ② 调用方普查还数得出人来（防止组件被改成别的名字后本守卫空转）。
  const src = stripComments(readSrc('components/library/SwipeToDelete.tsx'))

  const callSites = collectTsxFiles(SRC_DIR)
    .filter((abs) => stripComments(fs.readFileSync(abs, 'utf8')).includes('<SwipeToDelete'))
    .map((abs) => path.relative(SRC_DIR, abs))
    .sort()

  it('调用方普查非空（本守卫没有空转）', () => {
    // eslint-disable-next-line no-console -- 覆盖面摘要，跑测试时要能一眼看到守住了哪几处
    console.log(`[a11y 守卫] <SwipeToDelete> 调用方 ${callSites.length} 处：\n  ${callSites.join('\n  ')}`)
    expect(callSites.length).toBeGreaterThanOrEqual(4)
  })

  it('组件内渲染了 ConfirmDialog（确认流程在组件里，调用方不必也不能绕过）', () => {
    expect(src).toContain('<ConfirmDialog')
  })

  it('删除按钮的 onClick 只负责打开确认框，绝不直接调 onDelete', () => {
    const onClickValues = src.match(/onClick=\{[^}]*\}/g) ?? []
    expect(onClickValues.length).toBeGreaterThan(0)
    expect(onClickValues.filter((v) => v.includes('onDelete'))).toEqual([])
  })

  it('onDelete 全文只被调用一次，且写在确认回调里', () => {
    expect((src.match(/onDelete\(\)/g) ?? []).length).toBe(1)
    const handler = src.slice(src.indexOf('const handleConfirm'), src.indexOf('const revealed'))
    expect(handler).toContain('onDelete()')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// C2 —— 确认框的键盘 / 读屏可用性
// ────────────────────────────────────────────────────────────────────────────

describe('C2【行为】ConfirmDialog 渲染出可聚焦的模态面板', () => {
  const markup = renderToStaticMarkup(
    <ConfirmDialog open title="确认删除" description="确认删除这一项？此操作不可撤销。" danger onConfirm={() => {}} onCancel={() => {}} />,
  )
  const panel = markup.match(/<div\b[^>]*role="dialog"[^>]*>/)?.[0] ?? ''

  it('渲染出 role="dialog" 面板（防止本组断言空转）', () => {
    expect(panel).not.toBe('')
    expect(panel).toContain('aria-modal="true"')
  })

  it('面板自身可被程序化聚焦（tabindex="-1"）—— 没有它，打开弹窗时焦点无处可去，只能留在背后的列表上', () => {
    expect(panel).toContain('tabindex="-1"')
  })

  it('标题与说明都被 aria 关联，且 id 真实存在于渲染产物里', () => {
    const labelId = panel.match(/aria-labelledby="([^"]+)"/)?.[1]
    const descId = panel.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(labelId).toBeTruthy()
    expect(descId).toBeTruthy()
    expect(markup).toContain(`id="${labelId}"`)
    expect(markup).toContain(`id="${descId}"`)
  })

  it('同一棵树里的两个确认框 id 各不相同（撞 id 会让 aria 指到别人的标题上）', () => {
    // 必须渲染在同一棵树里：useId 的计数按渲染批次走，两次独立 renderToStaticMarkup 各自从头数、必然同号，
    // 那样测的就不是组件而是 React 的计数器了。
    const both = renderToStaticMarkup(
      <>
        <ConfirmDialog open title="确认删除" description="第一处" danger onConfirm={() => {}} onCancel={() => {}} />
        <ConfirmDialog open title="确认删除" description="第二处" danger onConfirm={() => {}} onCancel={() => {}} />
      </>,
    )
    const ids = [...both.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('危险确认不靠颜色单通道传达：红底之外还有「确认删除」四个字', () => {
    expect(markup).toContain('bg-error')
    expect(markup).toContain('确认删除')
  })

  it('open=false 时什么都不渲染（关闭态不该在 DOM 里留残骸）', () => {
    const closed = renderToStaticMarkup(
      <ConfirmDialog open={false} title="确认删除" description="x" onConfirm={() => {}} onCancel={() => {}} />,
    )
    expect(closed).toBe('')
  })
})

describe('C2【结构】焦点三件套的关键代码路径存在', () => {
  // 焦点与按键在无 DOM 的环境里跑不起来，只能守源码。这三条被删掉时，tsc / build / 其余单测全绿。
  const src = stripComments(readSrc('components/ConfirmDialog.tsx'))

  it('① 打开时把焦点移入面板', () => {
    expect(src).toMatch(/panelRef\.current\?\.focus\(\)/)
  })

  it('② Tab 焦点陷阱：拦 Tab、首尾回环', () => {
    expect(src).toMatch(/e\.key !== 'Tab'/)
    expect(src).toMatch(/e\.shiftKey/)
    expect(src).toMatch(/e\.preventDefault\(\); last\.focus\(\)/)
    expect(src).toMatch(/e\.preventDefault\(\); first\.focus\(\)/)
    // 焦点刚落在面板本身时按 Shift+Tab 也必须被兜住，否则第一下反向 Tab 就退到背景里了
    expect(src).toMatch(/active === root/)
    // 陷阱必须真挂到 DOM 上，光有函数没绑等于没有
    expect(src).toMatch(/onKeyDown=\{handleKeyDown\}/)
  })

  it('③ 关闭后把焦点还给触发它的元素（并检查它还在不在 DOM 里，避免抢焦点到已卸载节点）', () => {
    expect(src).toMatch(/document\.body\.contains\(back\)/)
    expect(src).toMatch(/back\.focus\(\)/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// C3 —— live 容器必须常驻（项目铁律，本组最重要）
// ────────────────────────────────────────────────────────────────────────────

describe('C3【行为】播报容器在没有任何消息时也必须存在于渲染产物里', () => {
  it('空消息状态下依然渲染出 role="status" + aria-live="polite" 容器', () => {
    const markup = renderToStaticMarkup(<A11yAnnouncer />)
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    // 没有消息时容器在、但里面是空的 —— 这正是「常驻」的定义
    expect(markup).toContain('></p>')
  })

  it('视觉上完全隐藏（sr-only），不占布局', () => {
    expect(renderToStaticMarkup(<A11yAnnouncer />)).toContain('sr-only')
  })
})

describe('C3【行为】announce() 把状态送进常驻容器', () => {
  // 走的是组件自己用的那条 store 通道（useSyncExternalStore 的 subscribe / getSnapshot），不是测试专用后门。
  const ZWSP = '\u200B'

  it('订阅者会被通知，且读到的就是刚播报的那句', () => {
    const got: string[] = []
    const unsub = subscribeAnnouncements(() => got.push(getAnnouncement()))
    announce('已删除 1 条语料')
    unsub()
    expect(got).toEqual(['已删除 1 条语料'])
  })

  it('连续播报同一句时快照仍会变化，否则读屏不会念第二遍', () => {
    const got: string[] = []
    const unsub = subscribeAnnouncements(() => got.push(getAnnouncement()))
    announce('已删除 1 项')
    announce('已删除 1 项')
    unsub()
    expect(got[0]).toBe('已删除 1 项')
    expect(got[1]).not.toBe(got[0])
    // 变化只来自零宽空格：读屏念出来仍是同一句，不会多出可见字符
    expect(got[1].split(ZWSP).join('')).toBe('已删除 1 项')
  })

  it('取消订阅后不再被通知（避免卸载的组件继续被回调）', () => {
    const got: string[] = []
    const unsub = subscribeAnnouncements(() => got.push(getAnnouncement()))
    unsub()
    announce('已删除 2 条语料')
    expect(got).toEqual([])
  })
})

describe('C3【结构】常驻容器真的挂在了根布局上', () => {
  it('layout.tsx 渲染了 <A11yAnnouncer />（不挂就等于没有容器，前面的行为断言全是空欢喜）', () => {
    const layout = stripComments(readSrc('app/layout.tsx'))
    expect(layout).toContain('<A11yAnnouncer />')
    expect(layout).toContain("from '@/components/A11yAnnouncer'")
  })
})

describe('C3【结构】临时挂载的组件不得自带 live 容器', () => {
  // Toast 随消息挂载、UndoToast 由调用方 {pendingCount > 0 && ...} 条件挂载 —— 它们身上的
  // role="alert" / aria-live 正是「容器不常驻」的病灶。播报一律走常驻容器。
  it.each([
    ['components/Toast.tsx'],
    ['components/UndoToast.tsx'],
  ])('%s 不再自带 role="alert" / aria-live，改为调用 announce()', (rel) => {
    const src = stripComments(readSrc(rel))
    expect(src).not.toContain('role="alert"')
    expect(src).not.toContain('aria-live')
    expect(src).toContain('announce(')
  })

  it('UndoToast 的播报会带上「可撤销」，否则读屏用户不知道旁边那颗撤销按钮存在', () => {
    const src = stripComments(readSrc('components/UndoToast.tsx'))
    expect(src).toMatch(/announce\(`\$\{message\}，可撤销`\)/)
  })
})
