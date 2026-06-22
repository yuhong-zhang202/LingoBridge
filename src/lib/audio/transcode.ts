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

if (process.env.NODE_ENV !== 'production') {
  console.log('[Transcode] ffmpeg binary path:', ffmpegBin)
}
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

  const startedAt = Date.now()

  try {
    await new Promise<void>((resolve, reject) => {
      // 分拆 .on() 调用——TS fluent-ffmpeg 重载在链式调用时推断 event 类型有误
      const cmd = ffmpeg(inPath)
        .audioFrequency(16000)
        .audioChannels(1)
        .audioCodec('pcm_s16le')
        .format('wav')
      cmd.on('error', (err: Error, _stdout: string | null, stderr: string | null) => {
        const appErr: AppError = {
          code:    'TRANSCODE_FAILED',
          message: `ffmpeg 转码失败：${err.message}`,
          cause:   { stderr, originalError: err },
        }
        reject(appErr)
      })
      cmd.on('end', () => resolve())
      cmd.save(outPath)
    })

    const outBuf = await fs.readFile(outPath)
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Transcode] done', { inputExt, ms: Date.now() - startedAt, outBytes: outBuf.byteLength })
    }
    return outBuf
  } finally {
    // warm 容器的 /tmp 持久存在，allSettled 确保单个失败不阻塞另一个
    await Promise.allSettled([fs.unlink(inPath), fs.unlink(outPath)])
  }
}
