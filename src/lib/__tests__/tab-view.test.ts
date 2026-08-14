/**
 * @module   tab-view.test
 * @desc     page.tab_view 客户端侧的守卫 —— 映射表 + 去重 + 断点闸三件事，全在 lib/tab-view。
 *           这三件事错了都【不会报错、不会红、页面一切正常】，只会在几周后拉数据时表现为
 *           「某个 tab 常年偏少/偏多」，故每一条都用例钉死：
 *             1. 六个 TabId 都有映射，且 phrases(桌面) 与 words(移动) 必须落到同一个 library_words
 *                —— 这两个内部值长得完全不像，写反了看板上一辈子看不出来；
 *             2. 白名单外的值（含 'constructor' 这类原型链 key）一律不上报，不造 'other' 假桶；
 *             3. 同一 tab 重复调用只发一条；切走再切回发第二条；移动端 hub 复位去重状态；
 *             4. 断点闸：两套 UI 是【同时挂载】的，被 CSS 藏起来的那棵树既不许上报、
 *                也不许碰去重状态（不闸的话手机用户打开素材库会被桌面树记一条 library_cards）。
 *           track 打桩，不发任何请求；node 环境无 window，故自带一个最小 matchMedia 垫片。
 * @author   LingoBridge
 * @created  2026-08-14
 */
jest.mock('@/lib/client-events', () => ({ track: jest.fn() }))

import {
  toLibraryDesktopTabId, toLibraryMobileTabId, toQuestionBankTabId, reportTabView,
  type LibraryDesktopTab, type LibraryMobileView, type QuestionBankTab,
} from '@/lib/tab-view'
import { track } from '@/lib/client-events'
import { TAB_ID, type TabId } from '@/lib/event-schema'

const mockTrack = track as jest.MockedFunction<typeof track>

/** 当前视口宽度（供垫片里的 matchMedia 判断），单位 px */
let viewportWidth = 390

/**
 * 最小 window 垫片（node 环境无 window）。matchMedia 真的解析 `(min-width: Npx)` 再比 ——
 * 顺带把「模块问的是哪条断点线」也钉住：写死返回 true/false 就测不出断点被人改坏。
 */
const windowShim: { matchMedia?: (q: string) => { matches: boolean } } = {
  matchMedia: (query: string) => {
    const m = /\(min-width:\s*(\d+)px\)/.exec(query)
    return { matches: m ? viewportWidth >= Number(m[1]) : false }
  },
}
;(globalThis as unknown as { window: typeof windowShim }).window = windowShim

/** 切到手机宽度（lg 断点以下）。 */
function useMobileViewport(): void { viewportWidth = 390 }
/** 切到桌面宽度（lg = 1024px 及以上）。 */
function useDesktopViewport(): void { viewportWidth = 1280 }

/** 取历次上报的 props（= 实际发出去的内容） */
function trackedTabs(): unknown[] {
  return mockTrack.mock.calls.map((c) => c[1])
}

beforeEach(() => {
  jest.clearAllMocks()
  windowShim.matchMedia = (query: string) => {
    const m = /\(min-width:\s*(\d+)px\)/.exec(query)
    return { matches: m ? viewportWidth >= Number(m[1]) : false }
  }
  // 去重状态是模块级的（刻意的，见 lib/tab-view 顶注），用例之间必须清干净：
  // 传 null 即复位，不需要给测试开后门。
  useMobileViewport()
  reportTabView(null, 'mobile')
  jest.clearAllMocks()
})

describe('内部 tab 标识 → TabId 映射（写反了看板上永远看不出来）', () => {
  test.each<[LibraryDesktopTab, TabId]>([
    ['cards',   'library_cards'],
    ['phrases', 'library_words'],
    ['pron',    'library_pron'],
    ['stories', 'library_stories'],
  ])('桌面素材库 %s → %s', (tab, expected) => {
    expect(toLibraryDesktopTabId(tab)).toBe(expected)
  })

  test.each<[LibraryMobileView, TabId | null]>([
    ['cards',   'library_cards'],
    ['words',   'library_words'],
    ['pron',    'library_pron'],
    ['stories', 'library_stories'],
    ['hub',     null],
  ])('移动素材库 %s → %s', (view, expected) => {
    expect(toLibraryMobileTabId(view)).toBe(expected)
  })

  test.each<[QuestionBankTab, TabId]>([
    ['维度设计', 'qbank_dimension'],
    ['题目列表', 'qbank_list'],
  ])('题库 %s → %s（中文串只在这里出现，绝不上报）', (tab, expected) => {
    expect(toQuestionBankTabId(tab)).toBe(expected)
  })

  test('🔴 桌面 phrases 与移动 words 是同一个 tab，必须落同一格', () => {
    expect(toLibraryDesktopTabId('phrases')).toBe(toLibraryMobileTabId('words'))
    expect(toLibraryDesktopTabId('phrases')).toBe('library_words')
  })

  test('六个 TabId 全部有来路（漏一个 = 那个功能的浏览永远记不到）', () => {
    const covered = new Set<TabId | null>([
      toLibraryDesktopTabId('cards'), toLibraryDesktopTabId('phrases'),
      toLibraryDesktopTabId('pron'), toLibraryDesktopTabId('stories'),
      toQuestionBankTabId('维度设计'), toQuestionBankTabId('题目列表'),
    ])
    expect([...covered].sort()).toEqual([...TAB_ID].sort())
  })
})

describe('白名单外的值一律不上报（不造 other 假桶）', () => {
  test.each(['', 'phrase', 'Cards', 'cards ', 'words', 'hub', '题目列表'])(
    '桌面素材库的非法值 %s → null',
    (bad) => {
      expect(toLibraryDesktopTabId(bad as LibraryDesktopTab)).toBeNull()
    },
  )

  test.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    '原型链 key %s → null（直接查对象会返回一个函数当 TabId 送出去）',
    (proto) => {
      expect(toLibraryDesktopTabId(proto as LibraryDesktopTab)).toBeNull()
      expect(toLibraryMobileTabId(proto as LibraryMobileView)).toBeNull()
      expect(toQuestionBankTabId(proto as QuestionBankTab)).toBeNull()
    },
  )

  test('非法值走到 reportTabView 也一条都不发', () => {
    reportTabView(toLibraryDesktopTabId('nope' as LibraryDesktopTab), 'mobile')
    expect(mockTrack).not.toHaveBeenCalled()
  })
})

describe('去重（模块级，卸载重挂也有效）', () => {
  test('同一个 tab 连续上报只发一条，props 只有 tab 一个字段', () => {
    reportTabView('library_cards', 'mobile')
    reportTabView('library_cards', 'mobile')
    reportTabView('library_cards', 'mobile')
    expect(mockTrack).toHaveBeenCalledTimes(1)
    expect(mockTrack.mock.calls[0][0]).toBe('page.tab_view')
    expect(mockTrack.mock.calls[0][1]).toEqual({ tab: 'library_cards' })
  })

  test('切走再切回来算新的一次（cards → words → cards 记三条）', () => {
    reportTabView('library_cards', 'mobile')
    reportTabView('library_words', 'mobile')
    reportTabView('library_cards', 'mobile')
    expect(trackedTabs()).toEqual([
      { tab: 'library_cards' }, { tab: 'library_words' }, { tab: 'library_cards' },
    ])
  })

  test('移动端 hub（null）复位去重：进 cards → 退回 hub → 再进 cards 记两条', () => {
    reportTabView('library_cards', 'mobile')
    reportTabView(null, 'mobile')            // 退回 hub，不上报
    reportTabView('library_cards', 'mobile')
    expect(trackedTabs()).toEqual([{ tab: 'library_cards' }, { tab: 'library_cards' }])
  })
})

describe('断点闸（两套 UI 同时挂载，被藏起来的那棵不许出声）', () => {
  test('手机视口下：桌面树一条都不发，移动树正常发', () => {
    useMobileViewport()
    reportTabView('library_cards', 'desktop')
    expect(mockTrack).not.toHaveBeenCalled()
    reportTabView('library_pron', 'mobile')
    expect(trackedTabs()).toEqual([{ tab: 'library_pron' }])
  })

  test('桌面视口下：移动树一条都不发，桌面树正常发', () => {
    useDesktopViewport()
    reportTabView('library_stories', 'mobile')
    expect(mockTrack).not.toHaveBeenCalled()
    reportTabView('qbank_dimension', 'desktop')
    expect(trackedTabs()).toEqual([{ tab: 'qbank_dimension' }])
  })

  test('🔴 不可见的那棵树连去重状态都不许碰（否则可见树的那条会被它顶掉）', () => {
    useDesktopViewport()
    reportTabView('library_cards', 'desktop')     // 桌面可见，发一条
    reportTabView(null, 'mobile')                 // 移动树报 hub —— 若它清了状态，下一条会重复发出
    reportTabView('library_cards', 'desktop')     // 仍是同一个 tab，不该再发
    expect(trackedTabs()).toEqual([{ tab: 'library_cards' }])
  })

  test('matchMedia 缺失（极老/异常环境）时按 mobile 记，桌面树静默', () => {
    delete windowShim.matchMedia
    reportTabView('qbank_list', 'desktop')
    expect(mockTrack).not.toHaveBeenCalled()
    reportTabView('qbank_list', 'mobile')
    expect(trackedTabs()).toEqual([{ tab: 'qbank_list' }])
  })
})
