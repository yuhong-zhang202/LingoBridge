/**
 * @module   audio/transcode
 * @desc     服务端音频转码 — 任意输入格式统一转为 16kHz 单声道 WAV（via ffmpeg-static）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import 'server-only'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegBin from 'ffmpeg-static'
import { existsSync } from 'node:fs'
import fs from 'fs/promises'
import path from 'path'
import type { AppError } from '@/types/errors'

// ffmpeg-static 在当前系统找不到二进制时返回 null；开机时立即失败比请求时失败更好
if (!ffmpegBin) {
  throw { code: 'FFMPEG_NOT_FOUND', message: 'ffmpeg-static 未返回二进制路径，请重新安装 ffmpeg-static' } satisfies AppError
}
// serverComponentsExternalPackages 确保路径指向真实 node_modules 二进制；此处二次确认
if (!existsSync(ffmpegBin)) {
  throw { code: 'FFMPEG_BINARY_MISSING', message: `ffmpeg 二进制文件不存在：${ffmpegBin}` } satisfies AppError
}
ffmpeg.setFfmpegPath(ffmpegBin)

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
 */
export async function transcodeToWav(input: Buffer, inputExt: string): Promise<Buffer> {
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
        //   而转码【在并发闸之外】（asrGate 对齐的是豆包配额、刻意不圈转码），
        //   所以几个并发请求就能把单实例打到 OOM，且进程被 kill 时 finally 的 unlink 不执行、
        //   /tmp 里的大文件会一直堆积。
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
