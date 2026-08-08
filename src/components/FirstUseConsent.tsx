/**
 * @module   FirstUseConsent
 * @desc     首次使用「真捕获同意」闸 —— 阻断式：不点「同意并开始」进不去、无 skip。此为客户端 UX 闸；
 *           真正的强制拦截在服务端（/api/transcribe、/api/restructure 的 hasRecordedConsent 校验），
 *           深链绕过本弹窗也无法把数据发给第三方 AI。
 *           点击「同意并开始」= 明示同意（clickwrap / affirmative action），调 /api/consent 落一条
 *           可查证的同意记录，成功才关弹窗放行；失败留弹窗 + 重试（绝不只写 localStorage 就放行）。
 *           读路径查库判是否已签（hasRecordedConsent，localStorage 仅作缓存）；披露版本 bump 后老用户重弹重签。
 *           【fail-closed】闸态是三态 'checking' | 'blocked' | 'allowed'，初值 'checking' = 未知即阻断：
 *           查库是异步（含 getSession 可能刷 token 的网络往返），返回前渲染不透明全屏遮罩(加载态)拦住首页，
 *           绝不在「未确认已同意」前放行；查询异常也落到 'blocked'。仅 'allowed'（已签）才零遮挡返回 null。
 *           不用「延时 N ms 再显示遮罩」消抖——那等于重开 N ms 的 fail-open 窗口，宁可短暂遮罩不留窗口。
 *           次要出口「不同意」给真离开动作：退出登录并回登录页（清 session，不作为已登录用户留下），
 *           避免键盘 / 读屏用户被 focus trap 困死。披露文案唯一真源在 src/lib/privacy-copy.ts；
 *           落库 / 查库逻辑在 src/lib/consent.ts。
 *           形态：移动端底部 sheet；桌面端(lg+)贴底通栏对话框（左正文 / 右按钮组纵排，主 CTA 在上、次要在下）。
 *           全屏遮罩两端都保留——硬闸不能长成「可忽略的 cookie 条」。桌面样式一律走 lg: 增量覆盖，
 *           lg 以下与桌面化之前逐像素一致（包裹层用 display:contents，在移动端不生成盒子）。
 * @author   LingoBridge
 * @created  2026-06-17
 */
'use client'
import { useEffect, useRef, useState } from 'react'
import ProgressLink from '@/components/ProgressLink'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import GradientButton from '@/components/GradientButton'
import { CONSENT_POPUP_TITLE, CONSENT_POPUP_DISCLOSURE } from '@/lib/privacy-copy'
import { hasRecordedConsent, recordConsent, clearConsentCache } from '@/lib/consent'
import { getSupabase } from '@/lib/supabase'
import { PAGE_CONTAINER } from '@/lib/constants'
import { resolveTabFocus } from '@/lib/focus-trap'

// 桌面端(lg+)贴底通栏的内栏：复用全站唯一宽度真源 PAGE_CONTAINER，与 TopNav / 各页内容左右对齐。
// `contents` 让这几层包裹 div 在 lg 以下不生成盒子（不吃 padding / max-width / margin），
// 移动端布局与桌面化之前逐像素一致；到 lg 才变成真正的 flex 容器。
const CONSENT_BAR = `contents ${PAGE_CONTAINER} lg:flex lg:items-center lg:gap-8 lg:py-3.5`
/** 通栏左侧正文列（标题 + 披露段落 + 链接） */
const CONSENT_TEXT_COL = 'contents lg:block lg:flex-1 lg:min-w-0'
/** 通栏右侧按钮组：桌面纵排，主 CTA「同意并开始」在上、次要「不同意」在下（产品方定，
 *  取代此前的横排 flex-row-reverse）。DOM 顺序本就「主 CTA 在前」，与移动端纵排次序、
 *  focus trap 取元素顺序天然一致，无需再做视觉换序。定宽 200 保证两个按钮等宽对齐。 */
const CONSENT_ACTIONS = 'contents lg:flex lg:flex-col lg:items-stretch lg:gap-2 lg:w-[200px] lg:flex-shrink-0'

export default function FirstUseConsent() {
  const router = useRouter()
  // 三态闸：'checking'（初值，未知即阻断，渲染加载遮罩）/ 'blocked'（未签，渲染同意对话框）/ 'allowed'（已签，零遮挡）
  const [status, setStatus] = useState<'checking' | 'blocked' | 'allowed'>('checking')
  const [declined, setDeclined] = useState(false)   // 次要出口：用户选择「暂不使用」后的阻断视图
  const [submitting, setSubmitting] = useState(false)
  const [leaving, setLeaving] = useState(false)      // 退出登录并离开进行中
  const [failed, setFailed] = useState(false)        // 落库失败：留弹窗提示重试
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    // 查库（含缓存快路径）判是否已对当前披露版本签过同意：已签→allowed 放行，未签→blocked 弹窗。
    // 异常同样 fail-closed 落 blocked；即便 promise 永不 resolve，status 停在 'checking' 仍阻断（天然 fail-closed）。
    hasRecordedConsent()
      .then((ok) => {
        if (!cancelled) setStatus(ok ? 'allowed' : 'blocked')
      })
      .catch(() => {
        if (!cancelled) setStatus('blocked')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 打开或切换视图（同意↔暂不使用）时，把焦点移到弹窗容器本身（读屏 / 键盘用户不落在页面背景）。
  // 聚焦容器（tabIndex=-1）而非「首个可聚焦元素」——否则一进来焦点就落在「内测数据处理说明」链接上、
  // 带出全局 :focus-visible 橘色轮廓，视觉突兀；聚焦容器不点亮任何链接，读屏仍经 aria-labelledby 念标题。
  useEffect(() => {
    // 仅 blocked 态才有对话框可聚焦；checking 遮罩无对话框、不抢焦点
    if (status !== 'blocked') return
    dialogRef.current?.focus()
  }, [status, declined])

  // 已签：零遮挡放行
  if (status === 'allowed') return null

  // 未知即阻断：查库返回前渲染不透明全屏遮罩 + 加载态，拦住首页（fixed inset-0 z-50 拦指针，
  // 底色 bg-bg-page 不透出内容——不能用 bg-black/40 半透，那会透出首页）。复用 lucide-react Loader2 spinner。
  if (status === 'checking') {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-bg-page"
        aria-busy="true"
      >
        <Loader2 className="animate-spin text-v2-text-muted" size={28} />
      </div>
    )
  }

  const handleAgree = async () => {
    setFailed(false)
    setSubmitting(true)
    try {
      const ok = await recordConsent()
      if (ok) {
        setStatus('allowed')   // 成功才放行
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
  // 判定本身走 lib/focus-trap.ts 的纯函数（本仓库 jest 无 DOM，逻辑留在组件里就只测得到「代码还在」、
  // 测不到「判错方向」；ConfirmDialog / SwapCorpusDialog 尚未收编进来，原因见 focus-trap.ts 顶注）：
  // 本组件此前只判 `active === firstEl`，而弹窗打开时聚焦的是【面板本身】（上面那个 dialogRef.current?.focus()），
  // 于是「一打开就按 Shift+Tab」两支都不命中 → 焦点退到遮罩后面的背景里再也回不来。这是首次使用的隐私
  // 硬闸、背景完全不可交互，键盘 / 读屏用户到这一步等于卡死在门口，连产品都进不去。
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const root = dialogRef.current
    if (!root) return
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    )
    // 只有 HTMLElement 才 focus 得动；焦点丢在 body 上时 contains 为 false，会被当「已在容器外」拉回来
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const decision = resolveTabFocus<HTMLElement>({
      focusables,
      root,
      active,
      activeInsideRoot: root.contains(active),
      shiftKey: e.shiftKey,
    })
    if (decision.kind === 'pass') return
    e.preventDefault()
    if (decision.kind === 'move') decision.target.focus()
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
              <h3 id="consent-dialog-title" className="text-[1rem] font-semibold text-v2-text-primary text-center lg:text-left lg:text-[0.9375rem]">暂时无法使用</h3>
              <p className="text-[0.8125rem] text-v2-text-secondary leading-relaxed mt-3 lg:mt-1.5 lg:text-[0.78125rem] lg:leading-[1.45]">
                练习功能需要把你的录音与文字发送给第三方 AI 处理，未同意则无法开始。你可以再想想，或退出登录直接离开。
              </p>
            </div>
            <div className={CONSENT_ACTIONS}>
              <GradientButton
                onClick={() => setDeclined(false)}
                className="w-full mt-5 py-3 rounded-full text-[0.875rem] font-medium lg:w-full lg:px-8 lg:py-2.5 lg:mt-0 lg:font-semibold lg:text-[0.9375rem]"
              >
                我再想想
              </GradientButton>
              <button
                type="button"
                onClick={() => void handleLeave()}
                disabled={leaving}
                className="w-full mt-3 min-h-[44px] text-[0.75rem] text-v2-text-muted underline disabled:opacity-50 lg:w-full lg:mt-0 lg:min-h-0 lg:py-1 lg:text-[0.8125rem] lg:whitespace-nowrap"
              >
                退出登录并离开
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={CONSENT_TEXT_COL}>
              <h3 id="consent-dialog-title" className="text-[1rem] font-semibold text-v2-text-primary text-center lg:text-left lg:text-[0.9375rem]">{CONSENT_POPUP_TITLE}</h3>
              {CONSENT_POPUP_DISCLOSURE.map((para, i) => (
                <p key={i} className="text-[0.8125rem] text-v2-text-secondary leading-relaxed mt-3 lg:mt-1.5 lg:text-[0.78125rem] lg:leading-[1.45]">
                  {para}
                </p>
              ))}
              {/* 链接行：移动端 44px 触控高度不动；桌面无触控约束，min-h 归零是通栏减高的主要来源 */}
              <div className="flex justify-center gap-4 mt-3 lg:justify-start lg:mt-1">
                <ProgressLink href="/privacy/beta" className="min-h-[44px] inline-flex items-center text-[0.75rem] text-brand-accent-dark underline lg:min-h-0">
                  内测数据处理说明
                </ProgressLink>
                <ProgressLink href="/privacy" className="min-h-[44px] inline-flex items-center text-[0.75rem] text-brand-accent-dark underline lg:min-h-0">
                  完整隐私政策
                </ProgressLink>
              </div>
              {failed && (
                <p className="text-[0.75rem] text-error text-center mt-3 lg:text-left lg:mt-1">
                  保存同意记录失败，请检查网络后重试。
                </p>
              )}
            </div>
            <div className={CONSENT_ACTIONS}>
              <GradientButton
                onClick={handleAgree}
                loading={submitting}
                className="w-full mt-5 py-3 rounded-full text-[0.875rem] font-medium lg:w-full lg:px-8 lg:py-2.5 lg:mt-0 lg:font-semibold lg:text-[0.9375rem]"
              >
                同意并开始
              </GradientButton>
              <button
                type="button"
                onClick={() => setDeclined(true)}
                disabled={submitting}
                className="w-full mt-3 min-h-[44px] text-[0.75rem] text-v2-text-muted underline disabled:opacity-50 lg:w-full lg:mt-0 lg:min-h-0 lg:py-1 lg:text-[0.8125rem] lg:whitespace-nowrap"
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
