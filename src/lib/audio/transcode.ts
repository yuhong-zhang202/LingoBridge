/**
 * @module   audio/transcode
 * @desc     服务端音频转码 — 任意输入格式统一转为 16kHz 单声道 WAV（via ffmpeg-static）
 *
 *           ⚠️ 本函数【不自带并发闸】：ffmpeg 是 CPU 密集型，无限并发会把实例的核数超卖、
 *              连带拖慢同进程里所有请求（页面 SSR 也在同一个进程）。限流在调用方 —— 见
 *              api/transcribe/route.ts 的 transcodeGate（并发上限 = 实例 vCPU 数）。
 *              **新增调用方必须自己过那道闸**，否则等于开了一个绕过 CPU 限流的后门。
 *
 *           🔴【二进制解析惰性化，别挪回模块顶层】2026-08-12 加固。背景与**实测边界**都要看清：
 *              · 起因：生产连续 3 次部署失败，香港构建机拉 GitHub Releases 被掐
 *                （`ffmpeg-static/install.js` → `ECONNRESET`）。
 *              · ⚠️ 但那 3 次失败**不是本文件造成的**：日志显示挂在 Docker 的
 *                `RUN npm install && node node_modules/ffmpeg-static/install.js` 这一步（exit code 1），
 *                **根本没走到 `next build`**。故本次惰性化【修不好那个部署失败】，
 *                真正的修复在 Zeabur 侧的 `ZBPACK_INSTALL_COMMAND`（见 docs/部署交接-香港PaaS.md §10）。
 *              · 🔴 **A/B 实测（2026-08-13 复核，推翻了上一版注释里的判断）**：同一份 node_modules、
 *                同样把 node_modules/ffmpeg-static/ffmpeg 物理移走 + `rm -rf .next` 冷构建，只换代码版本：
 *                  – 顶层解析（惰性化之前）→ **构建失败**：`Failed to collect page data for /api/transcribe`
 *                  – 惰性解析（本版）      → **构建成功**
 *                即 §10 记的「顶层 throw 导致构建失败」机制**至今仍然复现**。上一版注释写成「已不复现」
 *                是对照组没真正复现改动前状态所致，勿据此把解析挪回顶层。
 *              · 所以惰性化解决的是一个**真实存在**的构建脆弱性：只要二进制没进镜像（网络被掐、npm 拦
 *                安装脚本、镜像层缓存失效…），顶层版本会让**整个构建**挂掉，而不只是转写坏。
 *                它同时是 §10 那条 `|| true` 兜底方案能成立的前提 —— 允许安装脚本失败而不炸构建。
 *              · 另外两条收益：① 二进制缺失时退化为「转写接口报 FFMPEG_NOT_FOUND、其余功能照常」；
 *                ② 多一条 `FFMPEG_PATH` / 系统 ffmpeg 的兜底路径，运维能在不改代码的前提下救场。
 *                解析顺序 FFMPEG_PATH > ffmpeg-static > 系统 ffmpeg，失败语义
 *                （FFMPEG_NOT_FOUND / FFMPEG_BINARY_MISSING）与惰性化之前一字不改，只是时机推迟。
 *              守卫测试：`__tests__/transcode-lazy-binary.test.ts`（二进制缺失时 import 不得抛）。
 * @author   LingoBridge
 * @created  2026-06-03
 */
import 'server-only'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStaticBin from 'ffmpeg-static'
import { existsSync } from 'node:fs'
import fs from 'fs/promises'
import path from 'path'
import type { AppError } from '@/types/errors'

/**
 * 解析结果缓存：只在第一次真正要转码时解析一次，之后直接复用。
 * null = 尚未解析（不是「解析失败」——失败会抛，不会写进缓存）。
 */
let ffmpegPathCache: string | null = null

/**
 * 在系统 PATH 里找 ffmpeg（第三顺位兜底）
 * @returns  找到的绝对路径；没找到返回 null
 *
 * 刻意只做 existsSync 扫描、不 spawn `which`：解析发生在请求路径上，
 * 不值得为找个路径去开子进程，也避免把 shell 引进来。
 */
function findSystemFfmpeg(): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const candidate = path.join(dir, 'ffmpeg')
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * 解析 ffmpeg 二进制路径并交给 fluent-ffmpeg（惰性，带缓存）
 * @returns  可用的 ffmpeg 二进制绝对路径
 * @throws   AppError { code: 'FFMPEG_BINARY_MISSING' } — FFMPEG_PATH 指定了但文件不存在
 * @throws   AppError { code: 'FFMPEG_NOT_FOUND' }      — 三条路径都没找到可用二进制
 *
 * 顺序：FFMPEG_PATH（运维显式指定，最高优先）> ffmpeg-static（正常情况）> 系统 ffmpeg（兜底）。
 * FFMPEG_PATH 一旦配了就不再往下降级：显式配置指到一个不存在的文件属配置错误，
 * 静默降级只会让人在别处 debug 半天。
 */
function resolveFfmpegPath(): string {
  if (ffmpegPathCache) return ffmpegPathCache

  const explicit = process.env.FFMPEG_PATH
  if (explicit) {
    if (!existsSync(explicit)) {
      throw { code: 'FFMPEG_BINARY_MISSING', message: `ffmpeg 二进制文件不存在：${explicit}` } satisfies AppError
    }
    ffmpeg.setFfmpegPath(explicit)
    ffmpegPathCache = explicit
    return explicit
  }

  // serverExternalPackages 确保 ffmpeg-static 的路径指向真实 node_modules 二进制；此处二次确认。
  // 它返回了路径但文件不在 = 安装脚本被拦（正是 2026-08-12 那次事故），此时继续往下找系统 ffmpeg，
  // 而不是直接抛：能跑就让它跑起来，比因为「预期的那个文件不在」而整台服务不能转码强。
  const resolved = (ffmpegStaticBin && existsSync(ffmpegStaticBin) ? ffmpegStaticBin : null) ?? findSystemFfmpeg()
  if (!resolved) {
    throw {
      code:    'FFMPEG_NOT_FOUND',
      message: 'ffmpeg-static 未返回二进制路径，请重新安装 ffmpeg-static（或配置 FFMPEG_PATH，或在系统里安装 ffmpeg）',
    } satisfies AppError
  }
  ffmpeg.setFfmpegPath(resolved)
  ffmpegPathCache = resolved
  return resolved
}

/**
 * 转码接受的最长音频秒数（硬闸，见 transcodeToWav 内注释）。
 * 依据：生产真实用户录音 66 条实测 p50=46s / p99=207s / 最长 207s，取 600 秒 ≈ p99 的 3 倍。
 */
const MAX_AUDIO_SECONDS = 600

/** 转码超时：实测 2.5 小时音频只需 6 秒，30 秒足以覆盖任何正常输入 */
const TRANSCODE_TIMEOUT_MS = 30_000

/**
 * WAV 产物体积上限（第二道闸，不依赖 ffmpeg 的时长判断）。
 * 16kHz × 单声道 × 2 字节 = 32000 字节/秒；留 10% 余量给 WAV 头与边界。
 */
const MAX_WAV_BYTES = Math.ceil(MAX_AUDIO_SECONDS * 32000 * 1.1)

/**
 * 将任意音频 Buffer 转码为 16kHz 单声道 PCM WAV
 * @param input     原始音频数据（webm / mp4 / ogg / wav 等均可）
 * @param inputExt  输入文件扩展名（不含点，如 "webm"、"mp4"）
 * @returns         WAV Buffer（16kHz, mono, pcm_s16le）
 * @throws          AppError { code: 'TRANSCODE_FAILED' } — ffmpeg 出错时
 * @throws          AppError { code: 'FFMPEG_NOT_FOUND' | 'FFMPEG_BINARY_MISSING' } — 找不到可用的 ffmpeg 二进制
 */
export async function transcodeToWav(input: Buffer, inputExt: string): Promise<Buffer> {
  // 二进制解析放在这里而不是模块顶层：顶层解析会让「构建机没装成 ffmpeg」变成「构建直接失败」，
  // 见本文件顶注的事故记录。放这里则退化为「转写接口报错、其余功能照常」。
  resolveFfmpegPath()
  const id      = crypto.randomUUID()
  const inPath  = path.join('/tmp', `lb_in_${id}.${inputExt}`)
  const outPath = path.join('/tmp', `lb_out_${id}.wav`)

  // mp4 的 moov atom 需要可 seek 的文件输入，必须先落盘而非用 stdin 管道
  await fs.writeFile(inPath, input)

  try {
    await new Promise<void>((resolve, reject) => {
      // 分拆 .on() 调用——TS fluent-ffmpeg 重载在链式调用时推断 event 类型有误
      const cmd = ffmpeg(inPath)
        .audioFrequency(16000)
        .audioChannels(1)
        .audioCodec('pcm_s16le')
        // 🔴【时长硬闸，2026-08-06 安全修复】体积上限（MAX_AUDIO_BYTES=10MB）挡不住时长：
        //   实测用 6kbps opus 编码，10MB 正好能塞进 2.5 小时音频、顺利通过体积闸，
        //   转成 16kHz 单声道 WAV 后是 274MB，会被下面的 readFile 整个读进内存，
        //   再 base64 编码（再涨 1.33 倍）发给豆包，单请求峰值约 640MB。
        //   转码不在 ASR 闸里（asrGate 对齐的是豆包配额、刻意不圈转码），它归调用方的【转码闸】管
        //   （transcodeGate，对齐 CPU 核数，见 api/transcribe/route.ts 顶部两道闸的说明）——
        //   但那道闸只压并发【个数】、压不住单个请求的内存峰值：并发 2 个 640MB 照样打爆 2GB 实例，
        //   且进程被 OOM kill 时 finally 的 unlink 不执行、/tmp 里的大文件会一直堆积。
        //   ⇒ 时长闸与并发闸各管一件事，谁都替代不了谁，这条 -t 不能因为「已经有闸了」就删。
        //   取 600 秒的依据：生产真实用户录音 66 条实测 p50=46s、p99=207s、最长 207s，
        //   600 秒是 p99 的近 3 倍，任何真实使用都碰不到，而攻击载荷被压到 10 分钟（WAV 约 19MB）。
        //   ⚠️ 改这个数前先重跑那份分布，别凭感觉调。
        .duration(MAX_AUDIO_SECONDS)
        .format('wav')
      // 转码超时：ffmpeg 卡住时（畸形容器、异常编码）不能让请求无限挂着占内存与文件句柄。
      // 实测 2.5 小时音频转码只要 6 秒，30 秒足够覆盖任何正常输入。
      const killer = setTimeout(() => { cmd.kill('SIGKILL') }, TRANSCODE_TIMEOUT_MS)
      cmd.on('error', (err: Error, _stdout: string | null, stderr: string | null) => {
        clearTimeout(killer)
        const appErr: AppError = {
          code:    'TRANSCODE_FAILED',
          message: `ffmpeg 转码失败：${err.message}`,
          cause:   { stderr, originalError: err },
        }
        reject(appErr)
      })
      cmd.on('end', () => { clearTimeout(killer); resolve() })
      cmd.save(outPath)
    })

    // 第二道闸：先看文件大小再决定要不要读进内存。
    // -t 理论上已经封住时长，但畸形容器有可能让 ffmpeg 误判时长基准而绕过它；
    // 这一步不依赖 ffmpeg 的任何判断，只认最终产物的字节数，是纯物理防线。
    // 阈值 = 时长上限对应的 WAV 体积 + 一点余量（16kHz × 单声道 × 2 字节 = 32000 字节/秒）。
    const { size } = await fs.stat(outPath)
    if (size > MAX_WAV_BYTES) {
      const appErr: AppError = {
        code:    'TRANSCODE_FAILED',
        message: `转码产物过大（${Math.round(size / 1024 / 1024)}MB），已拒绝`,
        cause:   { size, limit: MAX_WAV_BYTES },
      }
      throw appErr
    }
    const outBuf = await fs.readFile(outPath)
    return outBuf
  } finally {
    // warm 容器的 /tmp 持久存在，allSettled 确保单个失败不阻塞另一个
    await Promise.allSettled([fs.unlink(inPath), fs.unlink(outPath)])
  }
}
