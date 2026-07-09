/**
 * @module   FlowShellDesktop
 * @desc     桌面端核心链路统一外壳 —— 全沉浸版式：顶部极简进度栏（品牌左 · 5 点进度+当前步名居中 · 退出右）
 *           + 下方居中舞台区。无左侧面板、无边框分隔，整页同底色，让柔和的 Orb 舞台成为唯一主角。
 *           6 个流程页的桌面视图统一包在此壳内，进度由 activeStep 驱动（复用 StepBar 的 STEPS）。
 * @author   LingoBridge
 * @created  2026-07-04
 */
'use client'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Mic, X } from 'lucide-react'
import { STEPS, type StepKey } from '@/components/StepBar'

interface FlowShellDesktopProps {
  /** 当前激活步骤 */
  activeStep: StepKey
  /** 点击退出（顶栏 ✕） */
  onExit: () => void
  /** 舞台内容 */
  children: ReactNode
}

export default function FlowShellDesktop({
  activeStep,
  onExit,
  children,
}: FlowShellDesktopProps): JSX.Element {
  const activeIndex = STEPS.findIndex(s => s.key === activeStep)
  const current = STEPS[activeIndex]

  return (
    <div className="min-h-screen bg-bg-page flex flex-col">
      {/* 顶部极简进度栏（无边框，与舞台同底色，沉浸无缝） */}
      <header className="relative h-[72px] shrink-0 flex items-center justify-between px-8">
        {/* 品牌（点击回首页） */}
        <Link href="/" className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-[10px] bg-brand-primary grid place-items-center text-white">
            <Mic size={18} />
          </span>
          <span className="text-[17px] font-bold tracking-tight text-v2-text-primary">LingoBridge</span>
        </Link>

        {/* 进度：5 点（当前为拉长胶囊）+ 当前步名，绝对居中 */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-5">
          <div className="flex items-center gap-[14px]" aria-hidden="true">
            {STEPS.map((s, i) => {
              const isActive = i === activeIndex
              const isDone   = i < activeIndex
              return (
                <span
                  key={s.key}
                  className={
                    `h-[7px] rounded-full transition-[width,background-color] duration-300 ` +
                    (isActive
                      ? 'w-[26px] bg-brand-primary'
                      : isDone
                        ? 'w-[7px] bg-brand-primary'
                        : 'w-[7px] bg-[#DDDDDD]')
                  }
                />
              )
            })}
          </div>
          <span className="text-[13px] font-semibold text-v2-text-primary">
            <span className="sr-only">第 {activeIndex + 1} 步，共 {STEPS.length} 步：</span>
            {current?.label}
          </span>
        </div>

        {/* 退出 */}
        <button
          onClick={onExit}
          aria-label="退出练习"
          className="w-9 h-9 rounded-full grid place-items-center text-v2-text-secondary hover:bg-bg-muted transition-colors"
        >
          <X size={18} />
        </button>
      </header>

      {/* 舞台内容区 */}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}
