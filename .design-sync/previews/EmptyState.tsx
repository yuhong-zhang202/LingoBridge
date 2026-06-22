import { EmptyState } from 'lingobridge'

export const WithCta = () => (
  <div style={{ width: 380 }}>
    <EmptyState title="还没有语料" subtitle="去首页录一条故事，它会自动出现在这里" ctaLabel="去录制" onCta={() => {}} />
  </div>
)

export const TitleOnly = () => (
  <div style={{ width: 380 }}>
    <EmptyState title="还没有能匹配这道题的语料" />
  </div>
)
