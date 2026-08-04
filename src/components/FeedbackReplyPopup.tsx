/**
 * @module   FeedbackReplyPopup
 * @desc     反馈闭环弹窗 —— 用户提过的反馈被处理后，下次进首页告诉他「你说的这件事，我们改了」。
 *           数据来自 GET /api/feedback-notified（已处理 + 有回复 + 未通知过 + kind=manual + 非匿名），
 *           看完调 POST 标记 notified_at，同一条永不重复弹。
 *
 *   【为什么弹窗里必须带上他自己的原话】反馈到修复往往隔几天，用户早忘了自己说过什么；
 *     只给「我们优化了词组生成」他会一头雾水，把原话摆在前面才让人认出这是回应自己。
 *
 *   【为什么不用 localStorage 记已读】那是本地状态，换设备就重弹、清缓存就重弹，
 *     而这条通知一辈子只该看一次。已读状态跟着账号走，落在 feedback.notified_at 上。
 *     代价是要多一次网络请求，值得。
 *
 *   【绝不打断】拉取失败、未登录、接口未迁移一律静默不弹（GET 端点自身也把所有异常吞成空数组）。
 *     这是锦上添花的功能，任何情况下都不该挡住用户进首页。
 *
 *   视觉沿用 ChangelogAnnouncement 的居中模态范式（同款遮罩/卡片/关闭按钮/44px 命中区），
 *     不新造样式；区别只在内容结构：一条反馈 = 原话引用 + 我们的回复。
 *
 * @author   LingoBridge
 * @created  2026-08-04
 */
'use client'
import { type JSX, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import Card from '@/components/Card'
import Tag from '@/components/Tag'
import { apiFetch } from '@/lib/api-client'
import { getLatestChangelog } from '@/lib/changelog'
import { hasSeenChangelog, hasSeenTargetBandNudge } from '@/lib/storage'

interface ReplyItem {
  id: string
  message: string
  reply: string
  created_at: string
  handled_at: string
}

/** 东八区日期串（与看板同口径：用户在国内，日期按香港时区读才不会差一天） */
function hkDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('zh-CN', { timeZone: 'Asia/Hong_Kong', month: 'numeric', day: 'numeric' })
  } catch {
    return ''
  }
}

/**
 * 反馈闭环弹窗（挂在首页）。
 * @returns    有待告知的反馈时返回居中模态，否则 null
 * @sideEffect 挂载时 GET /api/feedback-notified；关闭时 POST 标记已通知（失败静默，下次再弹一次也无害）
 */
export default function FeedbackReplyPopup(): JSX.Element | null {
  const [items, setItems] = useState<ReplyItem[]>([])

  useEffect(() => {
    let cancelled = false
    // 串行门控（与 TargetBandNudge 同款范式）：前两个弹层都看过了才轮到本条，绝不叠屏。
    // 顺序 ChangelogAnnouncement → TargetBandNudge → 本条：前两个是「全员/多数人都会见到」的通知，
    // 本条只对提过反馈的极少数人出现，排最后既不挡路、也不会因为前面没看完就被永久跳过
    // （本条的已读记在服务端 notified_at，前面没看完只是这次不弹，下次进首页还会再判）。
    const latest = getLatestChangelog()
    if (latest && !hasSeenChangelog(latest.version)) return
    if (!hasSeenTargetBandNudge()) return
    void (async () => {
      try {
        const res = await apiFetch('/api/feedback-notified', { method: 'GET' })
        if (!res.ok || cancelled) return
        const body = (await res.json()) as { items?: ReplyItem[] }
        const list = (body.items ?? []).filter((x) => x.message && x.reply)
        if (!cancelled && list.length > 0) setItems(list)
      } catch {
        // 静默：这条通知拉不到就当没有，绝不打断首页
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (items.length === 0) return null

  /** 关闭：先隐藏（用户立刻得到反馈），再把标记发出去；失败也不回滚 UI（最坏是下次再弹一次） */
  function dismiss(): void {
    const ids = items.map((x) => x.id)
    setItems([])
    void apiFetch('/api/feedback-notified', { method: 'POST', json: { ids } }).catch(() => {})
  }

  return (
    <div
      role="region"
      aria-label="你的反馈有回应了"
      onClick={dismiss}
      className="fixed inset-0 z-40 flex items-center justify-center px-4 py-6 bg-black/40"
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[440px] lg:max-w-[560px] animate-fade-up">
        <Card variant="gradient" className="relative flex flex-col max-h-[85vh] px-6 pt-7 pb-6 lg:px-9 lg:pt-9 lg:pb-8">
          <button
            type="button"
            onClick={dismiss}
            aria-label="关闭"
            className="absolute top-1 right-1 w-11 h-11 grid place-items-center rounded-full text-v2-text-muted hover:bg-bg-muted active:scale-[0.94] transition"
          >
            <X size={18} />
          </button>

          <div className="flex-shrink-0 pr-10">
            <Tag label="你的反馈" variant="green" />
            <p className="text-[1.1875rem] lg:text-[1.375rem] font-bold text-v2-text-primary mt-3 tracking-[-0.2px]">
              {items.length > 1 ? `你提的 ${items.length} 条反馈，我们改好了` : '你提的这件事，我们改好了'}
            </p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto mt-5 flex flex-col gap-5">
            {items.map((it) => (
              <div key={it.id}>
                {/* 原话引用：左侧竖线 + 灰字，与「我们的回复」形成对话感，让用户一眼认出这是自己说的 */}
                <div className="border-l-2 border-black/[0.08] pl-3">
                  <p className="text-[0.8125rem] text-v2-text-muted leading-relaxed">{it.message}</p>
                  <p className="text-[0.6875rem] text-v2-text-muted mt-1">{hkDate(it.created_at)} 你说</p>
                </div>
                <p className="text-[0.875rem] lg:text-[0.9375rem] text-v2-text-primary leading-relaxed mt-3">{it.reply}</p>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={dismiss}
            className="flex-shrink-0 mt-6 w-full min-h-[44px] rounded-full bg-v2-text-primary text-white text-[0.9375rem] font-medium active:scale-[0.98] transition"
          >
            知道了
          </button>
        </Card>
      </div>
    </div>
  )
}
