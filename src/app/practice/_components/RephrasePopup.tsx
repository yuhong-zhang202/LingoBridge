/**
 * @module   RephrasePopup
 * @desc     练习页"换个说法"弹窗 — 展示 🔨 优化后的句子 + 改进说明
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { type JSX, type RefObject } from 'react'
import { X, Check } from 'lucide-react'
import { GRADIENT_BORDER_STYLE_FULL } from '@/lib/constants'
import GradientButton from '@/components/GradientButton'
import PolishNote from '@/components/PolishNote'
import type { PolishResult } from '@/lib/types'

interface RephrasePopupProps {
  loading: boolean
  result: PolishResult | null
  onClose: () => void
  popupRef: RefObject<HTMLDivElement | null>
  /** 定位变体：mobile = fixed 贴视口左右（默认，移动端原样）；desktop = absolute 收进 600px 对话列内，避免横跨全屏 */
  variant?: 'mobile' | 'desktop'
  /** 失败态「再试一次」：宿主提供的重试通道（原地重发同一次优化请求，弹窗不关）。不传 = 宿主没有这条通道 */
  onRetry?: () => void
}

export default function RephrasePopup({ loading, result, onClose, popupRef, variant = 'mobile', onRetry }: RephrasePopupProps): JSX.Element {
  const desktop = variant === 'desktop'
  // 两件事都成立才给按钮：retryable = 这次失败值不值得重试（额度类为 false）；onRetry = 宿主有没有重试通道
  const canRetry = Boolean(result?.failed && result.retryable && onRetry)
  // 弹窗高度上限：超出改内滚。polish 输入上限已放宽到 800，而 POLISH_SYSTEM 要求「optimized 与原句长度相当」，
  // 800 进 800 出是常态；此前弹窗 bottom 钉死向上生长且无 max-height，特大字号档会直接长出屏幕、内容永久不可见。
  // mobile 168 = 底部锚点 bottom:100 + 顶部保留 68（TopBar 是 sticky z-30、本弹窗 z-40，不留就会盖住顶栏、用户失去页面定位）
  // desktop 260 = FlowShell header 72 + 题目条区约 66 + bottom:118 + 4 余量
  // 用 dvh 不用 vh：iOS 地址栏收缩会改视口高，与 PracticeMobile 的 h-dvh 保持一致
  const maxHeight = desktop
    ? 'calc(100vh - 260px)'
    : 'calc(100dvh - env(safe-area-inset-top) - 168px)'
  return (
    <div
      ref={popupRef}
      // 供宿主在重试时把焦点收回本容器（按钮随 loading 分支卸载会让焦点掉回 body）。
      // -1 = 只能编程聚焦、不进 Tab 序；不做挂载即 focus（会打断正在读文案的读屏用户）。
      tabIndex={-1}
      className={
        desktop
          ? 'absolute z-[40] rounded-[16px] left-0 right-0 bottom-[118px]'
          : 'fixed z-[40] rounded-[16px]'
      }
      // ⚠️ 本层绝不能加任何 overflow：下面的 ▼ 三角是 absolute bottom:-7，一旦 hidden/auto 就被剪掉，
      //    弹窗会失去指向 Orb 的锚点。滚动只发生在内层滚动容器里，本层保持默认 visible。
      style={{
        ...GRADIENT_BORDER_STYLE_FULL,
        padding: '11px 13px 12px',
        // 竖向 flex：让内层滚动区用 flex-1 自己算「总高减标题行」。标题行是 rem 单位、特大字号档会变高，
        // 手写像素常数在别的字号档必然算错，所以交给浏览器算。
        display: 'flex',
        flexDirection: 'column',
        maxHeight,
        ...(desktop ? {} : { left: 14, right: 14, bottom: 100 }),
      }}
    >
      {/* 向下三角，指向左下角云团 */}
      <div
        className="absolute bg-white"
        style={{ bottom: -7, left: 18, width: 12, height: 12, transform: 'rotate(45deg)', borderRight: '1px solid rgba(168,210,196,.80)', borderBottom: '1px solid rgba(188,210,168,.75)' }}
      />

      <div className="flex justify-between items-center mb-2">
        <span className="text-[0.8125rem] font-semibold text-v2-text-primary">换个说法</span>
        {/* 触控目标 44px：负 margin 抵消视觉外扩，不改变原有留白观感 */}
        <button onClick={onClose} aria-label="关闭" className="w-11 h-11 -mr-3 -my-3 flex items-center justify-center active:opacity-60 transition-opacity"><X size={14} color="#A89990" /></button>
      </div>

      {/* 滚动区（标题行与关闭 × 留在外面常驻，内容再长也能关掉弹窗）：
          flex-1 min-h-0 = 由浏览器算「弹窗上限高 - 标题行」，不写死像素；
          overscroll-contain 挡住滚动链穿透到背后的对话列（同 NotificationBell）；
          tabIndex=0 让纯键盘用户能聚焦滚动（WCAG 2.1.1 / axe scrollable-region-focusable）；
          pb-1 让最后一行不贴底、露半行当「还能滚」的提示。 */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-1" tabIndex={0}>
        {/* role="status"（天然 aria-live=polite）包住三态内容区，不含标题行与关闭 ×：
            点「再试一次」后内容整块被替换，读屏用户靠这条播报才知道状态变了 */}
        <div role="status">
          {loading ? (
            <p className="text-[0.8125rem] text-v2-text-muted px-1 py-2">优化中…</p>
          ) : result ? (
            result.needsWork && result.optimized ? (
              <div className="flex flex-col gap-2">
                <div className="bg-cream-soft" style={{ padding: '9px 11px', border: '1px solid rgba(168,153,144,.14)', borderRadius: 11 }}>
                  <p className="text-[0.6875rem] text-v2-text-muted mb-1">Do you wanna try:</p>
                  {/* 行高 1.6 而非 1.5：polish 输入上限已放宽到 800 且 POLISH_SYSTEM 要求「optimized 与原句长度相当」，
                      13px 字号下 800 字约 16 行，1.5 密排读起来吃力。下方 note 解释区是短句列表，仍保持密排、不同步 */}
                  <p className="text-[0.8125rem] leading-[1.6] text-v2-text-primary font-medium">{result.optimized}</p>
                </div>
                {result.note && <PolishNote note={result.note} className="px-1" />}
              </div>
            ) : result.failed ? (
              // 失败/额度态（没能生成 / 额度已满 / 网络不稳）：note 是失败消息，绝不配成功勾。
              // 用中性提示色（同「优化中…」的 v2-text-muted），不新造样式 token。
              <div className="px-1 py-1.5">
                <p className="text-[0.8125rem] text-v2-text-muted">{result.note}</p>
                {/* 可重试的失败才给出口：左对齐、另起一行，与文案共用 px-1 左缘。不给 disabled——
                    一点进 loading 分支整块就被替换、物理上点不到第二下；也不做按钮内联 spinner
                    （否则「刚才失败了」与「正在重试」会同屏并存、自相矛盾）。 */}
                {canRetry && (
                  <div className="mt-2">
                    {/* py-3 而非紧凑档 py-2.5：13px × 行高1.5 = 19.5 + py-2.5(20) + 描边 1.5×2 ≈ 39.5px，低于 44px
                        触控目标推荐值；改 py-3 得约 43.5px。弹窗自身有 maxHeight + 内层滚动区，加高 4px 由滚动吸收 */}
                    <GradientButton
                      onClick={onRetry}
                      aria-label="重新生成优化建议"
                      className="px-5 py-3 rounded-full text-[0.8125rem] font-medium whitespace-nowrap"
                    >
                      再试一次
                    </GradientButton>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-1 py-1.5">
                <Check size={14} className="text-brand-accent flex-shrink-0" />
                <p className="text-[0.8125rem] text-v2-text-secondary">{result.note || '回答无需优化'}</p>
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  )
}
