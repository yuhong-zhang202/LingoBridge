/**
 * @module   MyCorpusCard
 * @desc     「我的语料」单卡（纯展示，状态与跳转由 tab 注入）。一条语料一张卡，它绑的题收在卡内，
 *           每道题一枚可点 Chip；没绑题的语料是同一张卡，少了 Chip 区、多一个「去匹配题目」入口。
 *
 *           三处刻意的取舍：
 *           1. 外壳用普通 <Card>，不套渐变描边。DESIGN 里「强调卡（gradient）= AI 输出内容」，
 *              用户自己讲的故事不是 AI 产出，给它渐变描边会与 feedback 页的 AI 卡撞语义。
 *           2. CTA 写「去匹配题目」而不是「查看」：落点 /matching?corpusId= 会重跑整条 AI 匹配
 *              （耗时可达数十秒，还可能撞 402/429 额度墙），说「查看」会让用户以为只是看一眼。
 *              也不写「重新找题目」—— 生产库 194 条语料里 188 条（97%）从来没匹配成功过，
 *              对绝大多数语料来说这是【第一次】，说「重新」是错的。
 *           3. 未绑题分支的 CTA 用 <GradientButton>（CTA 级）而不是纯文本按钮：按上面那个 97%，
 *              「还没绑题目」是用户打开本 tab 时看到的主流形态，不是兜底分支，它的动作要按主路径给权重。
 * @author   LingoBridge
 * @created  2026-08-08
 */
'use client'
import type { JSX } from 'react'
import { Mic2, Keyboard, Loader2, ChevronRight } from 'lucide-react'
import Card from '@/components/Card'
import Tag from '@/components/Tag'
import Chip from '@/components/Chip'
import GradientButton from '@/components/GradientButton'
import { BRAND_GRADIENT_SOFT } from '@/lib/constants'
import { formatRelativeTime } from '@/lib/utils'
import { prettifyTopic } from '@/lib/topic'
import type { MyCorpusItem } from './my-corpus-model'

interface Props {
  item: MyCorpusItem
  /** 点卡内题目 Chip：进该题「题目分析」页（复练范式）。 */
  onOpenQuestion: (corpusId: string, questionId: string) => void
  /** 点「去匹配题目」：进 /matching 跑一整条 AI 匹配（不是静态查看）。 */
  onFindQuestions: (corpusId: string) => void
}

/** 语料摘要（用于按钮 aria-label 区分多张卡）：概括优先，否则截正文前 14 字。 */
function shortLabel(item: MyCorpusItem): string {
  if (item.summary && item.summary.trim() !== '') return item.summary
  const t = item.text.trim()
  return t.length > 14 ? `${t.slice(0, 14)}…` : t
}

/**
 * 「我的语料」单卡
 * @param item            一条语料 + 它绑的题
 * @param onOpenQuestion  点题目 Chip 的跳转
 * @param onFindQuestions 点「去匹配题目」的跳转
 */
export default function MyCorpusCard({ item, onOpenQuestion, onFindQuestions }: Props): JSX.Element {
  const isVoice = item.source === 'voice'
  const bound = item.questions.length

  return (
    <Card className="p-4 lg:h-full flex flex-col">
      {/* 头部：来源徽章 + 相对时间。pr-9 给移动端卡角删除按钮 / 桌面选择 checkbox 留位 */}
      <div className="flex items-center gap-2 mb-2.5 pr-9">
        <div className="flex-shrink-0 inline-flex" style={{ background: BRAND_GRADIENT_SOFT, borderRadius: 9999, padding: 1 }}>
          <div className="flex items-center gap-1 bg-white" style={{ borderRadius: 9999, padding: '2px 8px' }}>
            {isVoice
              ? <Mic2 size={11} className="text-brand-primary-dark" />
              : <Keyboard size={11} className="text-brand-primary-dark" />}
            <span className="text-[0.6875rem] font-medium text-brand-primary-dark">{isVoice ? '语音' : '文本'}</span>
          </div>
        </div>
        <span className="text-[0.75rem] text-v2-text-muted">{formatRelativeTime(item.createdAt)}</span>
      </div>

      {/* 正文：用户讲的那段经历本身（整理后优先），三行截断 */}
      <p className="text-[0.875rem] text-v2-text-primary leading-[1.6] line-clamp-3">
        {item.text}
      </p>

      <div className="border-t border-black/[0.06] my-3" />

      {/* 结对区：桌面 mt-auto 贴底，同行两卡等高时视觉齐整 */}
      <div className="lg:mt-auto">
        {bound > 0 ? (
          <>
            {/* 「已绑 N 道题」是真实对子数；不写「已匹配 N 道题」—— 那是「观察点能匹配到的题库题数」，
                拿技术口径冒充用户成就是误导 */}
            <p className="text-[0.75rem] text-v2-text-muted mb-2">已绑 {bound} 道题</p>
            <div className="flex flex-wrap gap-1.5">
              {item.questions.map((q) => {
                const topic = prettifyTopic(q.topic)
                return (
                  <Chip
                    key={q.questionId}
                    variant="ghost"
                    size="md"
                    onClick={() => onOpenQuestion(item.id, q.questionId)}
                    // 移动端 min-h-[44px] 达 WCAG 2.5.5 触控目标；桌面收窄
                    className="min-h-[44px] lg:min-h-[32px] max-w-full"
                  >
                    <span className="flex-shrink-0 text-brand-primary-dark font-medium">Part {q.part}</span>
                    {/* truncate 只截视觉，DOM 里题面仍完整 —— 读屏能读全，不必另配 aria-label */}
                    <span className="truncate max-w-[13rem]">{q.title}</span>
                    {!q.backReady && (
                      <>
                        <Loader2 size={11} className="flex-shrink-0 animate-spin text-brand-primary-dark" />
                        <span className="sr-only">卡背生成中</span>
                      </>
                    )}
                    {topic && <span className="sr-only">，话题 {topic}</span>}
                  </Chip>
                )
              })}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* 用 Tag gray（描边 + v2-text-muted 文字）承载状态文字；不用 neutral-mute #CCCCCC，对比度不足 */}
            <Tag variant="gray" label="还没绑题目" />
            <GradientButton
              onClick={() => onFindQuestions(item.id)}
              // 一屏多张卡时读屏会听到一串同名按钮，补上是哪段经历
              aria-label={`去匹配题目：${shortLabel(item)}`}
              className="inline-flex items-center gap-[3px] min-h-[44px] px-4 rounded-full text-[0.8125rem] font-medium"
            >
              去匹配题目
              <ChevronRight size={14} className="text-brand-primary-dark" />
            </GradientButton>
          </div>
        )}
      </div>
    </Card>
  )
}
