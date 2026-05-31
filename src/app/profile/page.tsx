'use client'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'

export default function ProfilePage() {
  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col pb-[56px]">
      <div className="ambient-light" />
      <TopBar title="我的" />
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[14px] text-[#AAAAAA]">功能开发中</p>
      </div>
      <div className="flex-shrink-0"><TabBar /></div>
    </div>
  )
}
