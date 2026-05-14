'use client'
import { useRouter } from 'next/navigation'
import { ArrowRight, ChevronRight, ArrowLeft } from 'lucide-react'
import Button from '@/components/ui-v2/Button'
import StepProgress from '@/components/ui-v2/StepProgress'

const OPTIMIZATIONS = [
  {
    type: '词汇',
    color: '#D4875A',
    bg: '#F2D5C0',
    original: 'very nice',
    improved: 'genuinely refreshing',
  },
  {
    type: '语法',
    color: '#7BA699',
    bg: '#C8DDD9',
    original: 'I was feeling good',
    improved: 'I felt calm and recharged',
  },
  {
    type: '流利',
    color: '#9A7DB8',
    bg: '#E0D5F0',
    original: 'stayed a long time',
    improved: 'spent a considerable amount of time',
  },
]

const STEPS = ['故事', '文章', '题目', '练习', '反馈']

export default function V2FeedbackPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      <div className="w-full flex items-center justify-between h-[56px] px-5">
        <button
          onClick={() => router.back()}
          className="w-[36px] h-[36px] rounded-full bg-bg-surface shadow-sm flex items-center justify-center"
        >
          <ArrowLeft size={16} className="text-v2-text-secondary" />
        </button>
        <span className="text-[15px] font-bold text-v2-text-primary">练习反馈</span>
        <div className="w-[36px]" />
      </div>

      <StepProgress steps={STEPS} current={4} />

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {/* Score card */}
        <div className="bg-bg-surface rounded-[20px] border border-black/[0.05] shadow-sm p-5 mb-5">
          <p className="text-[12px] text-v2-text-muted mb-3">本次得分</p>
          <div className="flex items-end gap-3">
            <span className="text-[48px] font-bold text-brand-primary leading-none">7.2</span>
            <div className="mb-1.5">
              <span className="text-[14px] text-v2-text-secondary">/ 9.0</span>
              <p className="text-[11px] text-v2-text-muted">较上次 +0.3</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[['词汇', '7.0'], ['流利', '7.5'], ['语法', '7.0']].map(([label, score]) => (
              <div key={label} className="bg-bg-muted rounded-[12px] px-3 py-2.5 text-center">
                <p className="text-[11px] text-v2-text-muted">{label}</p>
                <p className="text-[17px] font-bold text-v2-text-primary mt-0.5">{score}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Optimization tags */}
        <h3 className="text-[14px] font-bold text-v2-text-primary mb-3">优化建议</h3>
        <div className="flex flex-col gap-3 mb-6">
          {OPTIMIZATIONS.map((opt, i) => (
            <div
              key={i}
              className="bg-bg-surface rounded-[16px] border border-black/[0.05] p-4"
            >
              <span
                className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full mb-3"
                style={{ color: opt.color, background: opt.bg }}
              >
                {opt.type}
              </span>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-[#FFF0EC] rounded-[10px] px-3 py-2">
                  <p className="text-[10px] text-[#C4605A] mb-0.5 font-medium">原表达</p>
                  <p className="text-[13px] text-[#C4605A]">&ldquo;{opt.original}&rdquo;</p>
                </div>
                <ArrowRight size={14} className="text-v2-text-muted flex-shrink-0" />
                <div className="flex-1 bg-[#EDF6F4] rounded-[10px] px-3 py-2">
                  <p className="text-[10px] text-[#5BA08A] mb-0.5 font-medium">建议表达</p>
                  <p className="text-[13px] text-[#5BA08A]">&ldquo;{opt.improved}&rdquo;</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button variant="primary" fullWidth size="lg" onClick={() => router.push('/v2')}>
          完成练习 <ChevronRight size={16} />
        </Button>
        <button
          onClick={() => router.push('/v2/practice-dialog')}
          className="w-full text-center text-[13px] text-v2-text-muted mt-3 py-1"
        >
          再练一遍
        </button>
      </div>
    </div>
  )
}
