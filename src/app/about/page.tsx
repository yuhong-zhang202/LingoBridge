/**
 * @module   AboutPage
 * @desc     「关于 LingoBridge」内容页 — 桌面 TopNav / 移动 TopBar（带返回），居中可读栏排版；
 *           文案为定稿，仅做排版分节。从「我的 → 关于 LingoBridge」进入。
 * @author   LingoBridge
 * @created  2026-07-10
 */
import type { Metadata } from 'next'
import TopNav from '@/components/TopNav'
import TopBar from '@/components/TopBar'
import Card from '@/components/Card'
import { BRAND_GRADIENT_SOFT } from '@/lib/constants'

export const metadata: Metadata = { title: '关于 LingoBridge' }

/** 步骤序号：渐变环 + 白底 + 深灰数字（同 analysis 页 StepNum 视觉语言；不用白字实心圆，对比度达标） */
function StepNum({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex-shrink-0 mt-[1px]"
      style={{ background: BRAND_GRADIENT_SOFT, padding: 1, borderRadius: '50%', width: 22, height: 22 }}
    >
      <span className="w-full h-full rounded-full bg-white flex items-center justify-center">
        <span className="text-[11px] font-bold leading-none text-v2-text-secondary">{n}</span>
      </span>
    </span>
  )
}

/** 使用步骤（定稿文案：冒号前为步骤名，加重；冒号后为说明） */
const STEPS: { lead: string; rest: string }[] = [
  { lead: '讲 / 写下你的故事', rest: '用录音或打字，把发生过的一件小事说出来，中文也行。' },
  { lead: '我们帮你理清 + 补表达', rest: '整理逻辑、补上自然的英文说法。' },
  { lead: '匹配到雅思题目', rest: '从你的故事里识别出可用的维度，匹配到当季相关真题。' },
  { lead: '分析与练习', rest: '看清考官在这道题上看重什么、有哪些能直接用的表达，再和 AI 教练即兴对练。' },
  { lead: '即时反馈', rest: '每次练完给你正向、具体的反馈，形成“越练越敢开口”的闭环。' },
]

export default function AboutPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-bg-page">
      {/* 桌面：全站顶部导航；移动：带返回的顶栏（与 settings 等子页一致，无 TabBar） */}
      <div className="hidden lg:block"><TopNav /></div>
      <div className="lg:hidden"><TopBar title="关于 LingoBridge" /></div>

      <main className="max-w-[640px] mx-auto px-6 pt-8 pb-20 lg:pt-14">
        <h1 className="text-[24px] lg:text-[28px] font-bold tracking-tight text-v2-text-primary text-balance">
          关于 LingoBridge
        </h1>

        <section className="mt-9">
          <h2 className="text-[16px] font-bold text-v2-text-primary">LingoBridge 是什么</h2>
          <p className="mt-2.5 text-[15px] leading-[1.85] text-v2-text-secondary">
            一款为雅思口语备考打造的练习工具。它不让你背题库范文，而是把你真实经历过的生活小事，变成能在考场上用得出来的口语素材。
          </p>
        </section>

        <section className="mt-9">
          <h2 className="text-[16px] font-bold text-v2-text-primary">为什么是“讲故事”，而不是“背题”</h2>
          <p className="mt-2.5 text-[15px] leading-[1.85] text-v2-text-secondary">
            背下来的答案，一旦考官换个问法就卡住；而你亲身经历的事，怎么问你都讲得出、讲得真。LingoBridge
            相信：最好的口语素材，是你自己的故事——它只负责帮你把这些故事理清楚、补上地道表达，再匹配到合适的雅思题目上。
          </p>
        </section>

        <section className="mt-9">
          <h2 className="text-[16px] font-bold text-v2-text-primary">怎么用</h2>
          <Card className="mt-3 px-6 py-5">
            <ol className="flex flex-col gap-4">
              {STEPS.map(({ lead, rest }, i) => (
                <li key={lead} className="flex items-start gap-3">
                  <StepNum n={i + 1} />
                  <p className="text-[14px] leading-[1.75] text-v2-text-secondary">
                    <strong className="font-semibold text-v2-text-primary">{lead}</strong>
                    ：{rest}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </section>

        <section className="mt-9">
          <h2 className="text-[16px] font-bold text-v2-text-primary">给谁</h2>
          <p className="mt-2.5 text-[15px] leading-[1.85] text-v2-text-secondary">
            给不想再死记硬背、希望说出来的英文是自己的、真实的、临场也不慌的雅思考生。
          </p>
        </section>

        {/* 收尾 tagline：全页唯一的渐变强调时刻 */}
        <blockquote className="mt-12">
          <Card variant="gradient" className="px-8 py-7 text-center">
            <p className="text-[16px] lg:text-[17px] font-semibold text-v2-text-primary text-balance">
              LingoBridge，把你的生活，变成你的口语。
            </p>
          </Card>
        </blockquote>
      </main>
    </div>
  )
}
