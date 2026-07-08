/**
 * @module   search
 * @desc     素材库搜索通用工具 —— 字段无关：调用方用 getText 拼接可搜文本，本模块负责大小写不敏感匹配 +
 *           无结果空状态文案（回显并截断搜索词）。与 useSelectMode 的 filterFn 配合。
 * @author   LingoBridge
 * @created  2026-07-08
 */

/**
 * 由搜索词构造一个 filterFn（喂给 useSelectMode）。空词返回 undefined = 不过滤。
 * @param query    搜索词
 * @param getText  从一条数据取可搜文本（拼接多字段）
 * @returns        (item) => boolean，或空词时 undefined
 */
export function makeSearchFilter<T>(query: string, getText: (item: T) => string): ((item: T) => boolean) | undefined {
  const q = query.trim().toLowerCase()
  if (!q) return undefined
  return (item: T) => getText(item).toLowerCase().includes(q)
}

/**
 * 搜索无结果空状态标题（回显搜索词，超长截断防破坏布局）
 * @param query  搜索词
 * @returns      如 没有找到 "xxx" 的相关内容
 */
export function searchEmptyTitle(query: string): string {
  const q = query.trim()
  const shown = q.length > 20 ? `${q.slice(0, 20)}…` : q
  return `没有找到 "${shown}" 的相关内容`
}
