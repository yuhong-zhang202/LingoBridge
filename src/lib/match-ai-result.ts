/**
 * @module   match-ai-result
 * @desc     匹配接口的失败响应 → flow.ai_call 结局枚举的映射（客户端埋点用），外加服务端要回传的
 *           机器可读码 CORPUS_EMPTY_CODE。前后端共用一份，两头拼字符串必然漂移。
 *
 *   【为什么要单独有这一段】/api/matching 的 400 有两种截然不同的成因：
 *     · corpusId 为空 / 不合法 —— 真·输入错，责任在调用方；
 *     · 语料在库里【没有正文】—— 用户明明讲过故事，是 cleaned_text 被写空了，责任在【我们】。
 *   两者过去都被记成 `bad_input_400`，而看板把 bad_input_400 归进「用户侧·输入不合格」
 *   （见 dashboard-flow-events 的 AI_RESULT_BUCKET）—— 也就是说我们自己的数据故障，
 *   会在看板上显示成「用户输入不合格」。**指错责任方比不报还坏**：量不大时会被当噪音略过。
 *
 *   ⚠️【只是加了一个值，不是改语义】历史的 bad_input_400 行一律不动、不迁移、不回填。
 *
 *   ⚠️【纯前后端共用逻辑】禁止 import 'server-only'、禁止引用任何 server 模块
 *   —— 本文件被 'use client' 的匹配页直接引用。
 *
 * @author   LingoBridge
 * @created  2026-08-27
 */
import type { AiResult } from './event-schema'

/**
 * 「这份语料在库里没有正文」的机器可读码，随 400 响应体一起回。
 * 值刻意不带 400 后缀：它是【原因码】，与埋点结局枚举 'corpus_empty_400'（原因 + 状态码）分属两层。
 */
export const CORPUS_EMPTY_CODE = 'corpus_empty'

/**
 * 把一次失败的匹配响应翻译成 flow.ai_call 的结局枚举。
 *
 * 🔴【响应体只读一次】本函数一律读 `res.clone()`：匹配页那段代码周围有「流式失败 → 降级重发
 * `?stream=0`」的分支，同一个 Response 在别处可能已被/将被读走。读原体会在某条路径上抛
 * `Body is unusable`，而那条路径恰恰是失败路径 —— 埋点把主链路搞挂是绝不可接受的。
 * 解析失败（非 JSON / 空体 / 已被消费）一律静默回退到按状态码分类，绝不抛。
 *
 * @param  res  已知 !res.ok 的响应（本函数不判 ok，调用方自己判）
 * @returns     结局枚举；400 依 code 分流，其余按状态码归类
 */
export async function aiResultFromFailedResponse(res: Response): Promise<AiResult> {
  if (res.status === 401) return 'auth_401'
  if (res.status >= 500) return 'server_5xx'
  if (res.status !== 400) return 'other'
  let code: unknown
  try {
    code = ((await res.clone().json()) as { code?: unknown }).code
  } catch {
    // 读不出来就当普通输入错：宁可少认一个 corpus_empty，也不能因为埋点解析把失败路径变成崩溃
    return 'bad_input_400'
  }
  return code === CORPUS_EMPTY_CODE ? 'corpus_empty_400' : 'bad_input_400'
}
