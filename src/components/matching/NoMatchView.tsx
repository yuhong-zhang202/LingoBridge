/**
 * @module   NoMatchView
 * @desc     匹配页无结果态引导 —— 两种触发：variant='noMatch'（题库真没有这道题，三层漏斗全空）
 *           与 variant='lowScore'（召回到题但重排后全部低于展示阈值，用户可见题=0）。两种都给一致的
 *           「换个角度 / 重新讲一个故事」引导，替代过去的一行灰字。按钮文案诚实：当前仅跳回首页重述，
 *           不暗示能在本故事上原地换角度重匹配（跳转行为仍是回首页 '/'）。
 * @author   LingoBridge
 * @created  2026-06-05
 */
'use client'
import { useNav } from '@/components/NavProgress'

interface Props {
  primaryDimension: string
  primaryPointName: string
  /** noMatch=一道题都没召回；lowScore=召回到题但都太低分被隐藏 */
  variant?: 'noMatch' | 'lowScore'
}

export default function NoMatchView({ primaryDimension, primaryPointName, variant = 'noMatch' }: Props) {
  const { navigate } = useNav() // 两个「回首页重新讲述」入口走 navigate → 点击即亮顶部进度条
  const isLowScore = variant === 'lowScore'
  const title = isLowScore ? '还没有特别贴合的题' : '题库还没有这道题'
  const lead = isLowScore ? '有一些相关题目，但都不太贴合你的这个故事，它更像' : '我们识别到你的故事属于'

  return (
    <div className="flex flex-col items-center text-center px-4 py-12">
      <p className="text-[2.75rem] mb-6">🌱</p>
      <h2 className="text-[1.125rem] font-bold text-v2-text-primary mb-2">{title}</h2>
      <p className="text-[0.8125rem] text-v2-text-muted mb-1">{lead}</p>
      <p className="text-[0.8125rem] font-semibold text-v2-text-primary mb-8">
        {primaryDimension} · {primaryPointName}
      </p>

      <p className="text-[0.8125rem] text-v2-text-secondary leading-relaxed max-w-[300px] mb-8">
        换个角度、或讲一个新的故事，也许能遇到更贴合的雅思题。
      </p>

      {/* 两个入口都仅跳回首页重新讲述（当前不支持原地重匹配），文案如实不夸大 */}
      <div className="flex items-center gap-5">
        <button
          onClick={() => navigate('/')}
          className="text-[0.8125rem] text-v2-text-muted active:opacity-60"
        >
          重新讲一个故事
        </button>
        <button
          onClick={() => navigate('/')}
          className="text-[0.8125rem] font-medium text-brand-primary-dark active:opacity-60"
        >
          换一道雅思题来练 →
        </button>
      </div>
    </div>
  )
}
