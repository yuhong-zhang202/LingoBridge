import { AppShell } from '@/components/lingo/app-shell'
import { HomeHero } from '@/components/lingo/home-hero'

export default function HomePage() {
  return (
    <AppShell title="开始练习" ambient>
      <HomeHero />
    </AppShell>
  )
}
