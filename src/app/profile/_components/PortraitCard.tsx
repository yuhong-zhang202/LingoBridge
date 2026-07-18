/**
 * @module   PortraitCard
 * @desc     「我的画像」卡 — 复用 PortraitRadar 渲染六维雷达；无语料时展示锁定空态。等高列(h-full)
 * @author   LingoBridge
 * @created  2026-07-01
 */
'use client'
import { type JSX, useMemo } from 'react'
import { Lock } from 'lucide-react'
import Card from '@/components/Card'
import PortraitRadar from './PortraitRadar'
import { useCorpusCount, useDimensionScores } from '@/hooks/profile-data'

// 空态占位形状（雷达模糊+锁住，仅装饰，值域 0–1）
const PORTRAIT_PLACEHOLDER: readonly [number, number, number, number, number, number] = [0.72, 0.5, 0.45, 0.62, 0.4, 0.55]

/**
 * 我的画像卡
 * @sideEffect 经 SWR 读语料段数与六维得分（corpus 与 IdentityCard 共用 'profile:corpus' key 去重）
 */
export default function PortraitCard(): JSX.Element {
  const { count: corpusCount, isLoading: corpusLoading } = useCorpusCount()
  const { scores, isLoading: scoresLoading } = useDimensionScores()

  // 顺序须与 PortraitRadar 的轴顺序一致（value 维暂无观察点，恒为 0，属预期）
  const values = useMemo<readonly [number, number, number, number, number, number]>(() => {
    const scoreFor = (id: string) => scores.find((s) => s.dimensionId === id)?.score ?? 0
    return [
      scoreFor('emotion'),
      scoreFor('relationship'),
      scoreFor('space'),
      scoreFor('spirit'),
      scoreFor('growth'),
      scoreFor('value'),
    ]
  }, [scores])

  // 两项都加载完再判空态（与原 loaded 语义一致：出错时 isLoading 也为 false → 视为已加载、按 0 走空态）
  const loaded = !corpusLoading && !scoresLoading
  const showEmpty = loaded && corpusCount === 0

  // gradient 描边：本卡是「AI 生成」内容，按设计系统属强调卡（唯一符合「AI 输出」的 profile 卡）
  return (
    <Card variant="gradient" className="p-5 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[14px] font-semibold text-v2-text-primary">我的画像</span>
      </div>
      <p className="text-[12px] text-v2-text-muted mb-2">
        {showEmpty ? '录一条故事后生成专属语料维度' : `基于你的 ${corpusCount} 段语料`}
      </p>

      <div className="flex-1 flex items-center justify-center">
        {showEmpty ? (
          <div className="relative w-full flex justify-center">
            {/* 占位雷达是装饰：aria-hidden 掉，避免读屏念出 PortraitRadar 里的假数值 */}
            <div aria-hidden="true" style={{ filter: 'blur(4px)', opacity: 0.55 }}>
              <PortraitRadar values={PORTRAIT_PLACEHOLDER} />
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 bg-bg-surface/50">
              <Lock size={20} className="text-brand-primary-dark mb-2" />
              <p className="text-[13px] font-medium text-v2-text-secondary leading-relaxed">
                录一条故事后，这里会生成专属语料维度
              </p>
            </div>
          </div>
        ) : (
          <PortraitRadar values={values} />
        )}
      </div>
    </Card>
  )
}
