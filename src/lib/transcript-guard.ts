/**
 * @module   transcript-guard
 * @desc     转写后文本可用性检查——纯函数，无副作用
 * @author   LingoBridge
 * @created  2026-06-03
 */

// 拦截 ASR 对纯噪音的固定幻觉输出，待实际观察到后再填，切勿凭空加入正常词汇
const HALLUCINATION_BLACKLIST: string[] = []

export interface TranscriptGuardResult {
  usable: boolean
  reason?: 'empty' | 'too_short' | 'blacklist'
}

/**
 * 检查转写文本是否可用
 * @param text       转写后文本
 * @param blacklist  黑名单词汇（默认用模块常量；测试时可注入临时列表）
 * @returns          { usable, reason? }
 */
export function checkTranscriptUsable(
  text: string,
  blacklist: string[] = HALLUCINATION_BLACKLIST,
): TranscriptGuardResult {
  const trimmed = text.trim()
  if (!trimmed) return { usable: false, reason: 'empty' }

  // 去除所有空白与中英文标点、符号后统计有效字符数
  const stripped = trimmed.replace(/[\s\p{P}\p{S}]/gu, '')
  if (stripped.length < 3) return { usable: false, reason: 'too_short' }

  if (blacklist.some((kw) => trimmed.includes(kw))) {
    return { usable: false, reason: 'blacklist' }
  }

  return { usable: true }
}
