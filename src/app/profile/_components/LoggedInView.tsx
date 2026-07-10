/**
 * @module   LoggedInView
 * @desc     「我的」已登录态专属内容 — Hero 打卡、双列统计、画像雷达、退出登录；
 *           自持语料数与雷达分值的真实数据加载，仅登录时由 page 条件挂载。
 * @author   LingoBridge
 * @created  2026-06-04
 */
'use client'

import { useState, useEffect } from 'react'
import { Flame, MessageCircle, Target, Lock } from 'lucide-react'
import Tag from '@/components/Tag'
import { GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'
import { listMyCorpus } from '@/lib/db/corpus'
import { getDimensionScores } from '@/lib/db/dimension-scores'
import { getStreak, getPracticeCount } from '@/lib/db/practice-sessions'
import PortraitRadar from './PortraitRadar'

// 空状态下「我的画像」用的占位形状（雷达会被模糊+锁住，仅作装饰，值域 0–1）
const PORTRAIT_PLACEHOLDER: readonly [number, number, number, number, number, number] = [0.72, 0.5, 0.45, 0.62, 0.4, 0.55]

interface LoggedInViewProps {
  stats: { corpus: number }
  targetBand: number
}

/**
 * 已登录态面板：Hero 打卡卡 + 双列副数据卡 + 我的画像雷达卡
 * @param stats      profileData.stats（corpus 占位，streak/practice 由内部真实加载）
 * @sideEffect       挂载时并行拉取 listMyCorpus + getDimensionScores，更新真实数据
 */
export default function LoggedInView({ stats: _stats }: LoggedInViewProps): JSX.Element {
  const [corpusCount, setCorpusCount] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [streak, setStreak] = useState(0)
  const [practiceCount, setPracticeCount] = useState(0)
  const [radarValues, setRadarValues] = useState<readonly [number, number, number, number, number, number]>(
    [0, 0, 0, 0, 0, 0],
  )

  useEffect(() => {
    Promise.all([listMyCorpus(), getDimensionScores(), getStreak(), getPracticeCount()])
      .then(([corpus, scores, streakVal, practiceVal]) => {
        setCorpusCount(corpus.length)
        const scoreFor = (id: string) => scores.find((s) => s.dimensionId === id)?.score ?? 0
        // 顺序须与 PortraitRadar 的轴顺序一致（value 维暂无观察点，恒为 0，属预期）
        const newValues: [number, number, number, number, number, number] = [
          scoreFor('emotion'),
          scoreFor('relationship'),
          scoreFor('space'),
          scoreFor('spirit'),
          scoreFor('growth'),
          scoreFor('value'),
        ]
        setRadarValues(newValues)
        setStreak(streakVal)
        setPracticeCount(practiceVal)
      })
      .catch((err: unknown) => {
        console.warn('[ProfilePage] 加载真实数据失败，保留占位', err)
      })
      .finally(() => setLoaded(true))
  }, [])

  // 数据加载完成且一条语料都没有 → 画像卡显示「未解锁」空态（模糊雷达 + 提示）
  const showEmpty = loaded && corpusCount === 0

  return (
    <>
      {/* ── 连续打卡 Hero 卡 */}
      <div
        className="rounded-[18px] px-[18px] py-[14px] mb-3"
        style={GRADIENT_BORDER_STYLE_FULL}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] text-v2-text-secondary">连续打卡</p>
            <p className="text-[26px] font-semibold text-v2-text-primary leading-none mt-[3px]">
              {streak}
              <span className="text-[13px] font-normal text-v2-text-secondary ml-[3px]">天</span>
            </p>
          </div>
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'rgba(212,135,90,0.10)' }}
          >
            <Flame size={24} color="#D4875A" />
          </div>
        </div>
      </div>

      {/* ── 双列副数据卡 */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-[16px] px-[14px] py-3" style={GRADIENT_BORDER_STYLE_FULL}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle size={14} color="#7BA699" />
              <span className="text-[12px] text-v2-text-secondary">语料</span>
            </div>
            <span className="text-[18px] font-semibold text-v2-text-primary leading-none">
              {corpusCount}
            </span>
          </div>
        </div>
        <div className="rounded-[16px] px-[14px] py-3" style={GRADIENT_BORDER_STYLE_FULL}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target size={14} color="#D4875A" />
              <span className="text-[12px] text-v2-text-secondary">练习</span>
            </div>
            <span className="text-[18px] font-semibold text-v2-text-primary leading-none">
              {practiceCount}
            </span>
          </div>
        </div>
      </div>

      {/* ── 我的画像卡 */}
      <div
        className="rounded-[16px] px-[18px] pt-4 pb-3.5 mb-3"
        style={GRADIENT_BORDER_STYLE_FULL}
      >
        <div className="flex justify-between items-start mb-1">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-v2-text-primary">我的画像</span>
              {!showEmpty && <Tag label="AI 生成" variant="green" />}
            </div>
            {!showEmpty && (
              <p className="text-[12px] text-v2-text-secondary mt-1">
                基于你的 {corpusCount} 段语料
              </p>
            )}
          </div>
          {!showEmpty && (
            <button className="text-[12px] font-medium text-brand-primary-dark mt-0.5 active:opacity-60">
              查看完整 →
            </button>
          )}
        </div>

        {showEmpty ? (
          <div className="relative">
            {/* 占位雷达是装饰：aria-hidden 掉，避免读屏念出 PortraitRadar 里的假数值 */}
            <div aria-hidden="true" style={{ filter: 'blur(4px)', opacity: 0.55 }}>
              <PortraitRadar values={PORTRAIT_PLACEHOLDER} />
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 bg-white/50">
              <Lock size={20} className="text-brand-primary-dark mb-2" />
              <p className="text-[14px] font-medium text-v2-text-secondary leading-relaxed">
                录一条故事后，这里会生成专属语料维度
              </p>
            </div>
          </div>
        ) : (
          <PortraitRadar values={radarValues} />
        )}
      </div>


    </>
  )
}
