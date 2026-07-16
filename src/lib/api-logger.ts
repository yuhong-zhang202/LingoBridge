/**
 * @module   api-logger
 * @desc     【仅服务端】记录第三方 API 调用的用量与费用到 api_usage_logs 表；写入失败只告警不阻断主流程。
 *           用 service_role 写库（绕 RLS）：0014 删掉了 api_usage_logs 的客户端 insert 策略，
 *           日志写入唯一入口收归服务端，杜绝任何客户端会话灌水污染成本看板。
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
  claude_sonnet_input_per_1m: 21.6,      // $3 × 7.2 汇率 = ¥21.6/百万token
  claude_sonnet_output_per_1m: 108,      // $15 × 7.2
  claude_haiku_input_per_1m: 1.8,        // $0.25 × 7.2
  claude_haiku_output_per_1m: 9,         // $1.25 × 7.2
} as const

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
