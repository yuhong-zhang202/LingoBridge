import { FlowShell, FlowTopBar } from '@/components/lingo/app-shell'
import { MatchingView } from '@/components/lingo/matching-view'

export default function MatchingPage() {
  return (
    <FlowShell ambient={false}>
      <FlowTopBar title="为你匹配真题" backHref="/restructure" step="匹配" closeHref="/" />
      <MatchingView />
    </FlowShell>
  )
}
