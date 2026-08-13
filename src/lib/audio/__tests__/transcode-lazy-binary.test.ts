/**
 * @module   audio/transcode-lazy-binary.test
 * @desc     ffmpeg 二进制「惰性解析」守卫 —— 2026-08-12 生产连续 3 次部署失败的直接防线。
 *           事故：香港构建机拉 ffmpeg-static 的二进制被掐（ECONNRESET），而 transcode.ts 当时
 *           在模块顶层就检查二进制并 throw，next build 收集 /api/transcribe 页面数据时 import 到它
 *           → 当场抛 → 整个构建失败、全站发不出去。
 *
 *           本文件钉三条：
 *             ① 二进制不存在时，**import 本模块不得抛**（这条直接对应事故：import 抛 = 构建失败）；
 *             ② 失败只是推迟、不是消失：真去转码时仍抛 FFMPEG_NOT_FOUND，语义与文案不变；
 *             ③ 解析优先级 FFMPEG_PATH > ffmpeg-static > 系统 ffmpeg，且解析结果会缓存。
 *
 *           全部用替身，不碰真 ffmpeg、不落真文件（fluent-ffmpeg 整体替身化）。
 * @author   LingoBridge
 * @created  2026-08-12
 */
jest.mock('server-only', () => ({}))

// fluent-ffmpeg 替身：记录 setFfmpegPath 收到的路径；构造出的 command 立刻走 error 回调，
// 这样 transcodeToWav 不会真去 spawn 二进制，但解析那段代码是真跑的。
jest.mock('fluent-ffmpeg', () => {
  const mockSetPath = jest.fn()
  const mockFactory = jest.fn(() => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const cmd = {
      audioFrequency: () => cmd,
      audioChannels:  () => cmd,
      audioCodec:     () => cmd,
      duration:       () => cmd,
      format:         () => cmd,
      kill:           () => undefined,
      on: (event: string, handler: (...args: unknown[]) => void) => { handlers[event] = handler; return cmd },
      save: () => { setImmediate(() => { handlers.error?.(new Error('替身：不真跑 ffmpeg'), null, null) }) },
    }
    return cmd
  })
  return { __esModule: true, default: Object.assign(mockFactory, { setFfmpegPath: mockSetPath }) }
})

// ffmpeg-static 返回 null = 构建机上「安装脚本被拦、二进制没下来」的真实状态
jest.mock('ffmpeg-static', () => ({ __esModule: true, default: null }))

import { writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 取当前模块注册表里的被测模块与 fluent-ffmpeg 替身
 * ⚠️ 必须在 resetModules 之后【同批】取：替身工厂会在重置后重新执行、产出新的 jest.fn，
 *    在文件顶部 import 一次拿到的是上一轮的旧实例（踩过，断言恒为 0 次调用）。
 * @returns  被测函数 + 当前这一轮的 setFfmpegPath 替身
 */
async function loadTranscode(): Promise<{
  transcodeToWav: (input: Buffer, ext: string) => Promise<Buffer>
  setFfmpegPath:  jest.Mock
}> {
  const mod       = await import('@/lib/audio/transcode')
  const ffmpegMod = await import('fluent-ffmpeg') as unknown as { default: { setFfmpegPath: jest.Mock } }
  return { transcodeToWav: mod.transcodeToWav, setFfmpegPath: ffmpegMod.default.setFfmpegPath }
}

/** 每个用例都要一份干净的模块（解析结果有进程内缓存，且 PATH/FFMPEG_PATH 会被改） */
const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('ffmpeg 二进制缺失 · import 阶段绝不能抛（构建失败的直接防线）', () => {
  test('ffmpeg-static 返回 null 且 PATH 里也没有 ffmpeg：import 模块不抛、setFfmpegPath 一次都没被调用', async () => {
    process.env.PATH = '/nonexistent-dir-for-test'
    delete process.env.FFMPEG_PATH

    // 这一行就是事故的复现点：惰性化之前它会抛 FFMPEG_NOT_FOUND，next build 随之整个失败
    await expect(import('@/lib/audio/transcode')).resolves.toBeDefined()
    // 没人调用转码，就不该有任何解析动作发生
    const { setFfmpegPath } = await loadTranscode()
    expect(setFfmpegPath).not.toHaveBeenCalled()
  })

  test('失败只是推迟不是消失：真去转码时仍抛 FFMPEG_NOT_FOUND，文案保留原句', async () => {
    process.env.PATH = '/nonexistent-dir-for-test'
    delete process.env.FFMPEG_PATH

    const { transcodeToWav } = await loadTranscode()

    await expect(transcodeToWav(Buffer.from([1, 2, 3]), 'webm')).rejects.toMatchObject({
      code:    'FFMPEG_NOT_FOUND',
      message: expect.stringContaining('ffmpeg-static 未返回二进制路径'),
    })
  })
})

describe('ffmpeg 二进制解析 · 优先级与缓存', () => {
  test('FFMPEG_PATH 指向的文件存在：优先用它（不再往下降级），并交给 fluent-ffmpeg', async () => {
    // 用本测试文件自身当「存在的文件」：解析只做 existsSync，不会真去执行它
    process.env.FFMPEG_PATH = __filename

    const { transcodeToWav, setFfmpegPath } = await loadTranscode()
    // 替身让 ffmpeg 立刻报 error → 抛 TRANSCODE_FAILED，说明已经走过解析、进到真正的转码流程
    await expect(transcodeToWav(Buffer.from([1, 2, 3]), 'webm')).rejects.toMatchObject({ code: 'TRANSCODE_FAILED' })
    expect(setFfmpegPath).toHaveBeenCalledWith(__filename)
  })

  test('FFMPEG_PATH 配了但文件不存在：抛 FFMPEG_BINARY_MISSING（显式配置写错不静默降级）', async () => {
    process.env.FFMPEG_PATH = '/definitely/not/here/ffmpeg'

    const { transcodeToWav } = await loadTranscode()

    await expect(transcodeToWav(Buffer.from([1, 2, 3]), 'webm')).rejects.toMatchObject({
      code:    'FFMPEG_BINARY_MISSING',
      message: expect.stringContaining('/definitely/not/here/ffmpeg'),
    })
  })

  test('ffmpeg-static 没下来但系统装了 ffmpeg：兜底用系统的（构建机被掐时仍能转码）', async () => {
    // 伪造一个 PATH 目录，里面「有 ffmpeg」——同样只靠 existsSync 判定，不会真去执行它
    const fakeBinDir = dirname(__filename)
    const fakeFfmpeg = join(fakeBinDir, 'ffmpeg')
    writeFileSync(fakeFfmpeg, '#!/bin/sh\n')
    try {
      process.env.PATH = fakeBinDir
      delete process.env.FFMPEG_PATH

      const { transcodeToWav, setFfmpegPath } = await loadTranscode()
      await expect(transcodeToWav(Buffer.from([1, 2, 3]), 'webm')).rejects.toMatchObject({ code: 'TRANSCODE_FAILED' })
      expect(setFfmpegPath).toHaveBeenCalledWith(fakeFfmpeg)
    } finally {
      unlinkSync(fakeFfmpeg)
    }
  })

  test('解析结果缓存：连续两次转码只解析一次（不给每个请求都扫一遍 PATH）', async () => {
    process.env.FFMPEG_PATH = __filename

    const { transcodeToWav, setFfmpegPath } = await loadTranscode()
    await expect(transcodeToWav(Buffer.from([1]), 'webm')).rejects.toMatchObject({ code: 'TRANSCODE_FAILED' })
    await expect(transcodeToWav(Buffer.from([1]), 'webm')).rejects.toMatchObject({ code: 'TRANSCODE_FAILED' })

    expect(setFfmpegPath).toHaveBeenCalledTimes(1)
  })
})
