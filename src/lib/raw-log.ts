/**
 * @module   raw-log
 * @desc     统一「原始输出留证」入库层 —— LLM 调用与 ASR 转写共用【同一写入口、同一开关】，
 *           按 kind 分表落进 Supabase：LLM → llm_raw_logs，ASR → asr_raw_logs（见 migration 0020）。
 *           由 RAW_LOG_ENABLED 单一开关控制（env.rawLogEnabled，布尔，默认关）——关闭时直接 return。
 *
 *   2026-07-17 从本地 JSONL 文件搬到数据库表：当时按 Vercel serverless 规划，本地文件活不过
 *   一次冷启动、留证等于打水漂（注：生产后改为 Zeabur 常驻进程，但入库仍是对的方向）；
 *   入库后才谈得上持久化、删除权、30 天过期（GC 见 0020 的 pg_cron）。
 *   两条铁律一字未变：① 开关关 → 直接 return；② 写失败只 console.warn、绝不影响主链路。
 *
 *   ⚠️ 这里落库的是【用户故事原文 / 语音转写原文】——LLM 记录的 messages 是完整 prompt，
 *      ASR 记录的 transcript 是原始语音转成的文字。就是最敏感的真实用户数据。
 *      安全性靠三道闸：RAW_LOG_ENABLED 默认关（生产由产品方显式置 1）、表 RLS「无策略即默认拒绝」
 *      收归 service_role 唯一入口、pg_cron 30 天过期兜底。
 *
 *   user_id / corpus_id 从请求级 AsyncLocalStorage 上下文（raw-log-context）取——由此在【不改
 *   service 层任何签名】的前提下，让深埋的 appendRawLog 也能填对归属；取不到则写 null。
 *
 * @author   LingoBridge
 * @created  2026-07-17
 */
import 'server-only'
import { env } from '@/lib/env-server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { getRawLogContext } from '@/lib/raw-log-context'

/** LLM 会话消息（与 llm.ts 的 Msg 同构） */
type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

/** LLM 调用留证：完整 prompt + 原始输出（含用户故事原文），供离线复盘「模型是否把 score/reason 贴错 id」 */
export interface LLMRawRecord {
  kind: 'llm'
  ts: string
  label: string
  provider: 'anthropic' | 'dashscope'
  model: string
  /** 第几轮尝试：1=首发，≥2=失败后的整批重问 */
  attempt: number
  /** anthropic 的顶层 system；dashscope 为 null（system 已在 messages 里） */
  system: string | null
  messages: Msg[]
  raw: string
  jsonText: string
  /** 该次输出是否通过了 parse + validate */
  parsed: 'ok' | 'fail'
}

/**
 * ASR 转写留证：只存【转写文本】（原文），不存音频字节。产品方 2026-07-17 拍定——
 * 音频 base64 对复盘无价值（要的是「转成了什么文字」）且体积撑爆（此前 LLM 留证两天已堆 49MB）。
 */
export interface AsrRawRecord {
  kind: 'asr'
  ts: string
  /** 本次 ASR 请求的 X-Api-Request-Id */
  requestId: string
  /** 豆包返回的 X-Tt-Logid，供对账 */
  logId: string
  /** 送豆包的音频格式（wav / mp3 / ogg-opus） */
  format: string
  /** 豆包 X-Api-Status-Code（'20000000' 为成功） */
  statusCode: string
  /** 转写出的原文；guard 判为不可用时也如实留证（存被判掉的内容本身） */
  transcript: string
  /** checkTranscriptUsable 结论：ok=可用返回，reject=被判为空/无效 */
  guard: 'ok' | 'reject'
}

export type RawRecord = LLMRawRecord | AsrRawRecord

/**
 * 把一条原始留证入库（按 kind 分表）。env.rawLogEnabled 为 false 时直接返回（生产默认关闭，靠 RAW_LOG_ENABLED=1 开）。
 *
 * user_id / corpus_id 从 raw-log-context 的 ALS 上下文取（取不到写 null）；created_at 用 record.ts。
 * retained 不显式写，走 DB 默认 false（本轮只预留该列）。
 *
 * @param record  单次调用的完整上下文与原始输出（LLM 或 ASR）
 * @sideEffect    用 service_role 向 llm_raw_logs / asr_raw_logs insert 一行（绕 RLS）；写失败只 warn，绝不影响主链路
 */
export async function appendRawLog(record: RawRecord): Promise<void> {
  if (!env.rawLogEnabled) return
  const ctx = getRawLogContext()
  const userId = ctx?.userId ?? null
  const corpusId = ctx?.corpusId ?? null
  try {
    const supabase = getSupabaseServer()
    if (record.kind === 'asr') {
      const { error } = await supabase.from('asr_raw_logs').insert({
        user_id: userId,
        corpus_id: corpusId,
        request_id: record.requestId,
        log_id: record.logId,
        format: record.format,
        status_code: record.statusCode,
        transcript: record.transcript,
        guard: record.guard,
        created_at: record.ts,
      })
      if (error) throw error
    } else {
      const { error } = await supabase.from('llm_raw_logs').insert({
        user_id: userId,
        corpus_id: corpusId,
        label: record.label,
        provider: record.provider,
        model: record.model,
        attempt: record.attempt,
        system: record.system,
        messages: record.messages,
        raw: record.raw,
        json_text: record.jsonText,
        parsed: record.parsed,
        created_at: record.ts,
      })
      if (error) throw error
    }
  } catch (e) {
    console.warn('[RawLog] 原始输出留证入库失败（不影响主链路）', {
      kind: record.kind,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

/**
 * 彻底删除某用户的全部原始留证（两表），供账号删除（被遗忘权）调用。
 *
 * ⚠️ 故意【不带 retained 过滤】——删号即彻底删，连金标保留批（retained=true）也一并删（产品方 2026-07-17 拍定）。
 * 不受 env.rawLogEnabled 约束：无论当前是否在留证，历史留证都得能删干净。
 * 本函数会向上抛错，由调用方（account/delete）以 best-effort try/catch 兜住、不中断删号。
 *
 * ⚠️ 两遍删除（堵 ALS-null 逃逸）：两表 user_id 允许 null——写入时从 AsyncLocalStorage 取，取不到写 null
 *   （见 appendRawLog + 0020 注释）。只按 user_id 删会漏掉「user_id=null 但 corpus_id 指向该用户语料」的行，
 *   而这些行同样含该用户的故事/转写原文；且 GC（0020 pg_cron）只删 retained=false 的超期行，故 retained=true
 *   + user_id=null 的原文可能永久留存。故删号时【再按 corpus_id 删一遍】该用户名下所有语料对应的行。
 *
 * @param userId     被删除账号的 user id
 * @param corpusIds  该用户名下所有 corpus.id（删号路由在删 corpus 前已查得）；为空则只按 user_id 删
 * @sideEffect       用 service_role 删 llm_raw_logs / asr_raw_logs 中该 user 的所有行（绕 RLS）
 */
export async function deleteUserRawLogs(userId: string, corpusIds: string[] = []): Promise<void> {
  const supabase = getSupabaseServer()
  for (const table of ['llm_raw_logs', 'asr_raw_logs'] as const) {
    // 第一遍：按 user_id 删（ALS 取到 user_id 的行）
    const { error } = await supabase.from(table).delete().eq('user_id', userId)
    if (error) throw error
    // 第二遍：按 corpus_id 删（堵 user_id=null 但 corpus_id 指向该用户语料的行）
    if (corpusIds.length > 0) {
      const { error: cErr } = await supabase.from(table).delete().in('corpus_id', corpusIds)
      if (cErr) throw cErr
    }
  }
}
