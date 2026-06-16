/**
 * @module   NoMatchView
 * @desc     匹配页无结果态 — 主维度无题时的兜底引导
 * @author   LingoBridge
 * @created  2026-06-05
 */
'use client'
import { useRouter } from 'next/navigation'
import { GRADIENT_BORDER_STYLE } from '@/lib/constants'
import Card from '@/components/Card'

interface Props {
  primaryDimension: string
  primaryPointName: string
}

export default function NoMatchView({ primaryDimension, primaryPointName }: Props) {
  const router = useRouter()
  const isValue = primaryDimension === '价值底色'

  return (
    <div className="flex flex-col items-center text-center px-4 py-12">
      <p className="text-[44px] mb-6">🌱</p>
      <h2 className="text-[18px] font-bold text-v2-text-primary mb-2">题库还没有这道题</h2>
      <p className="text-[13px] text-v2-text-muted mb-1">
        我们识别到你的故事属于
      </p>
      <p className="text-[13px] font-semibold text-v2-text-primary mb-8">
        {primaryDimension} · {primaryPointName}
      </p>

      {isValue && (
        <Card className="w-full px-4 py-4 mb-8 text-left">
          <span className="text-[11px] font-medium bg-[#EDF6EB] border border-[#C0DDB9] text-[#3D7A38] px-[10px] py-[4px] rounded-full inline-block mb-3">
            {primaryDimension} · {primaryPointName}
          </span>
          <p className="text-[14px] font-semibold text-v2-text-primary leading-snug mb-2">
            这类故事的背后，常常藏着一次
            <span className="text-brand-primary-dark">「说实话、表明态度」</span>
            的时刻
          </p>
          <p className="text-[12px] text-v2-text-secondary leading-relaxed mb-3">
            如果你愿意，可以尝试从这个角度讲述，也许会遇到更贴合的题目。
          </p>
          <button
            onClick={() => router.push('/')}
            className="px-5 py-2 rounded-full text-[13px] font-medium text-v2-text-secondary active:scale-[0.97] transition-transform duration-150"
            style={GRADIENT_BORDER_STYLE}
          >
            切换角度讲述 →
          </button>
        </Card>
      )}

      <div className="flex items-center gap-5">
        <button
          onClick={() => router.push('/')}
          className="text-[13px] text-v2-text-muted active:opacity-60"
        >
          重新讲一个故事
        </button>
        <button
          onClick={() => router.push('/')}
          className="text-[13px] font-medium text-brand-primary-dark active:opacity-60"
        >
          换一道雅思题来练 →
        </button>
      </div>
    </div>
  )
}
