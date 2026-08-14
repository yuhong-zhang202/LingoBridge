/**
 * @module   tab-view
 * @desc     四处 UI 的内部 tab 标识 → page.tab_view 的 tab 枚举【唯一映射】，外加去重与上报。
 *           全仓库只有这一个文件认识那些内部标识，埋点链路上的其它地方只见 TabId 枚举
 *           （同 page.view 与 lib/page-route.ts 的关系）。
 *
 *   🔴【隐私红线：这个文件存在的第一个理由】题库两端的 tab 内部值是【中文串】
 *     （'维度设计' / '题目列表'），素材库两端各是一套英文短串。**这些内部值一个字都不许上报**：
 *     它们是界面文案、不是数据口径，原样上报既开了自由文本的口子，两端还会落成不同的值。
 *     故本模块的返回类型是 TabId 联合类型（编译期堵死「返回一个任意串」），
 *     白名单外一律返回 null =【不上报】，**刻意不设 'other' 兜底桶**（理由见 event-schema 的 TAB_ID）。
 *
 *   ⚠️【这个文件存在的第二个理由：四套标识互不相同，写反了永远发现不了】
 *     同一个「生词/词组」tab，**桌面端内部叫 `phrases`、移动端内部叫 `words`**；
 *     两者都必须映射成 `library_words`。映射写反后事件照发、库里也有数据，只是常年记错一格 ——
 *     看板上完全看不出来。四张表因此集中在这里，并由 lib/__tests__/tab-view.test.ts 逐值钉死。
 *
 *   【去重：模块级变量，不是 useRef】理由与 components/PageViewTracker 的 lastRoute 完全相同：
 *     useRef 只活在组件实例里，卸载重挂（StrictMode 的 remount、错误边界重置、有人给布局加 key）
 *     就回到初始值、去重失效。模块级变量随整页加载重置。
 *     ⚠️【由此产生的口径】变量跨页面存活：「离开素材库 → 逛别的页 → 回来仍落在同一个 tab」
 *     中间没报过别的 tab 的话，第二次不再记 —— 本事件计的是【tab 切换/进入次数】，不是页面访问次数。
 *     完整口径（含默认 tab 挂载即报、移动端 hub 不报、双端不对称）见 event-schema.ts 的 TAB_ID 条目。
 *
 *   ⚠️【为什么要 side 这个参数：两套 UI 是【同时挂载】的】素材库/题库的 page.tsx 都写成
 *     `<div className="lg:hidden"><Mobile/></div><div className="hidden lg:block"><Desktop/></div>`
 *     —— 两棵 React 树【都在跑 effect】，只是其中一棵被 CSS 藏起来。不按断点闸一道的话，
 *     手机用户打开素材库会被桌面树记一条 library_cards（他实际看到的是 hub），
 *     TAB_ID 里「移动端没有默认 tab 偏高」那条口径当场就是错的。判据与 flow.feedback_rendered
 *     的 view 同款：按同一条断点线 lg=1024px 实测。
 *
 *   纯函数 + 模块级去重状态，无 React 依赖（故可在 node 环境直接单测）：本模块被 'use client'
 *   组件引用，禁止 import 任何 server 模块。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
import { track } from '@/lib/client-events'
import type { TabId } from '@/lib/event-schema'

/** 素材库【桌面端】的 tab 内部值（LibraryDesktop 的 `type Tab`，由 URL `?tab=` 派生、默认 cards）。 */
export type LibraryDesktopTab = 'cards' | 'phrases' | 'pron' | 'stories'
/** 素材库【移动端】的视图内部值（LibraryMobile 的 `type View`：hub 是分类首页，不是 tab）。 */
export type LibraryMobileView = 'hub' | 'stories' | 'cards' | 'words' | 'pron'
/** 题库两端的 tab 内部值（中文串，两端同一套；🔴 绝不上报原文）。 */
export type QuestionBankTab = '维度设计' | '题目列表'

/**
 * 调用方属于哪一棵 UI 树。**只用于「当前断点下我这棵树是不是可见的那棵」这道闸，不上报**
 * （故不进 event-schema：它不是任何事件的取值域，别跟 COLLECT_VIEW 搞混）。
 */
export type TabViewSide = 'mobile' | 'desktop'

/**
 * 桌面端素材库：内部值 → TabId。
 * ⚠️ `phrases` → `library_words`：桌面端管「词组收藏」叫 phrases，移动端叫 words，同一个 tab。
 */
const LIBRARY_DESKTOP_TAB: Readonly<Record<LibraryDesktopTab, TabId>> = {
  cards:   'library_cards',
  phrases: 'library_words',
  pron:    'library_pron',
  stories: 'library_stories',
}

/**
 * 移动端素材库：内部值 → TabId。
 * ⚠️ `words` → `library_words`（与桌面端 phrases 落同一格）；`hub` 不在表里 = 不上报
 * （它是分类首页，用户还没进任何一个分类）。
 */
const LIBRARY_MOBILE_TAB: Readonly<Record<Exclude<LibraryMobileView, 'hub'>, TabId>> = {
  cards:   'library_cards',
  words:   'library_words',
  pron:    'library_pron',
  stories: 'library_stories',
}

/** 题库两端（桌面/移动共用一套内部值）：中文串 → TabId。 */
const QUESTION_BANK_TAB: Readonly<Record<QuestionBankTab, TabId>> = {
  维度设计: 'qbank_dimension',
  题目列表: 'qbank_list',
}

/**
 * 查一张映射表。
 * 用 hasOwnProperty 而不是直接取值：直接取值会把 'constructor' / 'toString' 这类【原型链上的 key】
 * 当成命中，返回一个函数当 TabId 送进埋点（类型上还看不出来）。
 * @param  table  某一套 UI 的映射表
 * @param  key    该 UI 的内部 tab 值
 * @returns       命中的 TabId；表里没有则 null（=【不上报】，绝不兜底造值）
 */
function lookup<K extends string>(table: Readonly<Record<K, TabId>>, key: string): TabId | null {
  return Object.prototype.hasOwnProperty.call(table, key)
    ? (table as Readonly<Record<string, TabId>>)[key]
    : null
}

/**
 * 桌面端素材库的内部 tab → TabId。
 * @param  tab  LibraryDesktop 的 `tab`（URL 派生，已按 TAB_IDS 白名单收敛过）
 * @returns     TabId；白名单外返回 null（不上报）
 */
export function toLibraryDesktopTabId(tab: LibraryDesktopTab): TabId | null {
  return lookup(LIBRARY_DESKTOP_TAB, tab)
}

/**
 * 移动端素材库的内部视图 → TabId。
 * @param  view  LibraryMobile 的 `view`
 * @returns      TabId；`hub`（分类首页）与白名单外一律 null（不上报）
 */
export function toLibraryMobileTabId(view: LibraryMobileView): TabId | null {
  return lookup(LIBRARY_MOBILE_TAB, view)
}

/**
 * 题库两端的内部 tab（中文串）→ TabId。
 * @param  tab  QuestionBankDesktop / QuestionBankMobile 的 `activeTab`
 * @returns     TabId；白名单外返回 null（不上报）
 */
export function toQuestionBankTabId(tab: QuestionBankTab): TabId | null {
  return lookup(QUESTION_BANK_TAB, tab)
}

/**
 * 当前断点下生效的是哪一套 UI。判据与 feedback 页的 currentView() 同款：**同一条断点线**
 * lg = 1024px（tailwind 默认，本项目未覆写 screens）。
 * ⚠️ 改动这两个页面的布局断点时这里必须跟着改，否则会出现「可见的是移动树、记的是桌面树那条」。
 * matchMedia 在极老/异常环境可能缺失，取不到时按 'mobile' 记（本产品移动端占绝对多数，
 * 猜错的方向与真实分布一致）。
 * @returns 'desktop' 或 'mobile'
 */
function currentSide(): TabViewSide {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'mobile'
  return window.matchMedia('(min-width: 1024px)').matches ? 'desktop' : 'mobile'
}

/**
 * 上一条已上报的 tab（模块级，理由见文件顶注的「去重」段）。
 * null = 还没报过 / 当前停在不上报的视图（移动端 hub）上。
 */
let lastTabId: TabId | null = null

/**
 * 登记一次「现在停在哪个 tab」，需要上报时发一条 page.tab_view。
 *
 * 三件事，顺序不可换：
 *   ① 断点闸：本棵树不是当前可见的那棵就【立刻返回】，连去重状态都不许碰
 *      （否则被藏起来的那棵树会把可见那棵的去重状态改掉）；
 *   ② 不上报的视图（tabId === null，如移动端 hub）把去重状态清空 ——
 *      「进 cards → 退回 hub → 再进 cards」必须记两条，那确实是两次浏览；
 *   ③ 与上次相同即跳过（挡 StrictMode 双跑与卸载重挂）。
 * @param  tabId  当前 tab 的枚举值；null = 当前视图不该上报
 * @param  side   调用方所属的 UI 树
 * @returns       无
 * @sideEffect    改模块级去重状态；需要上报时 POST /api/events（fire-and-forget，失败静默）
 */
export function reportTabView(tabId: TabId | null, side: TabViewSide): void {
  if (currentSide() !== side) return
  if (tabId === null) { lastTabId = null; return }
  if (tabId === lastTabId) return
  lastTabId = tabId
  track('page.tab_view', { tab: tabId })
}
