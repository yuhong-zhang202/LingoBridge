/**
 * @module   transcription
 * @desc     语音转写服务 — 当前返回 mock 数据，接入 Whisper API 时只需替换此实现
 * @author   LingoBridge
 * @created  2026-05-15
 */

/**
 * 将录音 Blob 转写为文字
 * @param audioBlob  录音数据
 * @returns          转写后的文本
 */
export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  return 'I went to a nearby park last weekend and felt really relaxed.'
}
