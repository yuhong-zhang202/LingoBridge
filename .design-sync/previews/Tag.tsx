import { Tag } from 'lingobridge'

export const Variants = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
    <Tag label="当季热题" variant="green" />
    <Tag label="Part 2" variant="gradient" />
    <Tag label="已归档" variant="gray" />
  </div>
)

export const EmphasisGreen = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <Tag label="AI 整理后" variant="green" />
    <Tag label="推荐" variant="green" />
    <Tag label="高匹配" variant="green" />
  </div>
)
