/**
 * @module   matching-inflight
 * @desc     【仅服务端】按语料的匹配整跑单飞 —— 同一条语料的整链 AI 匹配正在飞时，后到的请求
 *           复用同一趟，不再发第二趟模型调用（萃取 + 重排两次 qwen-plus）。
 *
 *           【为什么要它】生产实测（2026-08-06 审计 P1-3）：131 个跑过匹配的语料里 4 个跑了两趟，
 *           其中 3 次确认是并发而非重试 —— 两趟相隔 0.25s / 6.8s / 14.5s，**均小于单趟耗时**。
 *           成因是快照的「读」与「写」之间没有锁：第二个请求进来时第一趟还没写档，读档必然未命中，
 *           于是各跑各的。单价不高（约 ¥0.0085/次），但两趟同时跑 = 两倍并发 + 两倍长请求占用，
 *           扩量后是放大器。
 *
 *           【范式沿用】进程内单飞与 supabase.ts 的 ensureSession 同款，两个必守点一字不差：
 *             · 成功/失败都要清槽位（失败不清 = 一次抖动让这条语料永久返回那个失败的 Promise）；
 *             · 清之前判身份（`runs.get(key) === run`），防的是「本次槽位已被后来者覆盖」的极端交错。
 *           比 ensureSession 多出的一件事是**事件扇出**：流式路要把同一趟的 meta/question 帧分给
 *           两个订阅者，故带一个回放缓冲（晚到者先补齐已发生的，再续收后续增量）——
 *           与客户端的 analysis-inflight「晚订阅者回放」是同一套思路。
 *
 *           【键为什么是 corpusId + storyHash，而不是只有 corpusId】
 *           正文若在两次请求之间被改写（用户重新整理故事），两个请求的 cleanedText 就不是同一份，
 *           只按 corpusId 复用会把 A 的结果当成 B 的结果、并按 B 的 hash 写进快照 —— 存档内容与
 *           story_hash 从此对不上，且这种脏档会被后续读档命中、长期返回错的题。加 hash 天然隔离，
 *           且不损失任何去重效果（真并发的两个请求读到的必是同一份正文）。
 *
 *           【失败语义：跟着 leader 一起失败，不各自重跑】
 *             · 匹配失败的绝大多数原因是上游 qwen 抖动/超时/限流，此时「follower 自己再跑一次」正好在
 *               系统最脆弱的时刻把调用量翻倍 —— 那正是本模块要消灭的放大器；
 *             · follower 在现实中几乎总是**同一个人**的重复请求（corpus 归属唯一、路由前置 assertCorpusOwner），
 *               所以「一次抖动害两个用户一起失败」这句在本场景基本不成立；
 *             · 槽位在 settle 时即清，**下一次**请求一定是全新一趟，绝不会拿到已失败的陈旧 Promise；
 *               前端本就有「error 帧 → 降级 ?stream=0 → 用户重试」的出口，重试即新一趟。
 *
 *           【不设兜底 TTL】本模块内每一次等待都是有界的：两次 LLM 调用各自 30s 超时（llm.ts 默认），
 *           故 Promise 必定 settle、槽位必定被清。真出现永不 settle 的极端情况时，follower 与 leader
 *           等待时长相同（不会更糟），由平台的请求超时兜底。
 *
 *           ⚠️【进程内 = 只挡同实例】多实例部署时各进程各一份表，跨实例的并发挡不住；
 *           它也挡不住「上一趟已结束、快照还没写完」的时间差重发。见交付说明的残留风险。
 * @author   LingoBridge
 * @created  2026-08-12
 */
import 'server-only'

import type { FunnelStreamMeta } from '@/services/matching'
import type { FunnelMatchResult, FunnelMatchedQuestion } from '@/lib/types'

/**
 * 一趟匹配的增量事件订阅口（与 MatchUsageSink 的同名回调形状一致，接口层直接拿来发 SSE 帧）。
 * 阻塞路（?stream=0）不关心增量，传空对象即可。
 */
export interface MatchRunEvents {
  /** 漏斗召回定案（重排开始前）触发一次 */
  onMeta?: (meta: FunnelStreamMeta) => void
  /** 单题富化完成即触发一次 */
  onItem?: (q: FunnelMatchedQuestion) => void
}

/** 已发生的增量事件（按发生序缓冲，供晚到的订阅者原序回放） */
type ReplayEvent =
  | { kind: 'meta'; meta: FunnelStreamMeta }
  | { kind: 'item'; item: FunnelMatchedQuestion }

/** 一次 runMatchOnce 的结果 + 本次请求在这趟里的角色 */
export interface MatchRunOutcome {
  result: FunnelMatchResult
  /**
   * true = 本次请求是**发起者**，真跑了模型 —— 后置的留档/写快照/usage 记账全归它；
   * false = 本次请求**搭上了**别人在飞的那趟，零 AI 成本 —— 绝不可再记一份 usage（那是记一笔没花的钱）。
   */
  leader: boolean
}

interface Run {
  promise: Promise<FunnelMatchResult>
  replay: ReplayEvent[]
  subscribers: Set<MatchRunEvents>
}

/** 在飞的匹配趟次表（进程内，键见 matchRunKey） */
const runs = new Map<string, Run>()

/**
 * 单飞键：语料 id + 正文哈希（为什么带哈希见模块顶注）。
 * @param corpusId   语料 id
 * @param storyHash  整理后正文的 sha256（与写快照用的是同一个值）
 * @returns          单飞表的键
 */
export function matchRunKey(corpusId: string, storyHash: string): string {
  return `${corpusId}::${storyHash}`
}

/**
 * 把一个事件投递给一个订阅者。
 * 订阅者回调抛出的异常**一律吞掉**：订阅者多半是一条已断连的 SSE 流，它的 enqueue 失败绝不能顺着
 * onItem 回灌进重排循环，把整趟（连同另一个还活着的订阅者）一起弄挂。
 */
function deliver(target: MatchRunEvents, e: ReplayEvent): void {
  try {
    if (e.kind === 'meta') target.onMeta?.(e.meta)
    else target.onItem?.(e.item)
  } catch {
    /* 单个订阅者出错不拖垮整趟 */
  }
}

/**
 * 跑一趟匹配，或搭上同键正在飞的那趟。
 *
 * @param key     单飞键（用 matchRunKey 生成）
 * @param events  本次请求的增量事件订阅口（流式路传发帧回调；阻塞路传 {}）
 * @param start   真正干活的一趟（仅 leader 会被调用）；参数是扇出用的事件出口，
 *                调用方需把它并进传给 matchByStory 的 MatchUsageSink
 * @returns       匹配结果 + 本次是否为 leader
 * @sideEffect    leader 会执行 start（两次 qwen-plus 调用）；表内槽位在 settle 后清除
 */
export async function runMatchOnce(
  key: string,
  events: MatchRunEvents,
  start: (emit: MatchRunEvents) => Promise<FunnelMatchResult>,
): Promise<MatchRunOutcome> {
  const existing = runs.get(key)
  if (existing) {
    // ⚠️ 回放 + 登记这两步之间【绝不许有 await】：JS 单线程下同步完成才能保证
    // 「回放期间不会有新事件插进来」，否则晚到者会漏事件或收到乱序帧。
    for (const e of existing.replay) deliver(events, e)
    existing.subscribers.add(events)
    try {
      return { result: await existing.promise, leader: false }
    } finally {
      existing.subscribers.delete(events)
    }
  }

  const replay: ReplayEvent[] = []
  const subscribers = new Set<MatchRunEvents>([events])
  /** 扇出：记进回放缓冲 + 投递给当下所有订阅者（含 leader 自己）。 */
  const fanout = (e: ReplayEvent): void => {
    replay.push(e)
    for (const s of [...subscribers]) deliver(s, e)
  }
  const emit: MatchRunEvents = {
    // meta 是 matchByStory 现场构造、之后不再改的对象，可直接共享。
    onMeta: (meta) => fanout({ kind: 'meta', meta }),
    // question 则相反：matchByStory 是在【同一个题对象上】就地回填 relevanceScore/Reason 的，
    // 存进回放缓冲必须浅拷一份，否则晚到者回放的是「后来又被改过」的那个对象。
    onItem: (q) => fanout({ kind: 'item', item: { ...q } }),
  }

  const pending = start(emit)
  const run: Run = { promise: pending, replay, subscribers }
  runs.set(key, run)
  try {
    return { result: await pending, leader: true }
  } finally {
    // 成功/失败都要清（失败不清 = 这条语料永久返回那个失败的 Promise）；
    // 判身份只清自己那次，防「本次槽位已被后来者覆盖」的极端交错（同 ensureSession）。
    if (runs.get(key) === run) runs.delete(key)
  }
}

/**
 * 清空在飞表。**仅供测试**在用例之间隔离残留（生产路径靠 runMatchOnce 的 finally 自清）。
 * @sideEffect  清表只影响「未来的请求不再复用这些趟」，已在等待的请求照常拿到各自的结果
 */
export function __resetMatchInflightForTest(): void {
  runs.clear()
}
