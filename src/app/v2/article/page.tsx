'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Volume2, ChevronDown, ArrowLeft } from 'lucide-react'
import Button from '@/components/ui-v2/Button'
import ChipSelect from '@/components/ui-v2/ChipSelect'
import StepProgress from '@/components/ui-v2/StepProgress'

const BANDS = [
  { value: '5.5', label: 'Band 5.5' },
  { value: '6.0', label: 'Band 6.0' },
  { value: '6.5', label: 'Band 6.5' },
  { value: '7.0', label: 'Band 7.0' },
]

const FULL_TEXT = `Last weekend, I spent some time at a local park near my home. It was a genuinely refreshing experience. The air was clean and peaceful, which made me feel calm and recharged after a busy week at work.`

const STEPS = ['故事', '文章', '题目', '练习', '反馈']

export default function V2ArticlePage() {
  const router = useRouter()
  const [band, setBand] = useState('6.0')
  const [displayed, setDisplayed] = useState('')
  const [typing, setTyping] = useState(false)
  const [done, setDone] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)

  const generate = () => {
    setDisplayed('')
    setDone(false)
    setTyping(true)
  }

  useEffect(() => {
    if (!typing) return
    if (displayed.length >= FULL_TEXT.length) {
      setTyping(false)
      setDone(true)
      return
    }
    const id = setTimeout(() => {
      setDisplayed(FULL_TEXT.slice(0, displayed.length + 1))
    }, 22)
    return () => clearTimeout(id)
  }, [typing, displayed])

  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      <div className="ambient-light-warm" />

      <div className="w-full flex items-center justify-between h-[56px] px-5 relative z-10">
        <button
          onClick={() => router.back()}
          className="w-[36px] h-[36px] rounded-full bg-bg-surface shadow-sm flex items-center justify-center"
        >
          <ArrowLeft size={16} className="text-v2-text-secondary" />
        </button>
        <span className="text-[15px] font-bold text-v2-text-primary">生成口语文章</span>
        <div className="w-[36px]" />
      </div>

      <StepProgress steps={STEPS} current={1} />

      <div className="flex-1 overflow-y-auto px-5 pb-8 relative z-10">
        {/* Band selector */}
        <div className="mb-5">
          <p className="text-[12px] font-medium text-v2-text-secondary mb-2.5">目标等级</p>
          <ChipSelect
            options={BANDS}
            value={band}
            onChange={v => {
              setBand(v)
              setDisplayed('')
              setDone(false)
              setTyping(false)
            }}
          />
        </div>

        <Button variant="primary" fullWidth size="lg" onClick={generate} className="mb-6">
          ✨ 生成 Band {band} 口语文章
        </Button>

        {(displayed.length > 0 || typing) && (
          <div className="animate-fade-up">
            <div className="bg-bg-surface rounded-[20px] border border-black/[0.05] shadow-sm p-5 mb-4">
              <div className="flex items-center justify-between mb-4">
                <span className="bg-brand-primary text-white text-[12px] font-semibold px-3 py-1 rounded-full">
                  Band {band}
                </span>
                {done && (
                  <button className="w-[30px] h-[30px] rounded-full bg-bg-muted flex items-center justify-center">
                    <Volume2 size={13} className="text-v2-text-secondary" />
                  </button>
                )}
              </div>

              <p className="text-[18px] text-v2-text-primary leading-[1.85]">
                {displayed}
                {typing && (
                  <span className="inline-block w-[2px] h-[1.1em] bg-brand-primary align-middle ml-0.5 animate-blink" />
                )}
              </p>

              {done && (
                <>
                  <button
                    onClick={() => setShowOriginal(!showOriginal)}
                    className="flex items-center gap-1.5 mt-4 text-[12px] text-v2-text-muted"
                  >
                    <ChevronDown
                      size={13}
                      className={`transition-transform ${showOriginal ? 'rotate-180' : ''}`}
                    />
                    查看原始故事
                  </button>
                  {showOriginal && (
                    <div className="bg-bg-muted rounded-[12px] px-3.5 py-3 mt-3">
                      <p className="text-[13px] text-v2-text-secondary leading-relaxed">
                        我今天去了一个公园，感觉非常开心。空气很好，待了挺长时间...
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            {done && (
              <>
                <Button
                  variant="primary"
                  fullWidth
                  size="lg"
                  onClick={() => router.push('/v2/match')}
                >
                  开始练习 →
                </Button>
                <button
                  onClick={generate}
                  className="w-full text-center text-[13px] text-v2-text-muted mt-3 py-1"
                >
                  重新生成
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
