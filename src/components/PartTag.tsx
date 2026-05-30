/**
 * @module   PartTag
 * @desc     Part 标签 — 复用 Tag variant="gradient"，保持对外接口不变
 * @author   LingoBridge
 * @created  2026-05-28
 */
import Tag from '@/components/Tag'

/**
 * Part 标签组件
 * @param label  标签文字，如 "Part 1"
 */
export default function PartTag({ label }: { label: string }) {
  return <Tag label={label} variant="gradient" />
}
