/**
 * @module   transcription
 * @desc     语音转写服务 — 服务端调豆包「录音文件识别大模型·极速版」将录音转成文字
 * @author   LingoBridge
 * @created  2026-05-15
 */
import 'server-only'
import { env } from '@/lib/env-server'
import { checkTranscriptUsable } from '@/lib/transcript-guard'
import { appendRawLog } from '@/lib/raw-log'
import type { AppError } from '@/types/errors'

const DOUBAO_ASR_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash'
// 资源 ID 为平台固定常量，不放 env
const DOUBAO_RESOURCE_ID = 'volc.bigasr.auc_turbo'

interface DoubaoAsrRequest {
  user: { uid: string }
  audio: { data: string; format: string }
  request: { model_name: string; enable_punc: boolean; enable_itn: boolean }
}

interface DoubaoAsrResponse {
  result?: {
    text?: string
  }
}

/**
 * 将 Blob MIME 类型映射到豆包极速版支持的格式字符串
 * @param mimeType  Blob.type（如 "audio/ogg;codecs=opus"）
 * @returns         "wav" | "mp3" | "ogg-opus"
 * @throws          AppError — MIME 为 webm 或空（MediaRecorder 默认输出）时
 */
function resolveFormat(mimeType: string): string {
  const t = mimeType.toLowerCase()
  if (t.includes('wav')) return 'wav'
  if (t.includes('mp3') || t.includes('mpeg')) return 'mp3'
  if (t.includes('ogg')) return 'ogg-opus'

  // webm 是 Chrome MediaRecorder 默认格式，豆包极速版不支持
  console.warn('[Transcription] unsupported MIME for Doubao ASR', { mimeType: mimeType || '(empty)' })
  const err: AppError = {
    code: 'UNSUPPORTED_FORMAT',
    message: `豆包不支持 webm，需在录音端改用 ogg/wav 或在此做转码（实际 MIME：${mimeType || '(empty)'})`,
  }
  throw err
}

/**
 * 将录音 Blob 转写为文字
 * @param audioBlob  录音数据（支持 wav / mp3 / ogg-opus；webm 抛出 AppError）
 * @returns          转写后的文本字符串
 */
export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  if (!env.doubaoAsrAppId || !env.doubaoAsrAccessToken) {
    throw new Error('未配置 DOUBAO_ASR_APP_ID / DOUBAO_ASR_ACCESS_TOKEN，请在 .env.local 中设置')
  }

  const format = resolveFormat(audioBlob.type)

  const arrayBuf = await audioBlob.arrayBuffer()
  const base64 = Buffer.from(arrayBuf).toString('base64')

  const body: DoubaoAsrRequest = {
    user: { uid: 'lingobridge' },
    audio: { data: base64, format },
    request: { model_name: 'bigmodel', enable_punc: true, enable_itn: true },
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000) // ENGINEERING §4：30s 超时
  const requestId = crypto.randomUUID()

  try {
    const res = await fetch(DOUBAO_ASR_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type':       'application/json',
        'X-Api-App-Key':      env.doubaoAsrAppId,
        'X-Api-Access-Key':   env.doubaoAsrAccessToken,
        'X-Api-Resource-Id':  DOUBAO_RESOURCE_ID,
        'X-Api-Request-Id':   requestId,
        'X-Api-Sequence':     '-1',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    // 成功判断在响应头，不在 HTTP 状态码或 body
    const logId      = res.headers.get('X-Tt-Logid') ?? '(none)'
    const statusCode = res.headers.get('X-Api-Status-Code') ?? ''
    const statusMsg  = res.headers.get('X-Api-Message') ?? ''

    if (statusCode !== '20000000') {
      const err: AppError = {
        code:    statusCode || String(res.status),
        message: statusMsg  || `豆包转写失败（HTTP ${res.status}）`,
        cause:   { logId, statusCode, statusMsg },
      }
      throw err
    }

    const data = (await res.json()) as DoubaoAsrResponse
    const text = data.result?.text?.trim() ?? ''
    const guard = checkTranscriptUsable(text)

    // 全链路留证第一环：把 ASR 转写原文接进统一留证（lib/raw-log），与 LLM 留证同一入库路径（asr_raw_logs）。
    // ⚠️ 这会让【原始语音转成的文字】入库——它就是最敏感的用户原文；之所以能安全留证，
    //    全靠 RAW_LOG_ENABLED 默认关 + 表 RLS + 30 天过期已就位。只存转写文本、不存音频字节（产品方 2026-07-17 拍定）。
    //    guard 判掉的内容也如实留证（存被判掉的文本本身），留证失败绝不影响主链路。
    await appendRawLog({
      kind:       'asr',
      ts:         new Date().toISOString(),
      requestId,
      logId,
      format,
      statusCode,
      transcript: text,
      guard:      guard.usable ? 'ok' : 'reject',
    })

    if (!guard.usable) {
      const err: AppError = {
        code:    'EMPTY_TRANSCRIPT',
        message: '没有捕捉到清晰的语音内容',
        cause:   { reason: guard.reason },
      }
      throw err
    }

    return text
  } finally {
    clearTimeout(timeout)
  }
}
