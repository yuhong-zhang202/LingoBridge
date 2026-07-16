/**
 * @module   pronunciation
 * @desc     发音纠错纯函数 — 把句子里"听成的词"整词替换为"真正想说的词"
 * @author   LingoBridge
 * @created  2026-06-18
 */
import type { SavedPronunciation } from '@/lib/types'

/** 转义正则元字符，避免 heard 含特殊字符时匹配出错 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 仅当 heard 的首/末字符是单词字符时才在该侧加 \b 整词锚定；
 *  否则 \b 在 \W↔\W 处不成立（如 'c++' 末尾），会导致匹配失败。 */
function buildPattern(heard: string): RegExp {
  const left  = /\w/.test(heard[0] ?? '')                   ? '\\b' : ''
  const right = /\w/.test(heard[heard.length - 1] ?? '')    ? '\\b' : ''
  return new RegExp(`${left}${escapeRegExp(heard)}${right}`, 'gi')
}

/**
 * 用给定纠错把句子里"听成的词"整词替换为"真正想说的词"（大小写不敏感、整词匹配、替换全部出现）
 * @param sentence  原句（ASR 转写）
 * @param fixes     适用于该句的发音纠错（仅需 heard / intended）
 * @returns         替换后的句子；fixes 为空时原样返回
 */
export function applyPronunciationFixes(
  sentence: string,
  fixes: Pick<SavedPronunciation, 'heard' | 'intended'>[],
): string {
  return fixes.reduce((acc, f) => {
    if (!f.heard) return acc
    return acc.replace(buildPattern(f.heard), f.intended)
  }, sentence)
}
