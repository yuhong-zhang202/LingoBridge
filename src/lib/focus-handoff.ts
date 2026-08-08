/**
 * @module   focus-handoff
 * @desc     删卡之后的「焦点交接」—— 算出焦点该落到哪张幸存的卡上。
 *
 *           为什么需要：卡片被删后整个节点从 DOM 消失，焦点跟着掉回 <body>。用鼠标的人完全无感；
 *           键盘 / 读屏用户则是「那个看不见的光标回到了整页最顶上」—— 想接着处理第 6 张卡，得从头
 *           Tab 一遍，删 3 个东西就从头走 3 遍。
 *
 *           单独抽成不碰 document 的纯函数，有两个原因：
 *           ① 本仓库 jest 跑在 node 环境、没有 DOM，逻辑留在组件里就只能靠读源码守，「落点挑错了」
 *              这类真 bug 一条也守不住；抽出来才测得到行为。
 *           ② 别的删除入口（如「我的语料」卡右上角那颗删除）将来要补时，直接复用同一套落点规则，
 *              不必各自再拍一遍脑袋。
 * @author   LingoBridge
 * @created  2026-08-08
 */

/**
 * 参与焦点交接的卡片根元素标记。
 * 带上它的元素必须自己可被程序化聚焦（`tabIndex={-1}`），否则 focus() 是空操作、焦点照样掉回 body。
 */
export const DELETE_ITEM_ATTR = 'data-delete-item'

/**
 * 挑出「删掉 current 之后，焦点该交给谁」
 * @param items     文档顺序排列的候选卡片（包含即将被删的 current 自己）
 * @param current   即将被删掉的那张卡
 * @param isVisible 可见性判定。素材库同一时刻页面上挂着移动版与桌面版两份列表（一份被 CSS 藏起来），
 *                  把焦点给到藏起来的那份等于焦点凭空消失，故必须过滤
 * @returns         下一张可见卡；没有下一张则退回上一张；一张都不剩返回 null（调用方保持原样、不抢焦点）
 *
 * 「没有下一张就退回上一张」而不是交给列表容器：上一张卡就在用户刚才操作的位置附近，比跳到容器顶部
 * 更接近他的心理位置；而列表容器要由各个列表组件自己加 tabIndex={-1}，跨四个调用方、其中两个正被
 * 别的分支占用。删掉最后一张（列表随即变空态）这一种情况仍会掉回 body —— 那时已经没有下一张卡要处理，
 * 代价只是听一句空态，权衡后接受。
 */
export function pickFocusTarget<T>(
  items: readonly T[],
  current: T,
  isVisible: (item: T) => boolean,
): T | null {
  const i = items.indexOf(current)
  // current 不在候选里说明标记没打上或列表已经变了，此时任何落点都是猜的，宁可不动
  if (i < 0) return null
  for (let j = i + 1; j < items.length; j++) {
    if (isVisible(items[j])) return items[j]
  }
  for (let j = i - 1; j >= 0; j--) {
    if (isVisible(items[j])) return items[j]
  }
  return null
}

/**
 * 元素是否真的渲染在页面上
 * @param el 待判定元素
 * @returns  有布局盒子（未被 display:none 的祖先藏起来、且已挂进文档）返回 true
 */
export function isRendered(el: Element): boolean {
  return el.getClientRects().length > 0
}
