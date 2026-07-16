import { FlowShell, FlowTopBar } from '@/components/lingo/app-shell'
import { FeedbackView } from '@/components/lingo/feedback-view'

export default function FeedbackPage() {
  return (
    <FlowShell>
      <FlowTopBar title="本场反馈卡片" closeHref="/" />
      <FeedbackView />
    </FlowShell>
  )
}
