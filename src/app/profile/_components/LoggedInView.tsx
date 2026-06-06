/**
 * @module   LoggedInView
 * @desc     「我的」已登录态专属内容 — Hero 打卡、双列统计、画像雷达、退出登录；
 *           自持语料数与雷达分值的真实数据加载，仅登录时由 page 条件挂载。
 * @author   LingoBridge
 * @created  2026-06-04
 */
'use client'

import { useState, useEffect } from 'react'
import { Flame, MessageCircle, Target } from 'lucide-react'
import Tag from '@/components/Tag'
import { GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'
import { listMyCorpus } from '@/lib/db/corpus'
import { getDimensionScores } from '@/lib/db/dimension-scores'
import { getStreak, getPracticeCount } from '@/lib/db/practice-sessions'
import PortraitRadar from './PortraitRadar'

interface LoggedInViewProps {
  stats: { corpus: number }
  targetBand: number
  onLogout: () => void
}

/**
 * 已登录态面板：Hero 打卡卡 + 双列副数据卡 + 我的画像雷达卡 + 退出登录
 * @param stats      profileData.stats（corpus 占位，streak/practice 由内部真实加载）
 * @param onLogout   page 层的退出登录处理函数
 * @sideEffect       挂载时并行拉取 listMyCorpus + getDimensionScores，更新真实数据
 */
export default function LoggedInView({ stats: _stats, onLogout }: LoggedInViewProps): JSX.Element {
  const [corpusCount, setCorpusCount] = useState(0)
  const [streak, setStreak] = useState(0)
  const [practiceCount, setPracticeCount] = useState(0)
  const [radarValues, setRadarValues] = useState<readonly [number, number, number, number, number]>(
    [0, 0, 0, 0, 0],
  )

  useEffect(() => {
    Promise.all([listMyCorpus(), getDimensionScores(), getStreak(), getPracticeCount()])
      .then(([corpus, scores, streakVal, practiceVal]) => {
        setCorpusCount(corpus.length)
        const scoreFor = (id: string) => scores.find((s) => s.dimensionId === id)?.score ?? 0
        const newValues: [number, number, number, number, number] = [
          scoreFor('emotion'),
          scoreFor('relationship'),
          scoreFor('space'),
          scoreFor('spirit'),
          scoreFor('growth'),
        ]
        setRadarValues(newValues)
        setStreak(streakVal)
        setPracticeCount(practiceVal)
      })
      .catch((err: unknown) => {
        console.warn('[ProfilePage] 加载真实数据失败，保留占位', err)
      })
  }, [])

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
        className="rounded-[20px] px-[18px] pt-4 pb-3.5 mb-3"
        style={GRADIENT_BORDER_STYLE_FULL}
      >
        <div className="flex justify-between items-start mb-1">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-v2-text-primary">我的画像</span>
              <Tag label="AI 生成" variant="green" />
            </div>
            <p className="text-[12px] text-v2-text-secondary mt-1">
              基于你的 {corpusCount} 段语料
            </p>
          </div>
          <button className="text-[12px] font-medium text-brand-primary-dark mt-0.5 active:opacity-60">
            查看完整 →
          </button>
        </div>
        <PortraitRadar values={radarValues} />
      </div>

      {/* ── 退出登录 */}
      <div className="text-center mt-1 mb-4">
        <button
          onClick={onLogout}
          className="bg-transparent border-none text-[13px] text-v2-text-muted px-4 py-2 active:opacity-60"
        >
          退出登录
        </button>
      </div>
    </>
  )
}
