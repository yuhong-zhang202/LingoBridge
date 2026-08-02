/**
 * @module   TargetBandNudge
 * @desc     首页「设个目标分」提醒弹窗 —— 分析页「可用词组」改为按用户目标分出词后，提醒【已注册但未设目标分】
 *           的用户去设一次目标分，让词组更贴其冲刺分数。壳复用 ProfileModal（a11y 完备：role=dialog +
 *           aria-modal + Esc + Tab 焦点陷阱 + body 滚动锁 + 焦点归还），不手写无焦点陷阱的壳。
 *
 *           门控（避免加载中误弹 + 与公告/同意闸不叠屏）：
 *             account 已加载 && 非匿名 && targetBand===null && 已看过当前版本更新公告 && 未看过本提醒。
 *             account===null（未加载完 / SSR 首帧）一律不判——用 useState(false)+useEffect 置 show，
 *             SSR 首帧不渲染，防 hydration 失配。「已看过当前版本公告」保证与 ChangelogAnnouncement 串行、
 *             不同屏；z 低于同意硬闸（z-50）只作防御（外层包一层 relative z-40 建栈上下文，压住 ProfileModal 内建的 z-50）。
 *
 *           三种关闭路径（主 CTA「去设目标分」/ 次要「以后再说」/ ✕·遮罩·Esc）都写 markTargetBandNudgeSeen，
 *           本提醒终生只弹一次。CTA 落点 /profile?goal=1 → ExamGoalCard 读该参数自动打开 ExamGoalModal。
 * @author   LingoBridge
 * @created  2026-08-01
 */
'use client'
import { type JSX, useEffect, useState } from 'react'
import { useNav } from '@/components/NavProgress'
import GradientButton from '@/components/GradientButton'
import ProfileModal from '@/app/profile/_components/ProfileModal'
import { useAccount } from '@/hooks/useAccount'
import { getLatestChangelog } from '@/lib/changelog'
import { hasSeenChangelog, hasSeenTargetBandNudge, markTargetBandNudgeSeen } from '@/lib/storage'

/**
 * 目标分提醒弹窗（自门控：门槛全满足才渲染）。
 * @returns  首页浮出的可关闭提醒弹窗；不满足门控 / SSR 时渲染 null
 * @sideEffect  三种关闭路径都写「已看过」标记；主 CTA 导航 /profile?goal=1
 */
export default function TargetBandNudge(): JSX.Element | null {
  const { account } = useAccount()
  const { navigate } = useNav()
  // 初值 false：SSR 与首帧都不渲染（localStorage 只能客户端读，放 effect 里判，避免 hydration 失配）
  const [show, setShow] = useState(false)

  useEffect(() => {
    const latest = getLatestChangelog()
    if (
      account &&
      !account.isAnonymous &&
      account.targetBand === null &&
      !!latest && hasSeenChangelog(latest.version) &&
      !hasSeenTargetBandNudge()
    ) {
      setShow(true)
    }
  }, [account])

  if (!show) return null

  /** 关闭（✕/遮罩/Esc/以后再说）：写标记 + 收起，本提醒不再弹。 */
  function dismiss(): void {
    markTargetBandNudgeSeen()
    setShow(false)
  }

  /** 主 CTA：写标记后导航去设目标分（?goal=1 让 ExamGoalCard 直接打开 Band 选择器）。 */
  function goSetGoal(): void {
    markTargetBandNudgeSeen()
    setShow(false)
    navigate('/profile?goal=1')
  }

  return (
    // 外层 relative z-40 建栈上下文，把 ProfileModal 内建的 z-50 压到同意硬闸（z-50）之下（串行门控已保证不同屏，z 只作防御）。
    <div className="relative z-40">
      <ProfileModal title="设个目标分，词组更贴你的水平" onClose={dismiss}>
        <p className="text-[0.8125rem] text-v2-text-secondary leading-relaxed">
          题目分析里的「可用词组」现在会按你的目标分来挑。设定后，给你的词组更贴近你要冲的分数，练得更有针对性。
        </p>
        <GradientButton
          onClick={goSetGoal}
          className="w-full mt-5 py-3 rounded-full text-[0.875rem] font-medium"
        >
          去设目标分
        </GradientButton>
        <button
          type="button"
          onClick={dismiss}
          className="w-full mt-2 min-h-[44px] text-[0.8125rem] text-v2-text-muted hover:text-v2-text-secondary transition-colors"
        >
          以后再说
        </button>
      </ProfileModal>
    </div>
  )
}
