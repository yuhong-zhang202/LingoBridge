/**
 * @module   ChangelogAnnouncement
 * @desc     首页版本更新公告卡 —— 按版本只弹一次的居中模态：进首页时若当前版本
 *           （CHANGELOG[0]）尚未看过（localStorage lingobridge:changelog_seen_<version>），在页面居中
 *           浮出一张更大的公告卡（桌面尤其放大），半透明遮罩（bg-black/40）盖住背景聚焦视线，列出本次
 *           更新要点；点遮罩或 ✕ 关闭即写标记、本版本不再弹。内容真源复用 src/lib/changelog.ts
 *           的 CHANGELOG（与顶栏铃铛同一份），但用【各自独立】的 localStorage key：关公告 ≠ 消铃铛红点，反之亦然。
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
      className="fixed inset-0 z-40 flex items-center justify-center px-4 bg-black/40"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] lg:max-w-[640px] animate-fade-up"
      >
        <Card variant="gradient" className="px-6 pt-6 pb-7 lg:px-9 lg:pt-8 lg:pb-9 relative">
          {/* 关闭按钮：44×44 触控区，图标居中；点击写标记，本版本不再弹 */}
          <button
            type="button"
            onClick={dismiss}
            aria-label="关闭更新公告"
            className="absolute top-1 right-1 w-11 h-11 grid place-items-center rounded-full text-v2-text-muted hover:bg-bg-muted active:scale-[0.94] transition"
          >
            <X size={18} />
          </button>

          <div className="flex items-center gap-2 pr-10">
            <Tag label="更新" variant="green" />
            <span className="text-[11px] text-v2-text-muted">{latest.date}</span>
          </div>
          <p className="text-[17px] lg:text-[21px] font-bold text-v2-text-primary mt-2.5 tracking-[-0.2px]">{latest.title}</p>
          <ul className="mt-3 lg:mt-4 flex flex-col gap-2 lg:gap-2.5">
            {latest.notes.map((note) => (
              <li key={note} className="flex gap-1.5 text-[13.5px] lg:text-[15px] text-v2-text-secondary leading-relaxed">
                <span aria-hidden="true" className="text-brand-accent mt-[1px]">·</span>
                {note}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
