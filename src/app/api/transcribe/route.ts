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
import {
  ANON_TRANSCRIBE_LIMIT, REG_TRANSCRIBE_DAILY_LIMIT,
  ERROR_KIND_KEY, ERROR_KIND_USER_INPUT,
} from '@/lib/constants'
import { createConcurrencyGate, type GateRejectReason } from '@/lib/concurrency-gate'
import type { AppError } from '@/types/errors'

// 音频体积上限（对齐 ENGINEERING §9 的 10MB 规则），挡超大文件刷 ASR 成本
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

// ——— 豆包 ASR 并发闸 ———
// 火山引擎控制台实测：「录音文件识别大模型·极速版」并发限额 = 5（增购需付费，产品方 2026-07-20 决定不买、改排队）。
// 超限时豆包直接返回错误码 45000292，用户刚录的那段话白费。故在服务端自行把并发压在上限内、超出的排队。
//
// 三个参数的取值依据（L3 压测：单次转写 P50 约 2.8–3.4s，8 并发时 5 成功 3 失败）：
//   · 并发 4 —— 不取满 5。我方 release 的时刻早于豆包服务端计数回落，取满 5 仍会因时序抖动撞限；留 1 个余量。
//   · 队列 20 —— 吞吐 ≈ 4 / 3s ≈ 1.33 req/s，排在第 20 位约需等 15s，正好与下面的等待上限对齐：
//     队列再长也只是让人白等到超时，没有意义。绝不无界排队（否则高峰期耗尽连接、拖垮整个服务）。
//   · 等待 15s —— 转写本身约 3s，再等 15s 已是体验下限。且 15(排队) + 10(转码) + 30(ASR 超时) = 55s < maxDuration 60s。
//
// ⚠️ 进程内状态，多实例失效 —— 详见 lib/concurrency-gate 顶部说明。
const ASR_MAX_CONCURRENT = 4
const ASR_MAX_QUEUE      = 20
const ASR_MAX_WAIT_MS    = 15_000
const asrGate = createConcurrencyGate({
  maxConcurrent: ASR_MAX_CONCURRENT,
  maxQueue:      ASR_MAX_QUEUE,
  maxWaitMs:     ASR_MAX_WAIT_MS,
})

// ffmpeg 需要 Node.js 运行时（不支持 Edge）
export const runtime = 'nodejs'
// 给排队（≤15s）+ 转码（≤10s）+ 豆包识别（≤30s）留足时间
export const maxDuration = 60

/** AppError 类型守卫（code + message 字段） */
function isAppError(e: unknown): e is AppError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e
}

/** 豆包并发超限错误码（transcription 层把上游 X-Api-Status-Code 原样放进 AppError.code） */
const DOUBAO_CONCURRENCY_LIMIT_CODE = '45000292'

/** 「人多」的三种来源：本地队列满 / 本地等待超时 / 仍被豆包判并发超限 */
type BusyReason = GateRejectReason | 'upstream_limit'

/**
 * 「服务繁忙」响应（队列满 / 等待超时 / 上游并发超限）
 * @param reason  繁忙来源，仅用于服务端日志定位，不回传给客户端
 * @returns       503 + code=ASR_BUSY
 *
 * 为什么是 503 而不是 429/500：
 *   · 429 在本接口已被「注册用户每日额度用尽」占用，复用会让前端分不清「你用超了」和「大家都在用」；
 *   · 500 会让前端落进「转写失败，请稍后再试」，用户以为产品坏了 —— 这正是要区分开的场景。
 *   503 语义就是「服务暂时过载」，配 Retry-After 提示客户端稍后重试。
 *   前端按 code=ASR_BUSY 给「人多，稍等几秒再说一次」的专属文案。
 */
function busyRes(reason: BusyReason): NextResponse {
  logErr('[transcribe API] ASR 并发闸拒绝', { reason, maxConcurrent: ASR_MAX_CONCURRENT, maxQueue: ASR_MAX_QUEUE })
  return NextResponse.json(
    { error: '现在使用的人有点多，请稍等几秒再试一次', code: 'ASR_BUSY' },
    { status: 503, headers: { 'Retry-After': '5' } },
  )
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
  // 失败记账用的两份上下文，在 try 内赋值、catch 内读取：
  //   · attribution —— 归属（谁烧的钱）。失败行同样要能归到人，否则「按用户成本」漏账。
  //   · billedDurationS —— 豆包已完整处理的音频秒数，仅在「调用真的走完一整趟」的失败里用于记账（见 catch）。
  let attribution: { userId: string; isAnonymous: boolean } | null = null
  let billedDurationS: number | null = null
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    attribution = { userId, isAnonymous }
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

    // ——— 并发闸只包住豆包调用这一段 ———
    // 转码是本机 CPU、不占豆包并发配额，绝不能圈进来（圈进来白白拉低吞吐）。
    // ⚠️ 排队【必须在计次之前】：排队等待与超时都发生在花钱之前，等超时的用户一次都没扣，
    //    否则「排了队、还超时、还被扣次数」= 白扣，不可接受。名额到手之后才计次，计次点依旧紧贴 ASR。
    const slot = await asrGate.acquire()
    if (!slot.ok) return busyRes(slot.reason)
    try {
      // ② 计次的分界线就在这一行：它下面是花钱的豆包调用，它上面的任何失败都不曾计次。
      const dailyCount = await bumpDailyUsageServer(userId, 'transcribe')
      if (dailyCount > dailyLimit) return overQuotaRes()

      // 16kHz mono 16-bit PCM: (bytes - 44-byte header) / 32000 ≈ 秒数
      const duration_s = Math.max(0, (wavBuf.length - 44) / 32000)
      billedDurationS = duration_s   // 供 catch 给「已跑完整趟」的失败记真实费用
      // transcribe 处于建语料之前，无 corpusId；带 userId 归属 ASR 转写留证。
      const text = await runWithRawLogContext({ userId, corpusId: null }, () =>
        transcribeAudio(wavBlob),
      )
      await logApiUsage({ service: 'doubao_asr', endpoint: 'openspeech.bytedance.com/auc/bigmodel/recognize/flash', usage_amount: duration_s, usage_unit: 'seconds', estimated_cost_cny: duration_s * API_PRICING.doubao_asr_per_second, latency_ms: Date.now() - t0, status: 'success', user_id: userId, is_anonymous: isAnonymous })
      return NextResponse.json({ text })
    } finally {
      // 名额必须归还：无论成功、超额早退还是抛错。漏了就是永久泄漏，闸门会越关越死。
      slot.release()
    }
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    // ——— 失败记账：区分「系统故障」与「用户输入问题」，两者花的钱都要记 ———
    // EMPTY_TRANSCRIPT = 豆包完整处理了整段音频、只是没识别出人声：
    //   · 费用：钱确实花了（按真实时长记，与成功路径同一公式）——记 0 会让"失败成本"永远看不到这笔白烧；
    //   · 归因：打 error_kind=user_input，成本看板据此把它排除在系统错误率之外，但仍计入失败成本。
    // 其余失败（转码报错 / 并发被拒 / 网络中断）豆包没跑完整趟，一律记 0，绝不拿音频时长虚增成本。
    const isUserInputError = isAppError(e) && e.code === 'EMPTY_TRANSCRIPT'
    const failedDurationS  = isUserInputError ? (billedDurationS ?? 0) : 0
    await logApiUsage({
      service: 'doubao_asr',
      endpoint: 'openspeech.bytedance.com/auc/bigmodel/recognize/flash',
      usage_amount: failedDurationS,
      usage_unit: 'seconds',
      estimated_cost_cny: failedDurationS * API_PRICING.doubao_asr_per_second,
      latency_ms: Date.now() - t0,
      status: 'error',
      ...(attribution ? { user_id: attribution.userId, is_anonymous: attribution.isAnonymous } : {}),
      ...(isUserInputError ? { metadata: { [ERROR_KIND_KEY]: ERROR_KIND_USER_INPUT } } : {}),
    })
    logErr('[transcribe API]', e)
    // 不回传内部 message；仅保留受控的 AppError.code（客户端据此区分如 EMPTY_TRANSCRIPT 的友好提示）
    if (isAppError(e)) {
      // 兜底：即便排了队，我方 release 与豆包服务端计数回落之间仍有时序窗口，偶发仍会撞并发限额。
      // 45000292 = 豆包并发超限，与队列满/超时是同一件事（人多），归到同一个 ASR_BUSY 分支，
      // 别让它变成「转写失败」把锅甩给产品。不自动重试的取舍见交付说明。
      if (e.code === DOUBAO_CONCURRENCY_LIMIT_CODE) return busyRes('upstream_limit')
      // EMPTY_TRANSCRIPT（录到了音但没有可用人声）是用户输入问题、不是服务端故障，用 422 而非 500：
      // 语义上「请求格式没问题、内容无法处理」正是 422。前端按 !res.ok + code 判分支，状态码换了仍命中。
      const status = e.code === 'EMPTY_TRANSCRIPT' ? 422 : 500
      return NextResponse.json({ error: '转写失败，请稍后再试', code: e.code }, { status })
    }
    return NextResponse.json({ error: '转写失败，请稍后再试' }, { status: 500 })
  }
}
