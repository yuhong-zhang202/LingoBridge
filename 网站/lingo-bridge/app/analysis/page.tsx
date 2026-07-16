import { FlowShell, FlowTopBar } from '@/components/lingo/app-shell'
import { AnalysisView } from '@/components/lingo/analysis-view'

export default function AnalysisPage() {
  return (
    <FlowShell ambient={false}>
      <FlowTopBar title="侧重点分析" backHref="/matching" step="分析" closeHref="/" />
      <AnalysisView />
    </FlowShell>
  )
}
