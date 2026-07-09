import { FlowShell, FlowTopBar } from '@/components/lingo/app-shell'
import { RestructureView } from '@/components/lingo/restructure-view'

export default function RestructurePage() {
  return (
    <FlowShell ambient={false}>
      <FlowTopBar title="整理你的故事" backHref="/recording" step="整理" closeHref="/" />
      <RestructureView />
    </FlowShell>
  )
}
