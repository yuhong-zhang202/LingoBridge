/**
 * @module   events
 * @desc     【仅服务端】内测埋点事件写入 flow_events 表 —— 全链路留痕：观察点分布、假空率、
 *           「真实故事数」这个分母、以及「服务端给了什么 vs 用户真看到什么」。
 *           用 service_role 写库（绕 RLS）：flow_events 无客户端 insert 策略，写入唯一入口收归服务端，
 *           杜绝客户端会话灌水污染统计（照 api-logger 同款防线，见 0014_tighten_rls）。
 *
 *   隐私：事件字段一律【不含故事原文】——只存观察点 code（如 REL_06）、布尔、计数、id。
 *   第一周只出裸计数与分布、不设任何阈值；所有比率的分母用系统外的量（故事/会话/用户数），
 *   不用模型输出能控制的量（如候选题数）。
 *
 * @author   LingoBridge
 * @created  2026-07-17
 */
import 'server-only'
import { getSupabaseServer } from './supabase-server'

/** 内测埋点事件名（与 0018_flow_events.sql 的 check 约束一致） */
export type FlowEventName = 'match.result' | 'flow.corpus_bound' | 'match.view_rendered'

/** 一条埋点事件；props 仅承载计数/布尔/code，绝不放原文 */
export interface FlowEvent {
  event: FlowEventName
  /** 全链路标识（建语料前的环节靠它 join）；无则 null */
  flowId?: string | null
  /** corpus.id；建语料后各环节的主 join key */
  storyId?: string | null
  /** 触发用户 id */
  userId?: string | null
  /** 事件专属字段（计数 / 布尔 / 观察点 code），不含原文 */
  props?: Record<string, unknown>
}

/**
 * 将一条埋点事件写入 flow_events 表。
 * @param  e  事件数据
 * @returns   Promise<void>，写入失败静默处理（只 console.error，绝不阻断主链路）
 * @sideEffect 用 service_role 向 flow_events insert 一行（绕 RLS，无需 session）
 */
export async function logEvent(e: FlowEvent): Promise<void> {
  try {
    const { error } = await getSupabaseServer().from('flow_events').insert({
      event:    e.event,
      flow_id:  e.flowId ?? null,
      story_id: e.storyId ?? null,
      user_id:  e.userId ?? null,
      props:    e.props ?? {},
    })
    if (error) throw error
  } catch (err) {
    console.error('[Events] failed to write flow event', err)
  }
}
