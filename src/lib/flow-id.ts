/**
 * @module   flow-id
 * @desc     客户端「全链路 flow_id」—— 贯穿一次故事流程（录音/文字提交 → 转写 → 整理 → 建语料）的标识。
 *           story_id（corpus.id）要到「建语料」那一步才诞生，此前各环节（ASR / 整理）没有稳定 join key，
 *           全靠 flow_id 串起来；建语料时经 flow.corpus_bound 事件把 flow_id ↔ story_id 接上。
 *
 *   透传走 X-Flow-Id 请求头（见 api-client.ts），存 sessionStorage（同 tab 内导航保留）——
 *   **绝不进 URL query / URL**：既避免历史/上报工具沾上标识，也绕开「用户可见变更」的停机规则。
 *
 * @author   LingoBridge
 * @created  2026-07-17
 */

const KEY = 'lingobridge:flow_id'

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 开启一次新流程：生成并覆盖 flow_id。仅在故事入口（录音结束提交 / 文字提交）起点调用，
 * 保证一次流程一个 id、不与上一次串味。服务端环境（无 window）返回空串。
 * @returns 新生成的 flow_id
 */
export function newFlowId(): string {
  if (typeof window === 'undefined') return ''
  const id = randomId()
  sessionStorage.setItem(KEY, id)
  return id
}

/**
 * 清除当前 flow_id。登出时必须调用：sessionStorage 是按 tab 存的、不随登出自动清，
 * 同一 tab 内 A 登出 B 登录后，B 的请求会一直带着 A 遗留的 flow_id，直到 B 开新流程才被覆盖 ——
 * 漏斗正是靠 flow_id 串环节的，会串错人。
 * @returns 无
 * @sideEffect 删除 sessionStorage 里的 flow_id（无 window 时空转）
 */
export function clearFlowId(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(KEY)
}

/**
 * 读当前 flow_id（供 apiFetch 注入 X-Flow-Id 头）。无则返回空串（服务端环境亦空）。
 * @returns 当前 flow_id 或 ''
 */
export function currentFlowId(): string {
  if (typeof window === 'undefined') return ''
  return sessionStorage.getItem(KEY) ?? ''
}
