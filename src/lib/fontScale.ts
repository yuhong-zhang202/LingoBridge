/**
 * @module   fontScale
 * @desc     全局字体档机制的共享常量与工具（设置页 UI + 运行时写入共用一处，真机好调）。
 *           档位系数写进根元素 CSS 变量 --fs-scale，配合 globals.css 的
 *           `html { font-size: calc(16px * var(--fs-scale,1)) }` 令全站 rem（含字号）联动缩放。
 *           持久化到 localStorage['lingobridge:font_scale']；首屏防 FOUC 的 head 内联脚本
 *           见 src/app/font-scale-init.ts（那份是独立 ES5 字符串，无法 import 本模块，故档值语义
 *           在两处各自维护——本模块管「UI 写什么」，脚本只负责「把已存的数原样应用」）。
 * @author   LingoBridge
 * @created  2026-08-02
 */

/** localStorage 键：全局字体档系数（与 storage.ts 同前缀 lingobridge:）。 */
export const FONT_SCALE_STORAGE_KEY = 'lingobridge:font_scale'

/** 默认档位系数（无存值或存值非法时回落到此，视觉等于改动前）。 */
export const FONT_SCALE_DEFAULT = 1

/**
 * 可选字体档位（一处可调常量，真机调档改这里即可）。
 * value 为根字号系数；label 为设置页展示名。特大只到 1.15——产品方明确要求
 * 「大字别太大导致高密度页挤压」。
 */
export const FONT_SCALE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.9, label: '小' },
  { value: 1.0, label: '标准' },
  { value: 1.1, label: '大' },
  { value: 1.15, label: '特大' },
]

/**
 * 把字体档系数写入根元素 CSS 变量，令全站字号即时生效（设置页选档时调用）。
 * @param scale  档位系数（应取自 FONT_SCALE_OPTIONS.value）
 * @sideEffect   修改 document.documentElement 的 --fs-scale
 */
export function applyFontScale(scale: number): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--fs-scale', String(scale))
}

/**
 * 读取已持久化的字体档系数；SSR / localStorage 不可用 / 存值非法时回落默认，绝不抛错。
 * @returns  当前档位系数
 */
export function readFontScale(): number {
  if (typeof window === 'undefined') return FONT_SCALE_DEFAULT
  try {
    const raw = localStorage.getItem(FONT_SCALE_STORAGE_KEY)
    if (!raw) return FONT_SCALE_DEFAULT
    const n = parseFloat(raw)
    return Number.isFinite(n) && n > 0 ? n : FONT_SCALE_DEFAULT
  } catch {
    return FONT_SCALE_DEFAULT
  }
}

/**
 * 持久化字体档系数并立即应用（设置页选档时调用）；隐私模式写不了则静默、仍即时应用当次。
 * @param scale  档位系数
 * @sideEffect   写 localStorage + setProperty('--fs-scale')
 */
export function saveFontScale(scale: number): void {
  applyFontScale(scale)
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(scale))
  } catch {
    /* 隐私模式：忽略持久化，当次会话内已即时生效 */
  }
}
