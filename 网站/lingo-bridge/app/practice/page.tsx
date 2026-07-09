import { FlowShell } from '@/components/lingo/app-shell'
import { PracticeView } from '@/components/lingo/practice-view'

export default function PracticePage() {
  return (
    <FlowShell ambient={false}>
      <PracticeView />
    </FlowShell>
  )
}
