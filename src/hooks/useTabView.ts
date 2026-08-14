/**
 * @module   useTabView
 * @desc     page.tab_view 的挂载点：把「当前停在哪个 tab」交给 lib/tab-view 去重并上报。
 *           四处 UI（素材库桌面/移动 + 题库桌面/移动）各调一次，逻辑本体全在 lib/tab-view.ts
 *           —— 这里只负责「在 effect 里、且只在 tabId 变化时」调它。
 *
 *   ⚠️ 依赖数组只有 [tabId, side]：父组件重渲染不该重报（同 PageViewTracker 只依赖 pathname）。
 *   ⚠️ 刻意【不写 cleanup】：卸载时不清去重状态。清了的话 StrictMode 的「挂载→清理→再挂载」
 *     会当场记两条（dev 每次进页面都双计），而去重状态本就该跨组件实例存活（见 lib/tab-view 顶注）。
 *     代价是「离开页面再回到同一个 tab」不再记一条 —— 这条口径写在 event-schema 的 TAB_ID 里。
 *
 * @author   LingoBridge
 * @created  2026-08-14
 */
'use client'
import { useEffect } from 'react'
import { reportTabView, type TabViewSide } from '@/lib/tab-view'
import type { TabId } from '@/lib/event-schema'

/**
 * tab 变化时上报一条 page.tab_view（默认 tab 在挂载时也报一条，口径见 TAB_ID）。
 * @param  tabId  当前 tab 的枚举值；null = 当前视图不上报（如移动端素材库的 hub）
 * @param  side   调用方属于哪一棵 UI 树（两套 UI 同时挂载，按断点闸掉不可见的那棵）
 * @returns       无
 * @sideEffect    见 reportTabView（fire-and-forget 上报，失败静默）
 */
export function useTabView(tabId: TabId | null, side: TabViewSide): void {
  useEffect(() => {
    reportTabView(tabId, side)
  }, [tabId, side])
}
