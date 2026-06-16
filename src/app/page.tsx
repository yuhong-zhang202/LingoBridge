'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Mic2, RotateCw, Lightbulb, ArrowRight, Loader2 } from 'lucide-react'
import Orb from '@/components/Orb'
import TabBar from '@/components/TabBar'
import Toast from '@/components/Toast'
import { useSwitchQuestion } from '@/hooks/useSwitchQuestion'
import { isGarbageInput, GARBAGE_TOAST_MSG } from '@/lib/utils'

export default function HomePage() {
  const router = useRouter()
  const [showTextInput, setShowTextInput] = useState(false)
  const [textStory, setTextStory] = useState('')
  const [ieltsMode, setIeltsMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const { question, loading, next } = useSwitchQuestion()

  const handleTextSubmit = useCallback(async (): Promise<void> => {
    // 第一层：即时预检，不调 API
    if (isGarbageInput(textStory)) {
      setToastMsg(GARBAGE_TOAST_MSG)
      return
    }
    setSubmitting(true)
    try {
      // 第二层：让 restructure 判断 usable
      const res = await fetch('/api/restructure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: textStory }),
      })
      if (res.ok) {
        const data = (await res.json()) as { cleanedText: string; usable: boolean }
        if (!data.usable) {
          setToastMsg(GARBAGE_TOAST_MSG)
          return
        }
      }
      // API 错误或 usable=true，放行（restructure 页会再跑一次，属已知开销）
      router.push(`/restructure?rawText=${encodeURIComponent(textStory)}`)
    } catch {
      router.push(`/restructure?rawText=${encodeURIComponent(textStory)}`)
    } finally {
      setSubmitting(false)
    }
  }, [textStory, router])

  return (
    <div className="relative h-dvh bg-bg-page flex flex-col overflow-hidden">
      <div className="ambient-light" />

      {/* 顶部栏 */}
      <div className="flex items-center h-[52px] px-5 relative z-10">
        <span className="text-[16px] font-bold text-[#111]">
          LingoBridge
        </span>
      </div>

      {/* 主体 */}
      <div className={`flex-1 min-h-0 flex flex-col items-center px-7 relative z-10 overflow-y-auto ${showTextInput ? 'pt-3 pb-[120px]' : 'pt-6 pb-[72px]'}`}>

        {/* 分段控件：故事模式 / 雅思题模式（在 Orb 上方） */}
        {!showTextInput && (
          <div className="flex justify-center mb-7">
            <div className="bg-bg-muted rounded-full p-1 inline-flex w-[228px]">
              <button
                onClick={() => setIeltsMode(false)}
                className={`flex-1 text-center py-2 text-[13.5px] font-semibold rounded-full transition-all ${
                  !ieltsMode
                    ? 'bg-bg-surface shadow-[0_1px_4px_rgba(0,0,0,0.10)] text-brand-primary-dark'
                    : 'bg-transparent text-v2-text-muted'
                }`}
              >
                我的故事
              </button>
              <button
                onClick={() => { if (!ieltsMode) { setIeltsMode(true); void next() } }}
                className={`flex-1 text-center py-2 text-[13.5px] font-semibold rounded-full transition-all ${
                  ieltsMode
                    ? 'bg-bg-surface shadow-[0_1px_4px_rgba(0,0,0,0.10)] text-brand-primary-dark'
                    : 'bg-transparent text-v2-text-muted'
                }`}
              >
                雅思题
              </button>
            </div>
          </div>
        )}

        {/* Orb（故事/录音态居中展示；文字态的小 Orb 放在引导气泡行内） */}
        {!showTextInput && <Orb size={300} pulse={false} />}

        {/* Orb 与下方间距：仅故事/录音态需要 */}
        {!showTextInput && <div className="h-[41px]" />}

        {/* 文字 + 操作区 */}
        <div className="w-full flex flex-col items-center">

          {!showTextInput && (
            <div className="text-center w-full">
              {!ieltsMode ? (
                <>
                  <h1 className="text-[20px] font-bold text-[#111] tracking-tight">
                    说说你的故事
                  </h1>
                  <p className="text-[13px] text-[#888] mt-2">
                    精准匹配雅思口语题目
                  </p>
                </>
              ) : (
                <>
                  <h1 className="w-full text-center text-[20px] font-bold text-[#111] tracking-tight leading-snug min-h-[28px]">
                    {loading
                      ? '换一题中…'
                      : question
                        ? (question.part === 2 ? (question.cue_card_title_zh ?? '') : question.question_text_zh)
                        : ''}
                  </h1>
                  <p className="text-[13px] text-[#888] mt-2">
                    聊聊你的看法
                  </p>
                  <button
                    onClick={() => void next()}
                    className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-v2-text-muted active:opacity-60"
                  >
                    <RotateCw size={12} />
                    换一题
                  </button>
                </>
              )}
            </div>
          )}

          {/* 操作区 */}
          <div className={`w-full ${showTextInput ? 'mt-0' : 'mt-4'}`}>

            {!showTextInput && (
              <>
                {/* 主按钮：开始录音 */}
                <Link href="/recording" className="block">
                  <button className="btn-gradient w-full h-[50px]">
                    <Mic2 size={16} className="text-[#555]" />
                    开始录音
                  </button>
                </Link>

                {/* 文字输入入口 */}
                <button
                  onClick={() => setShowTextInput(true)}
                  className="w-full text-center text-[13px] text-[#AAAAAA] mt-3 cursor-pointer"
                >
                  或用文字输入
                </button>
              </>
            )}

            {showTextInput && (
              <div className="w-full animate-fade-up">
                {/* 引导：Orb + 纯文本（方案 A） */}
                <div className="w-full flex items-center gap-[14px] mb-[22px]">
                  <Orb size={64} pulse={false} />
                  <p className="flex-1 text-[15px] leading-[1.5] text-v2-text-primary">分享生活小事，我帮你变成口语素材～</p>
                </div>

                {/* 故事输入卡（方案 B：白底细边框 + 内置录音入口 + 圆形发送按钮） */}
                <div className="w-full bg-white border border-black/[0.06] rounded-[18px] px-4 pt-4 pb-3">
                  <textarea
                    value={textStory}
                    onChange={e => setTextStory(e.target.value)}
                    placeholder={'用中文写下你的故事……\n比如：上周末我去了附近的公园，空气很好，待了很久，整个人都放松下来。'}
                    className="w-full min-h-[180px] bg-transparent text-[15px] text-v2-text-primary leading-[1.75] placeholder:text-[#CCCCCC] resize-none outline-none"
                    autoFocus
                  />
                  <div className="flex items-center justify-between pt-2">
                    {/* 左下：改用录音 */}
                    <button
                      onClick={() => setShowTextInput(false)}
                      className="flex items-center gap-1.5 text-[13px] text-[#AAAAAA] active:opacity-60"
                    >
                      <Mic2 size={15} />
                      改用录音
                    </button>
                    {/* 右下：圆形发送 / 开始匹配 */}
                    <button
                      disabled={textStory.trim().length < 10 || submitting}
                      onClick={() => void handleTextSubmit()}
                      aria-label="开始匹配题目"
                      className={
                        textStory.trim().length >= 10 && !submitting
                          ? 'btn-gradient-circle w-[42px] h-[42px]'
                          : 'flex items-center justify-center w-[42px] h-[42px] rounded-full bg-[#EEEEEE] cursor-not-allowed'
                      }
                    >
                      {submitting ? (
                        <Loader2 size={18} className="text-[#CCCCCC] animate-spin" />
                      ) : (
                        <ArrowRight size={18} className={textStory.trim().length >= 10 ? 'text-brand-primary-dark' : 'text-[#CCCCCC]'} />
                      )}
                    </button>
                  </div>
                </div>

                {/* 通用提示：怎样的素材更好用（方案 A，保持现状） */}
                <div className="w-full mt-6">
                  <div className="flex items-center gap-1.5 mb-[11px]">
                    <Lightbulb size={14} className="text-[#C0996F]" />
                    <span className="text-[13px] font-medium text-v2-text-secondary">怎样的素材更好用</span>
                  </div>
                  <div className="flex items-start gap-2.5 mb-[9px]">
                    <span className="flex-shrink-0 w-[18px] h-[18px] rounded-full border border-[#EADFCD] bg-[#FBF7F0] flex items-center justify-center text-[11px] text-[#B89B7E] mt-[1px]">1</span>
                    <p className="text-[13px] text-v2-text-secondary leading-relaxed">同一段真实经历，细节越全，能套用的题越多</p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="flex-shrink-0 w-[18px] h-[18px] rounded-full border border-[#EADFCD] bg-[#FBF7F0] flex items-center justify-center text-[11px] text-[#B89B7E] mt-[1px]">2</span>
                    <p className="text-[13px] text-v2-text-secondary leading-relaxed">好用的素材通常会带到：时间、人物、发生的事、你的做法和感受</p>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* 剩余空白沉到底部（仅故事/录音态需要；文字态内容长，否则会压住可滚动空间） */}
        {!showTextInput && <div className="flex-1" />}
      </div>{/* end 主体 */}

      <div className="flex-shrink-0"><TabBar /></div>
      <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />
    </div>
  )
}
