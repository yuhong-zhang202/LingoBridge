/**
 * @module   api-logger
 * @desc     记录第三方 API 调用的用量与费用到 api_usage_logs 表；写入失败只告警不阻断主流程
 * @author   LingoBridge
 * @created  2026-06-04
 */

import { getSupabase, ensureSession } from './supabase'
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
 * @sideEffect  向 Supabase api_usage_logs 表 insert 一行；失败时 console.error
 */
export async function logApiUsage(log: ApiUsageLog): Promise<void> {
  try {
    await ensureSession()
    const supabase = getSupabase()
    const { error } = await supabase.from('api_usage_logs').insert(log)
    if (error) throw error
    console.log('[ApiLogger] logged', {
      service: log.service,
      endpoint: log.endpoint,
      cost: log.estimated_cost_cny,
    })
  } catch (err) {
    console.error('[ApiLogger] failed to write usage log', err)
  }
}
