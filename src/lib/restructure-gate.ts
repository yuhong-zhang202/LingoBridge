/**
 * @module   restructure-gate
 * @desc     /api/restructure 响应的【分支判定唯一真源】—— 语音路径（useVoiceStorySubmit）与
 *           文字路径（useStorySubmit）共用这一份，把「拿到 Response → 该怎么走」收敛成一次判定。
 *
 *   【为什么必须只有一份】这里装的不是逻辑，是**同一个接口的同一组分支**
 *   （402 额度 / 403 同意闸 / ok+usable / ok+不可用 / 其他失败放行），此前两条路径各写了一份。
 *   为此已经付过一次学费：commit 28d5e95 补的正是「语音路径漏记了 restructure 的 ai_call」——
 *   同一个接口在语音路径失败时无痕、在文字路径失败时有痕，两条路径的失败率没法横向比。
 *   而这种分叉的表现是数据上「文字路径失败率比语音高」，**会被当成产品结论读**。
 *   收敛之后，服务端新增一个状态码只需改本文件一处，且两条调用路径的分支数被 action 联合类型强制同数。
 *
 *   【职责边界·刻意划死】本模块**只判定、不动作**：
 *     · 不发请求（只读传入的 Response）· 不碰 React · 不 track · 不跳转 · 不读写 handoff。
 *   埋点仍由调用方按返回的 { ai, httpStatus } 自己发（保持「谁调用谁埋点」）——因为两条路径的
 *   ai_call 还要各带各的 mode（voice / text）与各自的 latencyMs 起点，不属于判定的一部分。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
// AI 调用结局的取值域【来自 event-schema 这一份真源】，本文件不再手抄：
// 服务端 sanitize 遇到不认识的值是【静默丢弃】，打错一个字母就是「埋了但库里查不到」，本地永远测不出来。
import type { AiResult } from '@/lib/event-schema'

/** /api/restructure 成功（200）时的响应体 */
export interface RestructurePayload {
  /** 整理后的语料正文 */
  cleanedText: string
  /** 模型判定这段素材可不可用（false = 当 garbage 打回） */
  usable: boolean
  /** 一句话概括（服务端可能不返回） */
  summary?: string
}

/**
 * 判定结果：调用方该走的四条路之一 + 这一次 AI 调用的结局。
 *
 * action 的语义：
 *   · quota    匿名整理额度用尽（402）—— 不跳转，弹试用结束覆盖层
 *   · consent  服务端同意闸拒绝（403）—— 未捕获同意，回首页触发同意弹窗
 *   · garbage  服务端整理成功但判 usable=false —— 不跳转，toast 打回重写
 *   · proceed  放行去 /restructure。**两种子情形靠 payload 区分**：
 *              payload 非 null = 整理成功，把结果一并带走（restructure 页免二次整理调用）；
 *              payload 为 null = 整理失败但仍放行（「失败但放行」不是失败：ai_call 记失败码、
 *              capture_submitted 记 proceed，两者不矛盾），由 restructure 页兜底自行整理。
 */
export interface RestructureGate {
  action: 'quota' | 'consent' | 'garbage' | 'proceed'
  /** 这一次 /api/restructure 调用的结局，调用方拿去发 flow.ai_call（本模块自己不发） */
  ai: AiResult
  /** HTTP 状态码，进 flow.ai_call 的 httpStatus */
  httpStatus: number
  /** 整理结果；仅 action==='proceed' 且服务端整理成功时非 null（见 action 注释） */
  payload: RestructurePayload | null
}

/**
 * 把「非 402/403 的失败状态码」映射成 ai_call 的结局枚举。
 * 429/400/401 必须单列：压成 other 会让「日限撞了多少次」永远查不出来。
 * 三条打 /api/restructure 的路径（语音 / 文字 / restructure 页）口径必须一致，
 * 否则数据上会呈现「只有某一条路会撞日限」的假象。
 * @param  status  HTTP 状态码
 * @returns        ai_call 的 result 取值
 */
function classifyFailure(status: number): AiResult {
  if (status === 429) return 'rate_429'
  if (status === 400) return 'bad_input_400'
  if (status === 401) return 'auth_401'
  return status >= 500 ? 'server_5xx' : 'other'
}

/**
 * 判定一次 /api/restructure 的响应该怎么走。
 * @param  res  apiFetch('/api/restructure') 拿到的原始 Response
 * @returns     { action, ai, httpStatus, payload }，语义见 RestructureGate
 * @sideEffect  仅在 res.ok 时读一次 res.json()（会消费响应体）。**不发请求、不埋点、不跳转、不碰 React**。
 *              json 解析失败照常抛出 —— 两条调用路径原本就把它当网络失败（ai_call 记 network）兜住，
 *              在此吞掉反而会让「解析失败」伪装成一次成功整理。
 */
export async function evaluateRestructureResponse(res: Response): Promise<RestructureGate> {
  // 匿名整理额度用尽：必须先于通用失败分支拦下，否则只显示「整理失败」= 让撞上限的匿名用户以为是故障，
  // 反复重试仍失败 → 转化流失。
  if (res.status === 402) return { action: 'quota', ai: 'quota_402', httpStatus: 402, payload: null }
  // 服务端同意闸拒绝（未捕获同意）：该路由的 403 只可能是缺同意（CONSENT_REQUIRED）。
  if (res.status === 403) return { action: 'consent', ai: 'consent_403', httpStatus: 403, payload: null }
  if (res.ok) {
    const payload = (await res.json()) as RestructurePayload
    // httpStatus 固定记 200 而非 res.status：与两条路径的原实现逐字一致（该路由成功只会是 200），
    // 且成功这一格本就不需要区分 2xx 内部差别。
    return payload.usable
      ? { action: 'proceed', ai: 'ok', httpStatus: 200, payload }
      : { action: 'garbage', ai: 'ok', httpStatus: 200, payload: null }
  }
  // 其余失败一律【放行】，由 restructure 页兜底自行整理：用户已经讲完/写完，不该因为整理挂了就卡住。
  return { action: 'proceed', ai: classifyFailure(res.status), httpStatus: res.status, payload: null }
}
