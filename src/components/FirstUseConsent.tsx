/**
 * @module   FirstUseConsent
 * @desc     首次使用「真捕获同意」闸 —— 阻断式：不点「同意并开始」进不去、无 skip。此为客户端 UX 闸；
 *           真正的强制拦截在服务端（/api/transcribe、/api/restructure 的 hasRecordedConsent 校验），
 *           深链绕过本弹窗也无法把数据发给第三方 AI。
 *           点击「同意并开始」= 明示同意（clickwrap / affirmative action），调 /api/consent 落一条
 *           可查证的同意记录，成功才关弹窗放行；失败留弹窗 + 重试（绝不只写 localStorage 就放行）。
 *           读路径查库判是否已签（hasRecordedConsent，localStorage 仅作缓存）；披露版本 bump 后老用户重弹重签。
 *           次要出口「不同意」给真离开动作：退出登录并回登录页（清 session，不作为已登录用户留下），
 *           避免键盘 / 读屏用户被 focus trap 困死。披露文案唯一真源在 src/lib/privacy-copy.ts；
 *           落库 / 查库逻辑在 src/lib/consent.ts。
 *           形态：移动端底部 sheet；桌面端(lg+)贴底通栏对话框（左正文 / 右按钮组，次要在左、主 CTA 在右）。
 *           全屏遮罩两端都保留——硬闸不能长成「可忽略的 cookie 条」。桌面样式一律走 lg: 增量覆盖，
 *           lg 以下与桌面化之前逐像素一致（包裹层用 display:contents，在移动端不生成盒子）。
 * @author   LingoBridge
 * @created  2026-06-17
 */
'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import GradientButton from '@/components/GradientButton'
import { CONSENT_POPUP_TITLE, CONSENT_POPUP_DISCLOSURE } from '@/lib/privacy-copy'
import { hasRecordedConsent, recordConsent, clearConsentCache } from '@/lib/consent'
import { getSupabase } from '@/lib/supabase'
import { PAGE_CONTAINER } from '@/lib/constants'

// 桌面端(lg+)贴底通栏的内栏：复用全站唯一宽度真源 PAGE_CONTAINER，与 TopNav / 各页内容左右对齐。
// `contents` 让这几层包裹 div 在 lg 以下不生成盒子（不吃 padding / max-width / margin），
// 移动端布局与桌面化之前逐像素一致；到 lg 才变成真正的 flex 容器。
const CONSENT_BAR = `contents ${PAGE_CONTAINER} lg:flex lg:items-center lg:gap-10 lg:py-6`
/** 通栏左侧正文列（标题 + 披露段落 + 链接） */
const CONSENT_TEXT_COL = 'contents lg:block lg:flex-1 lg:min-w-0'
/** 通栏右侧按钮组：DOM 顺序保持「主 CTA 在前」以维持移动端纵排次序与 focus trap 取元素顺序，
 *  桌面靠 flex-row-reverse 呈现「左次要 → 右主要」（与 settings 删除模态的「取消 | 确认」一致） */
const CONSENT_ACTIONS = 'contents lg:flex lg:flex-row-reverse lg:items-center lg:gap-4 lg:flex-shrink-0'

export default function FirstUseConsent() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [declined, setDeclined] = useState(false)   // 次要出口：用户选择「暂不使用」后的阻断视图
  const [submitting, setSubmitting] = useState(false)
  const [leaving, setLeaving] = useState(false)      // 退出登录并离开进行中
  const [failed, setFailed] = useState(false)        // 落库失败：留弹窗提示重试
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    // 查库（含缓存快路径）判是否已对当前披露版本签过同意；未签才弹
    hasRecordedConsent().then((ok) => {
      if (!cancelled && !ok) setOpen(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 打开或切换视图（同意↔暂不使用）时，把焦点移到弹窗容器本身（读屏 / 键盘用户不落在页面背景）。
  // 聚焦容器（tabIndex=-1）而非「首个可聚焦元素」——否则一进来焦点就落在「内测数据处理说明」链接上、
  // 带出全局 :focus-visible 橘色轮廓，视觉突兀；聚焦容器不点亮任何链接，读屏仍经 aria-labelledby 念标题。
  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
  }, [open, declined])

  if (!open) return null

  const handleAgree = async () => {
    setFailed(false)
    setSubmitting(true)
    try {
      const ok = await recordConsent()
      if (ok) {
        setOpen(false)   // 成功才放行
      } else {
        setFailed(true)  // 失败留弹窗 + 重试
      }
    } catch {
      setFailed(true)
    } finally {
      setSubmitting(false)
    }
  }

  // 「不同意」的真出口：退出登录（清 session）并回登录页。硬闸下未同意 = 不作为已登录用户留下；
  // /login 不挂本同意闸，故这是能真正离开的动作，而非「暂时无法使用 → 我再想想」的死循环。
  const handleLeave = async () => {
    setLeaving(true)
    try {
      await getSupabase().auth.signOut()
    } catch {
      /* 忽略：即便登出失败也要给用户离开路径，仍导航至登录页 */
    }
    // 登出即清同意缓存：key 不含 uid，残留会致同机换号弹窗死循环（见 clearConsentCache）。
    clearConsentCache()
    router.push('/login')
  }

  // focus trap：Tab / Shift+Tab 在弹窗内循环，不逸出到背景页（硬闸下背景不可交互）。硬闸不处理 Esc（无关闭）。
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (!focusables || focusables.length === 0) return
    const firstEl = focusables[0]
    const lastEl = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault()
      lastEl.focus()
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault()
      firstEl.focus()
    }
  }

  return (
    // 遮罩层：桌面端一并保留不动。本组件是硬闸（aria-modal + focus trap + 无 skip），去掉遮罩会退化成
    // 「可忽略的 cookie 条」，形态承诺自由而约束不给；保留遮罩 = 底部通栏对话框。
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      {/* 面板：移动端底部 sheet 原样；lg+ 变撑满视口宽的贴底通栏
          （lg:!pb-0 覆盖 inline 的 safe-area 内边距——桌面无 safe-area） */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-dialog-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="w-full max-w-[430px] bg-bg-surface rounded-t-[20px] px-5 pt-5 sheet-enter focus:outline-none focus-visible:outline-none lg:max-w-none lg:rounded-none lg:px-0 lg:pt-0 lg:!pb-0 lg:border-t lg:border-black/[0.06] lg:shadow-[0_-4px_24px_rgba(0,0,0,0.08)]"
        style={{ paddingBottom: 'calc(28px + env(safe-area-inset-bottom))' }}
      >
        <div className={CONSENT_BAR}>
        {declined ? (
          // 次要出口的阻断视图：用户选择不同意 → 可「再想想」回到同意，或「退出登录并离开」真正离开
          <>
            <div className={CONSENT_TEXT_COL}>
              <h3 id="consent-dialog-title" className="text-[16px] font-semibold text-v2-text-primary text-center lg:text-left">暂时无法使用</h3>
              <p className="text-[13px] text-v2-text-secondary leading-relaxed mt-3">
                练习功能需要把你的录音与文字发送给第三方 AI 处理，未同意则无法开始。你可以再想想，或退出登录直接离开。
              </p>
            </div>
            <div className={CONSENT_ACTIONS}>
              <GradientButton
                onClick={() => setDeclined(false)}
                className="w-full mt-5 py-3 rounded-full text-[14px] font-medium lg:w-auto lg:px-8 lg:mt-0 lg:font-semibold lg:text-[15px]"
              >
                我再想想
              </GradientButton>
              <button
                type="button"
                onClick={() => void handleLeave()}
                disabled={leaving}
                className="w-full mt-3 min-h-[44px] text-[12px] text-v2-text-muted underline disabled:opacity-50 lg:w-auto lg:mt-0 lg:text-[13px] lg:whitespace-nowrap"
              >
                退出登录并离开
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={CONSENT_TEXT_COL}>
              <h3 id="consent-dialog-title" className="text-[16px] font-semibold text-v2-text-primary text-center lg:text-left">{CONSENT_POPUP_TITLE}</h3>
              {CONSENT_POPUP_DISCLOSURE.map((para, i) => (
                <p key={i} className="text-[13px] text-v2-text-secondary leading-relaxed mt-3">
                  {para}
                </p>
              ))}
              <div className="flex justify-center gap-4 mt-3 lg:justify-start">
                <Link href="/privacy/beta" className="min-h-[44px] inline-flex items-center text-[12px] text-brand-accent-dark underline">
                  内测数据处理说明
                </Link>
                <Link href="/privacy" className="min-h-[44px] inline-flex items-center text-[12px] text-brand-accent-dark underline">
                  完整隐私政策
                </Link>
              </div>
              {failed && (
                <p className="text-[12px] text-error text-center mt-3 lg:text-left">
                  保存同意记录失败，请检查网络后重试。
                </p>
              )}
            </div>
            <div className={CONSENT_ACTIONS}>
              <GradientButton
                onClick={handleAgree}
                loading={submitting}
                className="w-full mt-5 py-3 rounded-full text-[14px] font-medium lg:w-auto lg:px-8 lg:mt-0 lg:font-semibold lg:text-[15px]"
              >
                同意并开始
              </GradientButton>
              <button
                type="button"
                onClick={() => setDeclined(true)}
                disabled={submitting}
                className="w-full mt-3 min-h-[44px] text-[12px] text-v2-text-muted underline disabled:opacity-50 lg:w-auto lg:mt-0 lg:text-[13px] lg:whitespace-nowrap"
              >
                不同意，暂不使用
              </button>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  )
}
