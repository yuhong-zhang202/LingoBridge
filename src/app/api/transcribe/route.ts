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
import { isQaRequest } from '@/lib/qa-traffic'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { hasRecordedConsent } from '@/lib/consent-server'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { bumpDailyUsageServer, readDailyUsageServer, readLifetimeUsageServer } from '@/lib/db/corpus-server'
import { ANON_TRANSCRIBE_LIMIT, ANON_TRANSCRIBE_LIFETIME, REG_TRANSCRIBE_DAILY_LIMIT, ERROR_KIND_USER_INPUT } from '@/lib/constants'
import { createConcurrencyGate, type GateRejectReason } from '@/lib/concurrency-gate'
import { requireGlobalBudget } from '@/lib/global-budget-breaker'
import { isAppError, errorLogMeta, errorKindMeta, classifyErrorKind } from '@/types/errors'

// 音频体积上限（对齐 ENGINEERING §9 的 10MB 规则），挡超大文件刷 ASR 成本
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

// ——— 两个并发闸：一个对齐 CPU 核数，一个对齐豆包配额，必须分开 ———
// 一次转写依次吃两种毫不相干的资源，各自的上限来自两个不同的地方：
//   · ffmpeg 转码 → 吃【本机 CPU】，上限 = 本实例核数（生产腾讯云香港 2vCPU/2GB，见 docs/部署交接-香港PaaS.md §2）
//   · 豆包 ASR   → 吃【上游并发配额】，上限 = 火山引擎控制台限额 5（与本机多少核毫无关系）
// 合成一个闸两个方向都错：按核数限，豆包吞吐被白白砍掉一半；按配额限，ffmpeg 根本没人管 ——
// 几十个并发上传能把 2 核超卖十几倍，同进程的 Next SSR 跟着一起卡（不只录音，首页/题库/看板全遭殃）。
// ⚠️ 2026-08-06 审计 P1-2 抓到的正是这个错配：闸只圈住 ASR，注释给的理由却是「ffmpeg 吃 CPU、超核数会互抢」——
//    两句话各自都对、叠起来是错的，结果被限的是豆包（本可 4 被压成 2），该限的转码一个都没限。
//    ⇒ 动下面任何一个常数前，先回答「我在限哪种资源、那个资源的上限写在哪」。
// ⚠️ 两个闸都是进程内状态：ASR 闸多实例会失效，转码闸多实例仍正确（CPU 本来就是每实例一份）——
//    差别与扩容影响见 lib/concurrency-gate 顶部说明与 docs/部署交接-香港PaaS.md §12 扩容前置清单。

// ——— 闸①：ffmpeg 转码闸（对齐本机 CPU 核数）———
//   · 并发 2 —— 等于生产实例的 vCPU 数。转码是纯 CPU 密集，开到核数以上不会更快，只会让每个任务互抢时间片
//     一起变慢，还挤占同进程的 Next SSR。⚠️ 换机型（例如升到 4vCPU）必须同步改这个数，否则要么闲置核、要么超卖。
//   · 队列 20 / 等待 10s —— 转码本身极快（lib/audio/transcode 记的实测：2.5 小时音频 6 秒，约 1500 倍实时；
//     真实录音 p50 46s / p99 207s，即便按 VPS 比开发机慢几倍折算，单次也在 1 秒级），2 个名额的吞吐远高于
//     下游 ASR 闸的 ≈1.33 req/s。所以这道闸正常流量下几乎不排队，只在突发/攻击时兜底封住超卖；
//     20 个排队按最保守估算也能在 10s 内消化完。等更久没意义 —— 后面还有 ASR 闸最多 15s 的等待要叠上去。
const TRANSCODE_MAX_CONCURRENT = 2
const TRANSCODE_MAX_QUEUE      = 20
const TRANSCODE_MAX_WAIT_MS    = 10_000
const transcodeGate = createConcurrencyGate({
  maxConcurrent: TRANSCODE_MAX_CONCURRENT,
  maxQueue:      TRANSCODE_MAX_QUEUE,
  maxWaitMs:     TRANSCODE_MAX_WAIT_MS,
})

// ——— 闸②：豆包 ASR 并发闸（对齐上游并发配额）———
// 火山引擎控制台实测：「录音文件识别大模型·极速版」并发限额 = 5（增购需付费，产品方 2026-07-20 决定不买、改排队）。
// 超限时豆包直接返回错误码 45000292，用户刚录的那段话白费。故在服务端自行把并发压在上限内、超出的排队。
//
// 三个参数的取值依据（L3 压测：单次转写 P50 约 2.8–3.4s，8 并发时 5 成功 3 失败）：
//   · 并发 4 —— 不取满 5。我方 release 的时刻早于豆包服务端计数回落，取满 5 仍会因时序抖动撞限；留 1 个余量。
//     ⚠️ 这个数只跟豆包配额有关，跟本机几核无关（曾被误压到 2，见上面 P1-2）。
//   · 队列 20 —— 吞吐 ≈ 4 / 3s ≈ 1.33 req/s，排在第 20 位约需等 15s，正好与下面的等待上限对齐：
//     队列再长也只是让人白等到超时，没有意义。绝不无界排队（否则高峰期耗尽连接、拖垮整个服务）。
//   · 等待 15s —— 转写本身约 3s，再等 15s 已是体验下限。全链路 10(转码排队) + 1(转码) + 15(ASR 排队) + 30(ASR 超时)，
//     仅为「各环节上限相加」的参考量、非硬上限：真实超时上限 = Zeabur 网关超时（下方 maxDuration 在 Zeabur 不生效，见其注释）。
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
// ⚠️ maxDuration 是 Vercel 的 route segment 语义，当前部署（Zeabur 容器 + 香港 VPS，非 Vercel）下【不生效、是 no-op】。
//    真实超时上限 = Zeabur 网关超时（见 docs/部署交接-香港PaaS.md）；此处 60 不是本接口的实际执行上限，别据它推算。
//    保留而不删：无害 no-op，且若将来改回 Vercel 仍需要它；删属部署面变更，要单独验证（与 next.config.mjs 的 outputFileTracing* 同理）。
export const maxDuration = 60

/** 豆包并发超限错误码（transcription 层把上游 X-Api-Status-Code 原样放进 AppError.code） */
const DOUBAO_CONCURRENCY_LIMIT_CODE = '45000292'
/**
 * 豆包「静音音频 / 无有效人声」错误码（X-Api-Message: "no valid speech in audio"）。
 * 用户录了纯静音（生产实证：9 秒峰值 0.0097 的录音触发此码），服务本身是好的——
 * 语义上与 EMPTY_TRANSCRIPT 同类（请求格式没问题、内容无法处理），响应码判定须走同一条 422 路。
 * ⚠️ 与 types/errors.ts 的 classifyErrorKind（DOUBAO_SILENCE_CODE，归 user_input）互为引用：
 *    那边管成本看板归因、这边管响应码 → 客户端埋点桶。两处必须同进退，否则两个看板会再度互相矛盾
 *    （历史教训：此码曾只在归因层算 user_input、响应码却回 500，被客户端记成 server_5xx 误入「该我们修」）。
 */
const DOUBAO_SILENCE_CODE = '20000003'

// ——— 场景 → phase 埋点值 ———
// 客户端 FormData 带 scene 区分两条转写链路：'story'=录音→整理语料（recording 页）、
// 'practice'=练习对话每轮转写（practice 页）。看板据此把「语料转写」「练习转写」分开归位。
// 缺省/非法值回退 'transcribe'（兼容旧客户端缓存页面的历史行为）。只改埋点值，转写行为/计次/error_kind 不变。
const SCENE_PHASE: Record<string, string> = {
  story:    'transcribe_story',
  practice: 'transcribe_practice',
}

/** 空录音的采集信号（假空率原料）：客户端可选上报，仅在「空录音失败」时落 metadata.audio。 */
type AudioSignals = { peak: number; durMs: number; bytes: number }

/**
 * 从 FormData 解析空录音采集信号（peakLevel/durationMs/blobBytes）。
 * 三个字段是【可选增强】：任一缺失（旧客户端不传）或非数值即整体返回 null，服务端不写、不报错。
 * 只读取、不参与任何转写/计次/error_kind 分支。
 * @param form  已解析的 multipart 表单
 * @returns     三信号齐备且均为有限数时返回；否则 null
 */
function parseAudioSignals(form: FormData): AudioSignals | null {
  const peakRaw  = form.get('peakLevel')
  const durRaw   = form.get('durationMs')
  const bytesRaw = form.get('blobBytes')
  if (typeof peakRaw !== 'string' || typeof durRaw !== 'string' || typeof bytesRaw !== 'string') return null
  const peak  = Number(peakRaw)
  const durMs = Number(durRaw)
  const bytes = Number(bytesRaw)
  if (!Number.isFinite(peak) || !Number.isFinite(durMs) || !Number.isFinite(bytes)) return null
  return { peak, durMs, bytes }
}

/** 「人多」的三种来源：本地队列满 / 本地等待超时 / 仍被豆包判并发超限 */
type BusyReason = GateRejectReason | 'upstream_limit'
/** 是哪一环挤住了：转码闸（CPU 排满）/ ASR 闸（豆包配额排满）/ 上游豆包直接判超限。只进日志，不回传客户端 */
type BusySource = 'transcode_gate' | 'asr_gate' | 'doubao_upstream'

/** 日志用的闸门参数（出问题时一眼看出是哪道闸、上限多少），两道闸各一份 */
const GATE_LIMITS: Record<BusySource, { maxConcurrent: number; maxQueue: number } | null> = {
  transcode_gate:  { maxConcurrent: TRANSCODE_MAX_CONCURRENT, maxQueue: TRANSCODE_MAX_QUEUE },
  asr_gate:        { maxConcurrent: ASR_MAX_CONCURRENT,       maxQueue: ASR_MAX_QUEUE },
  doubao_upstream: null,   // 上游拒的，本地闸门参数与之无关，写进日志只会误导
}

/**
 * 「服务繁忙」响应（转码闸排满 / ASR 闸队列满或等待超时 / 上游并发超限）
 * @param source  哪一环挤住了，仅用于服务端日志定位，不回传给客户端
 * @param reason  繁忙来源，仅用于服务端日志定位，不回传给客户端
 * @returns       503 + code=ASR_BUSY
 *
 * 为什么转码闸拒绝也回 code=ASR_BUSY（而不新造一个码）：
 *   对用户是同一件事 ——「人多，稍等几秒」，且前端已按此码做了专属文案与自动重试
 *   （useVoiceStorySubmit / practice 页按 Retry-After 重试）。新造码只会让转码排队落进
 *   「转写失败」兜底分支，把「等一下就好」说成「产品坏了」。要区分是哪道闸，看服务端日志的 source。
 *
 * 为什么是 503 而不是 429/500：
 *   · 429 在本接口已被「注册用户每日额度用尽」占用，复用会让前端分不清「你用超了」和「大家都在用」；
 *   · 500 会让前端落进「转写失败，请稍后再试」，用户以为产品坏了 —— 这正是要区分开的场景。
 *   503 语义就是「服务暂时过载」，配 Retry-After 提示客户端稍后重试。
 *   前端按 code=ASR_BUSY 给「人多，稍等几秒再说一次」的专属文案。
 */
function busyRes(source: BusySource, reason: BusyReason): NextResponse {
  logErr('[transcribe API] 并发闸拒绝', { source, reason, ...(GATE_LIMITS[source] ?? {}) })
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
  // phase 埋点值：解析出 FormData 的 scene 后按 SCENE_PHASE 定值；解析前（如鉴权失败）保持兜底 'transcribe'。
  // 声明在 try 外，让 catch 的失败记账拿到与成功路径一致的 phase。
  let phase = 'transcribe'
  // 空录音采集信号（假空率原料）：解析出 FormData 后赋值，仅 catch 里「空录音失败」时落 metadata.audio。
  // 声明在 try 外让 catch 读得到；解析前（鉴权/表单未到）保持 null。
  let audioSignals: AudioSignals | null = null
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    attribution = { userId, isAnonymous }
    // 服务端同意闸：语音流首个第三方 AI 入口（字节 ASR）。未捕获同意 → 拒绝，绝不把录音外发。
    // 客户端同意弹窗只挂首页、深链可绕过，故这里必须再硬校验一次（放在计次/转码之前）。
    if (!(await hasRecordedConsent(userId))) {
      return NextResponse.json({ error: '请先在首页阅读并同意隐私说明', code: 'CONSENT_REQUIRED' }, { status: 403 })
    }
    const form = await req.formData()
    // scene 只影响 phase 埋点值，不参与任何业务分支；非法/缺省保持 'transcribe'
    const scene = form.get('scene')
    if (typeof scene === 'string' && SCENE_PHASE[scene]) phase = SCENE_PHASE[scene]
    // 采集信号只读取暂存，落库时机在 catch 的「空录音失败」分支；解析失败/缺失保持 null。不参与任何业务分支。
    audioSignals = parseAudioSignals(form)
    const file = form.get('audio')
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: '缺少音频文件' }, { status: 400 })
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: '录音文件过大，请分段录制' }, { status: 400 })
    }
    // 全局预算熔断：今日（东八区）全站 AI 花费触线 → 匿名一律拒新调用，注册用户不受影响。
    // 位置紧贴下面的额度闸、在任何计次/转码/ASR 之前 —— 被它拦下的请求一分钱没花、也不该被扣次数。
    const budgetDenied = await requireGlobalBudget(isAnonymous)
    if (budgetDenied) return budgetDenied
    // ——— 额度闸分两拍 ———
    // 目标：「没出字就别扣次数」与「已经花了钱就必须扣次数」同时成立。
    // ① 只读早退：已超额的请求立刻挡掉，连转码 CPU 都不浪费（只读值非原子，仅作优化，失败按 0 放行）。
    // ② 转码成功、真正要调豆包之前，才原子递增并复核 —— 原子递增依旧是并发硬防线。
    // 由此：ASR 之前的失败（转码报错 / 空文件等）天然没计过次，无需任何回滚，也就没有递减带来的并发错乱；
    // 豆包一旦被调用（含 EMPTY_TRANSCRIPT）则计次已落且不退 —— 费用已产生，且防攻击者构造必失败请求刷 ASR 额度。
    //
    // 匿名侧额外叠一道【终身总量闸】(ANON_TRANSCRIBE_LIFETIME)：每日额度每天清零，挡不住
    // 「建完 1 条语料后从素材库反复进练习页、每天领一份新额度、无限期用」，而转写是匿名成本的 94~97%。
    // 终身闸同样走「两拍」：只读那拍是优化、原子递增后那拍是硬防线，与上面的分工完全一致。
    // 注册用户不受终身闸约束（口径一字不改），内部账户由 readLifetimeUsageServer 内部豁免。
    const dailyLimit = isAnonymous ? ANON_TRANSCRIBE_LIMIT : REG_TRANSCRIBE_DAILY_LIMIT
    /**
     * 超额响应：匿名 402(QUOTA_EXCEEDED) 供前端弹试用提示；注册 429（不带 code，不弹配额层）。
     * 匿名文案「试用次数已用完，请注册后继续」对每日闸与终身闸都成立（终身闸下它甚至更准确），故复用不新造。
     */
    const overQuotaRes = (): NextResponse => isAnonymous
      ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
      : NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })

    if (await readDailyUsageServer(userId, 'transcribe') >= dailyLimit) return overQuotaRes()
    // 终身闸第①拍：用 >= 判（这次还没计，累计已达上限就该挡）。仅匿名读，注册用户连这次查询都不发。
    if (isAnonymous && await readLifetimeUsageServer(userId, 'transcribe') >= ANON_TRANSCRIBE_LIFETIME) {
      return overQuotaRes()
    }

    const inputBuf = Buffer.from(await file.arrayBuffer())
    const ext      = mimeToExt(file.type)

    // ——— 闸① 只包住 ffmpeg 这一段（对齐 CPU）———
    // 拿不到名额就排队，排不上/等太久回 503「人多」——总好过让 25 个 ffmpeg 同时抢 2 核，
    // 那会把整个进程（含所有页面的 SSR）一起拖慢，而不只是拖慢录音功能。
    // ⚠️ 排队同样【必须在计次之前】（与下面 ASR 闸同一条纪律）：这里被拒的请求一次都没计、一分钱没花。
    const cpuSlot = await transcodeGate.acquire()
    if (!cpuSlot.ok) return busyRes('transcode_gate', cpuSlot.reason)
    let wavBuf: Buffer
    try {
      wavBuf = await transcodeToWav(inputBuf, ext)
    } finally {
      // ⚠️ CPU 名额必须在这里就还掉，【绝不能】攥着它去排 ASR 的队：
      //    攥着等于把两道闸串成一道，ASR 并发会被转码的上限（2）反向卡死 —— 那正是 P1-2 要修掉的病。
      //    转码一结束 CPU 就闲了，名额立刻让给下一个等着转码的人。
      cpuSlot.release()
    }
    // 构造 WAV Blob 传给 transcription 层，令其 resolveFormat 得到 "wav"
    const wavBlob  = new Blob([new Uint8Array(wavBuf)], { type: 'audio/wav' })

    // ——— 闸② 只包住豆包调用这一段（对齐上游配额）———
    // 转码已在闸① 里做完并还了名额，绝不能圈进这道闸（圈进来 = 拿豆包配额去限 CPU，白白拉低 ASR 吞吐）。
    // ⚠️ 排队【必须在计次之前】：排队等待与超时都发生在花钱之前，等超时的用户一次都没扣，
    //    否则「排了队、还超时、还被扣次数」= 白扣，不可接受。名额到手之后才计次，计次点依旧紧贴 ASR。
    const slot = await asrGate.acquire()
    if (!slot.ok) return busyRes('asr_gate', slot.reason)
    try {
      // ② 计次的分界线就在这一行：它下面是花钱的豆包调用，它上面的任何失败都不曾计次。
      const dailyCount = await bumpDailyUsageServer(userId, 'transcribe')
      if (dailyCount > dailyLimit) return overQuotaRes()
      // 终身闸第②拍（硬防线）：读在 bump【之后】，故这次的递增以及并发请求的递增都已计入总和，
      // 判定用 > 而非 >=（与上面 dailyCount 同口径：值含本次）。挡住时本次已计一次日额度、
      // 但豆包一次都没被调用 —— 花钱的那一步没发生，这正是本闸唯一在意的事。
      if (isAnonymous && await readLifetimeUsageServer(userId, 'transcribe') > ANON_TRANSCRIBE_LIFETIME) {
        return overQuotaRes()
      }

      // 16kHz mono 16-bit PCM: (bytes - 44-byte header) / 32000 ≈ 秒数
      const duration_s = Math.max(0, (wavBuf.length - 44) / 32000)
      billedDurationS = duration_s   // 供 catch 给「已跑完整趟」的失败记真实费用
      // transcribe 处于建语料之前，无 corpusId；带 userId 归属 ASR 转写留证。
      const text = await runWithRawLogContext({ userId, corpusId: null }, () =>
        transcribeAudio(wavBlob),
      )
      // metadata.phase：按 scene 分 transcribe_story / transcribe_practice（缺省 'transcribe'），
      // 让看板把「语料转写」「练习转写」两条链路的耗时/故障分开归位，不落 other 桶。
      await logApiUsage({ service: 'doubao_asr', endpoint: 'openspeech.bytedance.com/auc/bigmodel/recognize/flash', usage_amount: duration_s, usage_unit: 'seconds', estimated_cost_cny: duration_s * API_PRICING.doubao_asr_per_second, latency_ms: Date.now() - t0, status: 'success', user_id: userId, is_anonymous: isAnonymous, is_qa: isQaRequest(req, userId), metadata: { phase } })
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
    // 计费口径不变：仅 EMPTY_TRANSCRIPT（豆包完整处理整段音频、只是没识别出人声）按真实时长记，其余记 0。
    const isUserInputError = isAppError(e) && e.code === 'EMPTY_TRANSCRIPT'
    const failedDurationS  = isUserInputError ? (billedDurationS ?? 0) : 0
    // 「空录音」= 归因为 user_input（含 EMPTY_TRANSCRIPT 与豆包静音码 20000003，见 classifyErrorKind）。
    // 仅这类失败、且客户端上报了采集信号时，把三信号落 metadata.audio 供看板算假空率（峰值高却转写空=疑似采集问题）。
    // 只加 metadata 字段：不碰上面 failedDurationS 计费、不碰 error_kind、不碰下方响应码/计次。
    const isEmptyRecording = classifyErrorKind(e) === ERROR_KIND_USER_INPUT
    const audioMeta = isEmptyRecording && audioSignals
      ? { audio: { peak: audioSignals.peak, durMs: audioSignals.durMs, bytes: audioSignals.bytes } }
      : {}
    await logApiUsage({
      service: 'doubao_asr',
      endpoint: 'openspeech.bytedance.com/auc/bigmodel/recognize/flash',
      usage_amount: failedDurationS,
      usage_unit: 'seconds',
      estimated_cost_cny: failedDurationS * API_PRICING.doubao_asr_per_second,
      latency_ms: Date.now() - t0,
      status: 'error',
      ...(attribution ? { user_id: attribution.userId, is_anonymous: attribution.isAnonymous } : {}),
      // 失败也烧钱（EMPTY_TRANSCRIPT 那一类豆包已完整跑过一趟、照样计费），故失败行同样要标 QA，
      // 否则自测的失败成本仍混在真实数字里。attribution 为 null（鉴权前就挂了）时只剩请求头这一路判定。
      is_qa: isQaRequest(req, attribution?.userId),
      // phase 始终打（按环节归位；scene 已解析则为 transcribe_story/transcribe_practice，否则兜底 'transcribe'）；
      // error_code/error_message/logId 三键来自豆包响应、无用户内容；
      // 再经 errorKindMeta 叠四分类归因（空录音/静音→user_input、并发超限→capacity、网络中断→network，
      // 均不计系统故障；系统故障=缺键）。只影响归类，不碰上面 billedDurationS 计费与下方响应码/计次。
      metadata: {
        phase,
        ...errorLogMeta(e),
        ...errorKindMeta(e),
        ...audioMeta,
      },
    })
    logErr('[transcribe API]', e)
    // 不回传内部 message；仅保留受控的 AppError.code（客户端据此区分如 EMPTY_TRANSCRIPT 的友好提示）
    if (isAppError(e)) {
      // 兜底：即便排了队，我方 release 与豆包服务端计数回落之间仍有时序窗口，偶发仍会撞并发限额。
      // 45000292 = 豆包并发超限，与队列满/超时是同一件事（人多），归到同一个 ASR_BUSY 分支，
      // 别让它变成「转写失败」把锅甩给产品。不自动重试的取舍见交付说明。
      if (e.code === DOUBAO_CONCURRENCY_LIMIT_CODE) return busyRes('doubao_upstream', 'upstream_limit')
      // EMPTY_TRANSCRIPT（录到了音但没有可用人声）与豆包静音码 20000003（纯静音、豆包直接判无人声）
      // 都是用户输入问题、不是服务端故障，用 422 而非 500：语义上「请求格式没问题、内容无法处理」正是 422。
      // 两码必须同路——classifyErrorKind（types/errors.ts）早已把两者都归 user_input，响应码若只认前者，
      // 静音会落 500 被客户端记成 server_5xx，与成本看板的归因互相矛盾（2026-08 生产实证后修正）。
      // 前端按 !res.ok + code 判分支，状态码换了仍命中。其余豆包码没有生产证据支持归 422，保持 500。
      const status = e.code === 'EMPTY_TRANSCRIPT' || e.code === DOUBAO_SILENCE_CODE ? 422 : 500
      return NextResponse.json({ error: '转写失败，请稍后再试', code: e.code }, { status })
    }
    return NextResponse.json({ error: '转写失败，请稍后再试' }, { status: 500 })
  }
}
