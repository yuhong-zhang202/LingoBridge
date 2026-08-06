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
import { useAccount } from '@/hooks/useAccount'

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
  const { account } = useAccount()

  useEffect(() => {
    let cancelled = false
    // 串行门控（顺序 ChangelogAnnouncement → TargetBandNudge → 本条），绝不叠屏。
    //
    // 🔴【判据是「前一个弹窗现在还会不会显示」，不是「它有没有被看过」】2026-08-06 修：
    //   初版写成 `if (!hasSeenTargetBandNudge()) return`，看着合理，实则把 34% 的注册用户永久挡在门外 ——
    //   目标分提醒【只对没设目标分的人显示】，设过的人永远见不到它、永远不会写下「已看过」标记，
    //   于是这一行 return 永远成立，连 GET 都不发。生产实测当时 125 名注册用户里 43 人已设目标分，
    //   4 条待通知的回复里 3 条的收件人正在这 43 人中，且失败完全静默（看板也看不出来）。
    //   教训：串行门控里的「前一个」如果自带资格条件，就不能拿它的已读标记当放行信号。
    //
    // 因此这里判的是「目标分提醒此刻是否仍会占屏」：只有「未设目标分 且 还没看过它」时才让路。
    // account 为 null 表示账号信息还没加载完，这次不判（下次进首页再来，不会永久错过）。
    const latest = getLatestChangelog()
    if (latest && !hasSeenChangelog(latest.version)) return
    if (!account) return
    if (account.isAnonymous) return                                        // 匿名不弹（服务端也会返回空，双保险）
    if (account.targetBand === null && !hasSeenTargetBandNudge()) return   // 目标分提醒还会显示，让它先
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
  }, [account])

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
            {/* 标题保持中性：看板侧的语义是「已处理」，而已处理不等于「改好了」——
                产品方完全可能勾上并回复「这个暂时不做，原因是…」，那时标题说改好了、正文说不做，同屏自相矛盾。
                改没改由回复正文自己说，标题只负责让用户认出「这是对我那条反馈的回应」。 */}
            <p className="text-[1.1875rem] lg:text-[1.375rem] font-bold text-v2-text-primary mt-3 tracking-[-0.2px]">
              {items.length > 1 ? `你提的 ${items.length} 条反馈，有回音了` : '你提的这件事，有回音了'}
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
