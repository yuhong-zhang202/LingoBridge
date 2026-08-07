/**
 * @module   api-logger
 * @desc     【仅服务端】记录第三方 API 调用的用量与费用到 api_usage_logs 表；写入失败只告警不阻断主流程。
 *           用 service_role 写库（绕 RLS）：0014 删掉了 api_usage_logs 的客户端 insert 策略，
 *           日志写入唯一入口收归服务端，杜绝任何客户端会话灌水污染成本看板。
 *
 *   ⚠️ 每条记录都必须带 is_qa（0059 补列，ApiUsageLog 里是【必填】字段）：产品方自测流量剔不掉，
 *   成本数字就永远掺着不可知的水分。取值一律走 isQaRequest(req, userId)（src/lib/qa-traffic.ts 是唯一入口），
 *   失败记账（status:'error'）同样要带 —— 失败也烧钱（ASR 调失败照样计费），漏了等于自测的失败成本仍混在里面。
 *   该标记可伪造，**永久禁止**用于额度/权限/计费/RLS 判定，只可写入统计列。
 * @author   LingoBridge
 * @created  2026-06-04
 */
import 'server-only'

import { getSupabaseServer } from './supabase-server'
import type { ApiUsageLog } from './types'

/** 各服务单价（人民币），供各 route 计算 estimated_cost_cny */
export const API_PRICING = {
  doubao_asr_per_second: 0.003,          // ¥0.003/秒
  qwen_flash_per_1k_tokens: 0.0008,      // ¥0.0008/千token
  qwen_plus_input_per_1m:   0.8,          // ¥0.0008/千 × 1000 = ¥0.8/百万token（输入）
  qwen_plus_output_per_1m:  2.0,          // ¥0.002/千  × 1000 = ¥2.0/百万token（输出）
} as const

/**
 * qwen-plus 一次调用的费用（人民币）：输入/输出 token 分开计价。
 * 抽成单一入口，杜绝各 route 各写一份公式导致口径漂移（成本看板系统性偏差的病根之一）。
 * @param promptTokens      输入 token 数（真实或估算）
 * @param completionTokens  输出 token 数（真实或估算）
 * @returns                 估算费用（人民币）
 */
export function qwenPlusCostCny(promptTokens: number, completionTokens: number): number {
  return (
    (promptTokens / 1_000_000) * API_PRICING.qwen_plus_input_per_1m +
    (completionTokens / 1_000_000) * API_PRICING.qwen_plus_output_per_1m
  )
}

/**
 * 将一条 API 用量记录写入 api_usage_logs 表
 * @param  log  用量数据，字段定义见 ApiUsageLog
 * @returns     Promise<void>，写入失败静默处理
 * @sideEffect  用 service_role 向 api_usage_logs 表 insert 一行（绕 RLS，无需 session）；失败时 console.error
 */
export async function logApiUsage(log: ApiUsageLog): Promise<void> {
  try {
    const { error } = await getSupabaseServer().from('api_usage_logs').insert(log)
    if (error) throw error
  } catch (err) {
    console.error('[ApiLogger] failed to write usage log', err)
  }
}
