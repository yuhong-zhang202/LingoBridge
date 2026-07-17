/**
 * @module   raw-log
 * @desc     统一「原始输出留证」落盘层 —— LLM 调用与 ASR 转写共用【同一目录、同一套文件权限】
 *           （目录 0o700 / 文件 0o600，只属主可读）。由 LLM_RAW_LOG_DIR 单一开关控制，
 *           留空=不留证（生产/开发默认关闭）。
 *
 *   ⚠️ 这里落盘的是【用户故事原文 / 语音转写原文】——LLM 记录的 messages 是完整 prompt，
 *      ASR 记录的 transcript 是原始语音转成的文字。内测起它们就是真实用户数据。
 *      故务必只把 LLM_RAW_LOG_DIR 指向 .gitignore 内的本地目录，切勿在生产开启。
 *
 *   本模块从 llm.ts 抽出（2026-07-17），把 ASR 留证也纳入同一条落盘路径与同一套权限——
 *   ASR 之前直连豆包、零留证，接进来是「留证」与「权限收紧」这件事的另一半。
 *   权限逻辑与文件名一字未改：LLM 仍写 llm-raw-<date>.jsonl，ASR 走并行的 asr-raw-<date>.jsonl。
 *
 * @author   LingoBridge
 * @created  2026-07-17
 */
import 'server-only'
import { env } from '@/lib/env-server'

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
 * 音频 base64 对复盘无价值（要的是「转成了什么文字」）且体积撑爆磁盘（此前 LLM 留证两天已堆 49MB）。
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
 * 把一条原始留证追加到 JSONL 文件。LLM_RAW_LOG_DIR 为空时直接返回（生产默认关闭）。
 *
 * mode 只在【创建时】生效：目录/文件已存在时不会被改回来。故部署新环境时它是对的，
 * 而既有环境需人工 chmod 一次（本机 .llm-raw 已于 2026-07-17 执行）。
 *
 * @param record  单次调用的完整上下文与原始输出（LLM 或 ASR）
 * @sideEffect    写本地文件（按 kind + 日期分文件，目录 0o700 / 文件 0o600）；写失败只 warn，绝不影响主链路
 */
export async function appendRawLog(record: RawRecord): Promise<void> {
  const dir = env.llmRawLogDir
  if (!dir) return
  try {
    // 动态 import：避免把 node:fs 静态绑进可能跑在 edge runtime 的模块图
    const { mkdir, appendFile } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    // LLM 与 ASR 分文件：schema 不同，混一个文件会给离线读取添乱；但同目录、同权限。
    const prefix = record.kind === 'asr' ? 'asr-raw' : 'llm-raw'
    const file = `${dir}/${prefix}-${record.ts.slice(0, 10)}.jsonl`
    await appendFile(file, JSON.stringify(record) + '\n', { encoding: 'utf-8', mode: 0o600 })
  } catch (e) {
    console.warn('[RawLog] 原始输出留证失败（不影响主链路）', {
      message: e instanceof Error ? e.message : String(e),
    })
  }
}
