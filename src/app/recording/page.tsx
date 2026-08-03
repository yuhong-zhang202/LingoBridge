/**
 * @module   RecordingPage
 * @desc     录音页外壳 — 按 lg 断点分发移动/桌面两套视图，本身只做「装配」：把录音器 /
 *           额度守卫 / 放弃埋点 / 提交流程四个 hook 串起来，两视图仅接收状态与回调。
 *           逻辑单实例保证全页只有一个 useAudioRecorder（单麦克风流）。
 *           点「完成」之后的整条提交流程（ASR → 预检 → 整理 → 跳转 + 全部埋点）在
 *           `hooks/useVoiceStorySubmit` 里，与文字路径的 `hooks/useStorySubmit` 对称 —— 本页不再自持。
 * @author   LingoBridge
 * @created  2026-05-15
 */
'use client'
import { type JSX, useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { useStoryQuotaGuard } from '@/hooks/useStoryQuotaGuard'
import { useCaptureAbandon } from '@/hooks/useCaptureAbandon'
import { useVoiceStorySubmit } from '@/hooks/useVoiceStorySubmit'
import { useNav } from '@/components/NavProgress'
import RecordingMobile from './RecordingMobile'
import RecordingDesktop from './RecordingDesktop'
import FlowShellDesktop from '@/components/desktop/FlowShellDesktop'
import QuotaReached from '@/components/QuotaReached'
import type { RecordingViewProps } from './types'

function RecordingContent(): JSX.Element {
  const router = useRouter()
  // 「改用文字」跳 /write、退出跳首页走 navigate → 点击当帧亮顶部进度条（消冷缓存空窗）；
  // 转写完成后跳 /restructure、403/中断回首页仍走 router（后者带 AbortController 中断语义，
  // 不进 startTransition 以免与中断判定纠缠；转写后跳转为异步动作完成后的重定向、非点导航按钮）
  const { navigate } = useNav()
  const qid = useSearchParams().get('qid')
  const [seconds, setSeconds] = useState(0)
  const secondsRef = useRef(0)
  // surface='recording'：本页的授权失败才是「故事采集」这一格（练习页共用本 hook，传 'practice'）
  const { audioLevel, start, stop } = useAudioRecorder({ surface: 'recording' })

  // 建新故事额度守卫（匿名试用总条数 / 注册用户月额度，共享 hook）。
  // 【为何拦在「完成」而不是挂载】本页深链/浏览器后退可直达，首页与 /write 的入口守卫覆盖不到；
  // 但录音本身不花钱，真正花钱的是点「完成」后的 ASR，且挂载即拦会为所有正常用户引入一次异步等待、
  // 拖慢自动开录。故拦在离花钱最近的那一步（hook 内部仍在挂载时后台预取，点击零延迟）。
  // 解构取值：checkBlocked 进提交流程的依赖，需稳定引用（hook 内 useCallback 无依赖）
  const { blockedVariant: storyQuotaVariant, checkBlocked: checkStoryQuota } = useStoryQuotaGuard()

  // 进页面即开始录音
  useEffect(() => { void start() }, [start])

  // 采集开始 / 中途放弃埋点（口径全在 hook 里，与 /write 共用同一份，绝不在页面里另抄）。
  // measure 在卸载那一刻才调用，故读 secondsRef 而非 seconds state。
  // ⚠️ 位置必须留在「进页面即开始录音」之后：本 hook 挂载即报 flow.capture_started，
  //    effect 执行序跟着 hook 调用序走，挪到前面就改了这条事件与开录的先后。
  const { markSubmitted } = useCaptureAbandon({
    mode: 'voice',
    measure: () => ({ durationSec: Math.round(secondsRef.current) }),
  })

  // 语音提交流程（时长门槛 → 额度守卫 → ASR → 两层预检 → 整理 → 跳转）整条在 useVoiceStorySubmit 里，
  // 与文字路径的 useStorySubmit 对称；本页只负责把录音器 / 额度守卫 / 放弃埋点三样依赖递进去，
  // 再把结果状态摊给两套视图。流程本体（含全部埋点不变式）见该 hook 的 runVoiceStorySubmit 注释。
  const {
    transcribing, error, toastMsg, quotaReached, submit: handleFinish, dismissToast, clearError,
  } = useVoiceStorySubmit({
    qid,
    stop,
    // ref 读法：取【点「完成」那一刻】的秒数，不吃旧渲染闭包里的 seconds
    getSeconds: () => secondsRef.current,
    checkQuota: checkStoryQuota,
    markSubmitted,
  })

  // 计时（转写时暂停）
  useEffect(() => {
    if (transcribing) return
    const t = setInterval(() => setSeconds((s) => { secondsRef.current = s + 1; return s + 1 }), 1000)
    return () => clearInterval(t)
  }, [transcribing])

  const handleRerecord = useCallback(async () => {
    await stop()
    secondsRef.current = 0
    setSeconds(0)
    clearError()
    void start()
  }, [stop, start, clearError])

  const viewProps: RecordingViewProps = {
    transcribing,
    error,
    seconds,
    audioLevel,
    toastMsg,
    onFinish: () => handleFinish(),
    onRerecord: () => void handleRerecord(),
    onBack: () => router.back(),
    onSwitchToText: () => navigate(qid ? `/write?qid=${qid}` : '/write'),
    onExit: () => navigate('/'),
    onDismissToast: () => dismissToast(),
  }

  return (
    <>
      <div className="lg:hidden"><RecordingMobile {...viewProps} /></div>
      {/* 桌面端：FlowShellDesktop 外壳 + RecordingDesktop 聆听舞台 */}
      <div className="hidden lg:block">
        <FlowShellDesktop activeStep="story" onExit={viewProps.onExit}>
          <RecordingDesktop {...viewProps} />
        </FlowShellDesktop>
      </div>
      {/* 匿名整理额度用尽：试用结束覆盖层，关闭即回首页 */}
      {quotaReached && <QuotaReached variant="trial" surface="recording" asOverlay onClose={() => router.push('/')} />}
      {/* 建新故事额度已满：点「完成」时才弹，关闭即回首页（录音已停，无法继续本条）。
          匿名试用用尽 → trial（引导注册）；注册用户月额度用尽 → story。 */}
      {storyQuotaVariant && (
        <QuotaReached variant={storyQuotaVariant} surface="recording" asOverlay onClose={() => router.push('/')} />
      )}
    </>
  )
}

export default function RecordingPage(): JSX.Element {
  return <Suspense><RecordingContent /></Suspense>
}
