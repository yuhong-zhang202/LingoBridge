'use client'
/**
 * @module   dashboard/anchor
 * @desc     看板结论条（及「该我们修」下钻）的锚点跳转工具：展开落点途经的全部 <details> →
 *           滚动到落点 → 把焦点移到落点（tabIndex=-1 的包裹元素）。「不能只滚动」是方案 §二的硬要求：
 *           键盘/读屏用户滚过去了焦点还留在结论条上，等于没跳。
 *           纯 DOM 操作、无状态：直接改 details.open 与 React 不冲突——各折叠区的 open 走
 *           「惰性 useState 只算一次」模式（值终身不变），React diff 恒等、不会回写覆盖这里的展开。
 *           （DOM 副作用工具，node 环境单测不可达，正确性由真机验收覆盖。）
 * @author   LingoBridge
 * @created  2026-08-04
 */

/**
 * 跳到某个锚点：先展开途经折叠区，再滚动 + 移焦。
 * @param anchorId   落点元素 id（元素须带 tabIndex={-1} 以接受编程式焦点）
 * @sideEffect       打开落点的全部祖先 <details> 与落点内的首个 <details>；滚动页面；移动焦点
 */
export function jumpToAnchor(anchorId: string): void {
  const el = document.getElementById(anchorId)
  if (!el) return
  // 祖先链上的折叠区全部展开（落点可能在收起的区里，不展开滚过去也看不见）
  let details = el.closest('details')
  while (details) {
    details.open = true
    details = details.parentElement?.closest('details') ?? null
  }
  // 落点自身是包着折叠区的包裹元素时（如反馈区、钱区的锚点包裹），展开其内的首个折叠区
  const inner = el.querySelector('details')
  if (inner) inner.open = true
  // 先移焦（preventScroll）再平滑滚动：反过来 focus 的默认滚动会打断 smooth 滚动
  el.focus({ preventScroll: true })
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
