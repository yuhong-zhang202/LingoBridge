/**
 * @module   api/transcribe
 * @desc     POST 接口：收音频文件 → ffmpeg 转 16kHz WAV → 豆包极速版 ASR → 返回文字
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { transcodeToWav } from '@/lib/audio/transcode'
import { transcribeAudio } from '@/services/transcription'
import { logApiUsage, API_PRICING } from '@/lib/api-logger'
import type { AppError } from '@/types/errors'

// ffmpeg 需要 Node.js 运行时（不支持 Edge）
export const runtime = 'nodejs'
// 给转码（≤10s）+ 豆包识别（≤30s）留足时间
export const maxDuration = 60

/** AppError 类型守卫（code + message 字段） */
function isAppError(e: unknown): e is AppError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e
}

/**
 * 由 Blob MIME 类型推出文件扩展名，供 ffmpeg 输入文件命名
 * @param mimeType  Blob.type（如 "audio/webm;codecs=opus"）
 * @returns         扩展名（不含点）
 */
function mimeToExt(mimeType: string): string {
  const t = mimeType.toLowerCase()
  if (t.includes('mp4'))  return 'mp4'
  if (t.includes('ogg'))  return 'ogg'
  if (t.includes('wav'))  return 'wav'
  return 'webm' // Chrome MediaRecorder 默认；ffmpeg 可解
}

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const form = await req.formData()
    const file = form.get('audio')
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: '缺少音频文件' }, { status: 400 })
    }

    const inputBuf = Buffer.from(await file.arrayBuffer())
    const ext      = mimeToExt(file.type)
    const wavBuf   = await transcodeToWav(inputBuf, ext)
    // 构造 WAV Blob 传给 transcription 层，令其 resolveFormat 得到 "wav"
    const wavBlob  = new Blob([new Uint8Array(wavBuf)], { type: 'audio/wav' })

    const text = await transcribeAudio(wavBlob)
    // 16kHz mono 16-bit PCM: (bytes - 44-byte header) / 32000 ≈ 秒数
    const duration_s = Math.max(0, (wavBuf.length - 44) / 32000)
    logApiUsage({ service: 'doubao_asr', endpoint: 'openspeech.bytedance.com/auc/bigmodel/recognize/flash', usage_amount: duration_s, usage_unit: 'seconds', estimated_cost_cny: duration_s * API_PRICING.doubao_asr_per_second, latency_ms: Date.now() - t0, status: 'success' }).catch(() => {})
    return NextResponse.json({ text })
  } catch (e) {
    logApiUsage({ service: 'doubao_asr', endpoint: 'openspeech.bytedance.com/auc/bigmodel/recognize/flash', usage_amount: 0, usage_unit: 'seconds', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error' }).catch(() => {})
    console.error('[transcribe API] error', e)
    if (isAppError(e)) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 500 })
    }
    const message = e instanceof Error ? e.message : '转写失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
