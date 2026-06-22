import { Chip } from 'lingobridge'

export const Variants = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <Chip variant="gradient">练习</Chip>
    <Chip variant="ghost">全部</Chip>
    <Chip variant="default">Part 1</Chip>
  </div>
)

export const GhostFilter = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <Chip variant="ghost" active>全部</Chip>
    <Chip variant="ghost">Part 1</Chip>
    <Chip variant="ghost">Part 2</Chip>
  </div>
)

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Chip size="sm" variant="gradient">练习</Chip>
    <Chip size="md" variant="gradient">开始分析</Chip>
  </div>
)
