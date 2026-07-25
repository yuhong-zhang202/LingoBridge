/**
 * @module   ChangelogAnnouncement
 * @desc     首页版本更新公告卡 —— 按版本只弹一次的居中模态：进首页时若当前版本
 *           （CHANGELOG[0]）尚未看过（localStorage lingobridge:changelog_seen_<version>），在页面居中
 *           浮出一张【基本占满视口】的大公告卡（移动约 82vh、桌面约 70vh，视觉重点压在公告上），半透明
 *           遮罩（bg-black/40）盖住背景聚焦视线，纵向三段：顶部日期/标题、中部要点列表（占满剩余空间、
 *           内容超长可滚动）、底部「知道了」按钮 + 留白；点遮罩、✕ 或「知道了」关闭即写标记、本版本不再弹
 *           （可关、非硬阻断）。内容真源复用 src/lib/changelog.ts 的 CHANGELOG（与顶栏铃铛同一份），但用
 *           【各自独立】的 localStorage key：关公告 ≠ 消铃铛红点，反之亦然。
 *           z 低于首次同意硬闸（z-50），新用户先过同意闸、老用户直接见公告。
 *           SSR / 隐私模式下 hasSeenChangelog 返回 true → 不弹、不报错。
 * @author   LingoBridge
 * @created  2026-07-25
 */
'use client'
import { type JSX, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import Card from '@/components/Card'
import Tag from '@/components/Tag'
import GradientButton from '@/components/GradientButton'
import { getLatestChangelog } from '@/lib/changelog'
import { hasSeenChangelog, markChangelogSeen } from '@/lib/storage'

/**
 * 首页版本更新公告卡（自门控：未看过当前版本才渲染）。
 * @returns  顶部浮出的可关闭公告卡；已看过 / SSR / 无公告时渲染 null
 */
export default function ChangelogAnnouncement(): JSX.Element | null {
  const latest = getLatestChangelog()
  // 初值 false：SSR 与首帧都不渲染（localStorage 只能在客户端读，放 effect 里判，避免 hydration 失配）
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (latest && !hasSeenChangelog(latest.version)) setShow(true)
  }, [latest])

  if (!latest || !show) return null

  function dismiss(): void {
    if (latest) markChangelogSeen(latest.version)
    setShow(false)
  }

  return (
    // 居中模态：半透明遮罩（bg-black/40）盖住背景、聚焦视线；点遮罩即关闭（写标记、本版本不再弹）。
    // 卡片 stopPropagation 阻断冒泡，点卡片内部不误关。
    <div
      role="region"
      aria-label="版本更新公告"
      onClick={dismiss}
      className="fixed inset-0 z-40 flex items-center justify-center px-4 py-6 bg-black/40"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] lg:max-w-[600px] animate-fade-up"
      >
        {/* 大卡：撑成「基本占满视口」（移动 82vh / 桌面 70vh），纵向三段撑开——
            顶部标题区、中部要点列表（flex-1 吃掉剩余高度、超长可滚动）、底部「知道了」按钮 */}
        <Card variant="gradient" className="relative flex flex-col min-h-[82vh] lg:min-h-[70vh] max-h-[90vh] px-6 pt-7 pb-6 lg:px-9 lg:pt-9 lg:pb-8">
          {/* 关闭按钮：44×44 触控区，图标居中；点击写标记，本版本不再弹 */}
          <button
            type="button"
            onClick={dismiss}
            aria-label="关闭更新公告"
            className="absolute top-1 right-1 w-11 h-11 grid place-items-center rounded-full text-v2-text-muted hover:bg-bg-muted active:scale-[0.94] transition"
          >
            <X size={18} />
          </button>

          {/* 顶部：标签 + 日期 + 标题 */}
          <div className="flex-shrink-0">
            <div className="flex items-center gap-2 pr-10">
              <Tag label="更新" variant="green" />
              <span className="text-[11px] text-v2-text-muted">{latest.date}</span>
            </div>
            <p className="text-[19px] lg:text-[23px] font-bold text-v2-text-primary mt-3 tracking-[-0.2px]">{latest.title}</p>
          </div>

          {/* 中部：要点列表，吃掉剩余高度；内容超长时本区独立滚动，按钮与遮罩不动 */}
          <ul className="flex-1 min-h-0 overflow-y-auto mt-5 lg:mt-6 flex flex-col gap-3 lg:gap-3.5">
            {latest.notes.map((note) => (
              <li key={note} className="flex gap-2 text-[14px] lg:text-[15px] text-v2-text-secondary leading-relaxed">
                <span aria-hidden="true" className="text-brand-accent mt-[1px]">·</span>
                {note}
              </li>
            ))}
          </ul>

          {/* 底部：「知道了」按钮（与点遮罩/✕ 同为关闭，写标记、本版本不再弹） */}
          <GradientButton
            onClick={dismiss}
            className="flex-shrink-0 mt-6 w-full px-6 py-3 rounded-full text-[14px] font-medium"
          >
            知道了
          </GradientButton>
        </Card>
      </div>
    </div>
  )
}
