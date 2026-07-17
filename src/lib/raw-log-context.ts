/**
 * @module   raw-log-context
 * @desc     【仅服务端】原始留证的请求级上下文 —— 用 AsyncLocalStorage 把「当前请求属于哪个 user_id /
 *           哪段 corpus_id」隐式带到深处的 raw-log.ts 写入口，从而在【不改 service 层任何签名】的前提下，
 *           让 llm.ts / transcription.ts 里深埋的 appendRawLog 也能填对 user_id / corpus_id。
 *
 *   为什么用 ALS：留证是纯旁路。若靠函数参数把 userId 一路透传到 callLLMJson，会污染 extraction /
 *   ranking / analysis / practice 等一整排纯函数的契约——那正是本方案要死守避免的。ALS 让上下文
 *   在路由入口一包、深处一取，中间层零改动。
 *
 *   ⚠️ AsyncLocalStorage 依赖 Node.js 运行时（node:async_hooks），故只能被跑在 nodejs runtime 的
 *      API 路由使用；本项目七个命中 LLM/ASR 的路由均为 Node 运行时（无 edge 声明）。
 *
 * @author   LingoBridge
 * @created  2026-07-17
 */
import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

/** 单次请求的留证上下文：userId 恒有（匿名会话也有其 uid，取不到才 null）；corpusId 视路由而定。 */
export interface RawLogContext {
  userId: string | null
  corpusId?: string | null
}

// 模块级单例：runWithRawLogContext（路由入口写）与 getRawLogContext（raw-log.ts 深处读）必须共享同一实例。
const storage = new AsyncLocalStorage<RawLogContext>()

/**
 * 在给定留证上下文内执行 fn —— fn（及其 await 链）内任意深度调用 getRawLogContext 都能取到 ctx。
 * @param ctx  本次请求的 userId / corpusId
 * @param fn   路由处理逻辑（同步返回值或 Promise 都透传）
 * @returns    fn 的返回值原样透传
 */
export function runWithRawLogContext<T>(ctx: RawLogContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

/**
 * 取当前请求的留证上下文；不在任何 runWithRawLogContext 内（如后台任务）时返回 undefined。
 * @returns 当前上下文，或 undefined
 */
export function getRawLogContext(): RawLogContext | undefined {
  return storage.getStore()
}
