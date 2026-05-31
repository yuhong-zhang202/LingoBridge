/**
 * @module   ProfilePage
 * @desc     「我的」页面 — Hero 连续打卡 + 双列副数据 + 画像雷达 + 功能列表
 * @author   LingoBridge
 * @created  2026-05-31
 */
'use client'

import { useRouter } from 'next/navigation'
import {
  Settings, Flame, MessageCircle, Target,
  Bookmark, History, SlidersHorizontal, MessageCircleQuestionMark,
  Info, ChevronRight,
} from 'lucide-react'
import TopBar from '@/components/TopBar'
import TabBar from '@/components/TabBar'
import Tag from '@/components/Tag'
import { GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'
import { cn } from '@/lib/utils'
import OrbAvatar from './_components/OrbAvatar'
import PortraitRadar from './_components/PortraitRadar'

// ── Mock 数据
const profileData = {
  name: 'Yuhong',
  targetBand: 7.0,
  stats: { streak: 7, maxStreak: 14, corpus: 12, practice: 28 },
  portrait: {
    corpusCount: 12,
    dimensions: { emotion: 0.7, relationship: 0.5, space: 0.3, spirit: 0.6, growth: 0.4 },
  },
  bookmarkCount: 24,
  version: 'v0.6.0',
}

/**
 * 根据目标 Band 分数返回胶囊颜色参数
 * @param band 目标分数
 * @returns bg / border / text 内联色值字符串
 */
function getBandColors(band: number): { bg: string; border: string; text: string } {
  if (band >= 7.0) return { bg: 'rgba(154,125,184,0.10)', border: 'rgba(154,125,184,0.28)', text: '#9A7DB8' }
  if (band >= 6.5) return { bg: 'rgba(212,135,90,0.10)',  border: 'rgba(212,135,90,0.28)',  text: '#D4875A' }
  return              { bg: 'rgba(123,166,153,0.10)',  border: 'rgba(123,166,153,0.28)',  text: '#7BA699' }
}

/**
 * Profile 主页
 */
export default function ProfilePage(): JSX.Element {
  const router = useRouter()
  const { name, targetBand, stats, portrait, bookmarkCount, version } = profileData
  const bandColors = getBandColors(targetBand)
  const radarValues = [
    portrait.dimensions.emotion,
    portrait.dimensions.relationship,
    portrait.dimensions.space,
    portrait.dimensions.spirit,
    portrait.dimensions.growth,
  ] as const

  const settingsButton = (
    <button
      onClick={() => {
        console.log('[ProfilePage] navigate to /settings')
        router.push('/settings')
      }}
      className="w-[30px] h-[30px] rounded-full bg-white shadow-sm flex items-center justify-center active:scale-[0.97] transition-transform duration-150"
    >
      <Settings size={15} color="#333" />
    </button>
  )

  return (
    <div className="relative min-h-screen bg-bg-page flex flex-col pb-[56px]">
      <TopBar title="我的" showBack={false} right={settingsButton} />

      <div className="flex-1 overflow-y-auto px-5 relative z-10">

        {/* ── 1. 用户头像区 */}
        <div className="flex flex-col items-center pt-6 pb-5">
          <OrbAvatar size={84} />
          <p className="text-[18px] font-semibold text-v2-text-primary mt-3">{name}</p>
          <div
            className="inline-flex items-center gap-[5px] px-[11px] py-1 rounded-full mt-2"
            style={{
              backgroundColor: bandColors.bg,
              border: `1px solid ${bandColors.border}`,
            }}
          >
            <Target size={11} color={bandColors.text} />
            <span className="text-[11px] font-medium" style={{ color: bandColors.text }}>
              目标 Band {targetBand.toFixed(1)}
            </span>
          </div>
        </div>

        {/* ── 2. 连续打卡 Hero 卡 */}
        <div
          className="rounded-[18px] px-[18px] py-[14px] mb-3"
          style={GRADIENT_BORDER_STYLE_FULL}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] text-v2-text-secondary">连续打卡</p>
              <p className="text-[26px] font-semibold text-v2-text-primary leading-none mt-[3px]">
                {stats.streak}
                <span className="text-[13px] font-normal text-v2-text-secondary ml-[3px]">天</span>
              </p>
              <p className="text-[11px] text-v2-text-muted mt-1.5">
                最长 {stats.maxStreak} 天 · 再练 1 次保持记录
              </p>
            </div>
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(212,135,90,0.10)' }}>
              <Flame size={24} color="#D4875A" />
            </div>
          </div>
        </div>

        {/* ── 3. 双列副数据卡 */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div
            className="rounded-[16px] px-[14px] py-3"
            style={GRADIENT_BORDER_STYLE_FULL}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle size={14} color="#7BA699" />
                <span className="text-[12px] text-v2-text-secondary">语料</span>
              </div>
              <span className="text-[18px] font-semibold text-v2-text-primary leading-none">
                {stats.corpus}
              </span>
            </div>
          </div>
          <div
            className="rounded-[16px] px-[14px] py-3"
            style={GRADIENT_BORDER_STYLE_FULL}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target size={14} color="#D4875A" />
                <span className="text-[12px] text-v2-text-secondary">练习</span>
              </div>
              <span className="text-[18px] font-semibold text-v2-text-primary leading-none">
                {stats.practice}
              </span>
            </div>
          </div>
        </div>

        {/* ── 4. 我的画像卡 */}
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
                基于你的 {portrait.corpusCount} 段语料
              </p>
            </div>
            <button className="text-[12px] font-medium text-brand-primary-dark mt-0.5 active:opacity-60">
              查看完整 →
            </button>
          </div>
          <PortraitRadar values={radarValues} />
        </div>

        {/* ── 5. 功能列表卡 */}
        <div
          className="rounded-[18px] overflow-hidden mb-3"
          style={GRADIENT_BORDER_STYLE_FULL}
        >
          {[
            { Icon: Bookmark,                  label: '收藏的卡片',       badge: String(bookmarkCount) },
            { Icon: History,                   label: '练习历史',          badge: null },
            { Icon: SlidersHorizontal,         label: '学习偏好',          badge: null },
            { Icon: MessageCircleQuestionMark, label: '帮助与反馈',        badge: null },
            { Icon: Info,                      label: '关于 LingoBridge',  badge: version },
          ].map(({ Icon, label, badge }, idx, arr) => (
            <button
              key={label}
              className={cn(
                'w-full flex items-center px-[18px] py-[14px] bg-transparent active:bg-[#F8F7F5] transition-colors',
                idx < arr.length - 1 && 'border-b border-[rgba(168,153,144,0.14)]',
              )}
            >
              <Icon size={18} color="#6B5B52" />
              <span className="flex-1 text-left text-[14px] text-v2-text-primary ml-3">{label}</span>
              {badge && (
                <span className="text-[12px] text-v2-text-muted mr-1.5">{badge}</span>
              )}
              <ChevronRight size={15} color="#C8BCB2" />
            </button>
          ))}
        </div>

        {/* ── 6. 退出登录 */}
        <div className="text-center mt-1 mb-4">
          <button
            onClick={() => console.log('[ProfilePage] logout')}
            className="bg-transparent border-none text-[13px] text-v2-text-muted px-4 py-2 active:opacity-60"
          >
            退出登录
          </button>
        </div>

      </div>

      <div className="flex-shrink-0"><TabBar /></div>
    </div>
  )
}
