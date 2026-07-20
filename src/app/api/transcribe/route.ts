/**
 * @module   api/transcribe
 * @desc     POST 接口：收音频文件 → ffmpeg 转 16kHz WAV → 豆包极速版 ASR → 返回文字
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { transcodeToWav } from '@/lib/audio/transcode'
import { transcribeAudio } from '@/services/transcription'
import { logApiUsage, API_PRICING } from '@/lib/api-logger'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { hasRecordedConsent } from '@/lib/consent-server'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { bumpDailyUsageServer, readDailyUsageServer } from '@/lib/db/corpus-server'
import { ANON_TRANSCRIBE_LIMIT, REG_TRANSCRIBE_DAILY_LIMIT } from '@/lib/constants'
import type { AppError } from '@/types/errors'

// 音频体积上限（对齐 ENGINEERING §9 的 10MB 规则），挡超大文件刷 ASR 成本
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

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
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    // 服务端同意闸：语音流首个第三方 AI 入口（字节 ASR）。未捕获同意 → 拒绝，绝不把录音外发。
    // 客户端同意弹窗只挂首页、深链可绕过，故这里必须再硬校验一次（放在计次/转码之前）。
    if (!(await hasRecordedConsent(userId))) {
      return NextResponse.json({ error: '请先在首页阅读并同意隐私说明', code: 'CONSENT_REQUIRED' }, { status: 403 })
    }
    const form = await req.formData()
    const file = form.get('audio')
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: '缺少音频文件' }, { status: 400 })
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: '录音文件过大，请分段录制' }, { status: 400 })
    }
    // ——— 额度闸分两拍 ———
    // 目标：「没出字就别扣次数」与「已经花了钱就必须扣次数」同时成立。
    // ① 只读早退：已超额的请求立刻挡掉，连转码 CPU 都不浪费（只读值非原子，仅作优化，失败按 0 放行）。
    // ② 转码成功、真正要调豆包之前，才原子递增并复核 —— 原子递增依旧是并发硬防线。
    // 由此：ASR 之前的失败（转码报错 / 空文件等）天然没计过次，无需任何回滚，也就没有递减带来的并发错乱；
    // 豆包一旦被调用（含 EMPTY_TRANSCRIPT）则计次已落且不退 —— 费用已产生，且防攻击者构造必失败请求刷 ASR 额度。
    const dailyLimit = isAnonymous ? ANON_TRANSCRIBE_LIMIT : REG_TRANSCRIBE_DAILY_LIMIT
    /** 超额响应：匿名 402(QUOTA_EXCEEDED) 供前端弹试用提示；注册 429（不带 code，不弹配额层）。 */
    const overQuotaRes = (): NextResponse => isAnonymous
      ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
      : NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })

    if (await readDailyUsageServer(userId, 'transcribe') >= dailyLimit) return overQuotaRes()

    const inputBuf = Buffer.from(await file.arrayBuffer())
    const ext      = mimeToExt(file.type)
    const wavBuf   = await transcodeToWav(inputBuf, ext)
    // 构造 WAV Blob 传给 transcription 层，令其 resolveFormat 得到 "wav"
    const wavBlob  = new Blob([new Uint8Array(wavBuf)], { type: 'audio/wav' })

    // ② 计次的分界线就在这一行：它下面是花钱的豆包调用，它上面的任何失败都不曾计次。
    const dailyCount = await bumpDailyUsageServer(userId, 'transcribe')
    if (dailyCount > dailyLimit) return overQuotaRes()

    // transcribe 处于建语料之前，无 corpusId；带 userId 归属 ASR 转写留证。
    const text = await runWithRawLogContext({ userId, corpusId: null }, () =>
      transcribeAudio(wavBlob),
    )
    // 16kHz mono 16-bit PCM: (bytes - 44-byte header) / 32000 ≈ 秒数
    const duration_s = Math.max(0, (wavBuf.length - 44) / 32000)
    await logApiUsage({ service: 'doubao_asr', endpoint: 'openspeech.bytedance.com/auc/bigmodel/recognize/flash', usage_amount: duration_s, usage_unit: 'seconds', estimated_cost_cny: duration_s * API_PRICING.doubao_asr_per_second, latency_ms: Date.now() - t0, status: 'success', user_id: userId, is_anonymous: isAnonymous })
    return NextResponse.json({ text })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    await logApiUsage({ service: 'doubao_asr', endpoint: 'openspeech.bytedance.com/auc/bigmodel/recognize/flash', usage_amount: 0, usage_unit: 'seconds', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error' })
    logErr('[transcribe API]', e)
    // 不回传内部 message；仅保留受控的 AppError.code（客户端据此区分如 EMPTY_TRANSCRIPT 的友好提示）
    if (isAppError(e)) {
      return NextResponse.json({ error: '转写失败，请稍后再试', code: e.code }, { status: 500 })
    }
    return NextResponse.json({ error: '转写失败，请稍后再试' }, { status: 500 })
  }
}
