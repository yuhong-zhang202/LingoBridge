/**
 * @module   errors
 * @desc     全局统一错误类型定义（ENGINEERING.md §4）
 * @author   LingoBridge
 * @created  2026-06-03
 */

export type AppError = {
  code: string
  message: string
  cause?: unknown
}
