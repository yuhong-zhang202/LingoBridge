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
import type { ClientEventName, ServerOnlyEventName } from './event-schema'

/**
 * 内测埋点事件名 = 客户端可上报的事件 + 服务端自发的事件，两者均派生自【唯一真源】lib/event-schema.ts
 * （新增事件名先改那里，本文件不再手抄；改哪几处、哪些漏改会静默丢数据，见该文件顶注）。
 * 0018 建 3 个 + 0050 增 match.question_opened；0053 起 DB 的 event CHECK 由枚举白名单放宽为前缀正则，
 * 故【本联合类型 + /api/events 的分发表】才是事件名的真闸。
 *
 * ⚠️⚠️ flow.capture_abandoned【永久禁止做任何比率的分子】——只能当归因样本用；
 * 完整理由与「放弃率的唯一正确口径」写在 event-schema.ts 的同名条目上方，动它之前必读那段。
 */
export type FlowEventName = ClientEventName | ServerOnlyEventName

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
  /**
   * 是否为 QA 流量（产品方自测），缺省 false。取值一律走 isQaRequest()。
   * ⚠️ 纯统计列：离线算漏斗时据此剔除自测流量。永久禁止用于额度 / 权限 / 计费 / RLS 判定
   * —— 它的一半来源是客户端可携带的请求头，可伪造。
   */
  isQa?: boolean
}

/**
 * story_id 列是 uuid 类型：非 UUID 形态的值会让 insert 撞 22P02，被下面的 catch 静默吞掉 ——
 * 表现为「埋点在跑、这条事件零数据」，页面上一点异常都看不出来。故入库前收敛为 null。
 */
const STORY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/**
 * flow_id 是【客户端可控】的请求头（X-Flow-Id），而 flow_id 列是无上限的 text：
 * 实测已被灌进 4013 字符的值，配合 /api/events 无限流 = 每请求可写 16KB 垃圾（正常 id 仅 36 字节）。
 * ⚠️ 白名单必须容得下自家格式：newFlowId() 产出 crypto.randomUUID() 或 `base36-base36`
 * （形如 msc7vzqp-t8m2dn96），【不是】标准 UUID —— 用 UUID 正则会把正常流程全误杀。
 */
const FLOW_ID_RE = /^[A-Za-z0-9._-]{1,64}$/

/**
 * 收敛一个 id 形态字段：命中白名单才原样返回，其余（含空串 / 超长 / 脏值）一律 null。
 * 一处收口 —— 四个调用点一行不用改，也不会有人漏加校验。
 * @param  v   原始值（可能来自客户端头 / URL 深链）
 * @param  re  该字段的形态白名单
 * @returns    合法值或 null
 */
function safeId(v: string | null | undefined, re: RegExp): string | null {
  return typeof v === 'string' && re.test(v) ? v : null
}

/**
 * 将一条埋点事件写入 flow_events 表。
 * flowId / storyId 入库前按形态白名单收敛（脏值置 null，不拒整条事件：宁可少一个 join key，
 * 也不能让整条事件因一个脏字段消失 —— 那正是最难查的「埋点全在跑、库里零数据」）。
 * @param  e  事件数据
 * @returns   Promise<void>，写入失败静默处理（只 console.error，绝不阻断主链路）
 * @sideEffect 用 service_role 向 flow_events insert 一行（绕 RLS，无需 session）
 */
export async function logEvent(e: FlowEvent): Promise<void> {
  try {
    const { error } = await getSupabaseServer().from('flow_events').insert({
      event:    e.event,
      flow_id:  safeId(e.flowId, FLOW_ID_RE),
      story_id: safeId(e.storyId, STORY_ID_RE),
      user_id:  e.userId ?? null,
      props:    e.props ?? {},
      is_qa:    e.isQa ?? false,
    })
    if (error) throw error
  } catch (err) {
    console.error('[Events] failed to write flow event', err)
  }
}
