/**
 * @module   anki/preview（⚠️ 临时预览页，仅供产品方真机看分点式卡背渲染，不接库、不上线）
 * @desc     本地 dev 塞 4 条代表性 mock 卡（part1 / part2满 / part2带空点 / part3），
 *           直接渲染 QuestionFlashCard，验统一序号脊柱布局 + 空点态 + 翻面/编辑 + 满点卡背面不裁。
 *           例句取自探针 example-report 真实生成结果。用完删。
 */
'use client'
import { useState } from 'react'
import QuestionFlashCard from '@/components/anki/QuestionFlashCard'
import type { AnkiCard } from '@/lib/anki/list'
import type { AnalysisFocusPoint } from '@/lib/types'

function mk(o: Partial<AnkiCard>): AnkiCard {
  return {
    questionId: 'q', part: 1, parentQuestionId: null, topic: '', questionText: '',
    questionTextZh: null, cueCardTitle: null, cueCardTitleZh: null, season: '2026-05',
    corpusId: 'c', corpusSummary: null, generatedAnswer: null, editedAnswer: null, analysis: null,
    box: 1, dueAt: new Date('2026-07-24').toISOString(), lastReviewedAt: null,
    hasCard: true, isAnswered: true, backKind: 'generated', ...o,
  }
}
const fp = (points: AnalysisFocusPoint[], structureLabel = ''): AnkiCard['analysis'] =>
  ({ structureLabel, focusPoints: points, phrases: [] })
const gen = (arr: { idx: number; en: string | null; noMaterial: boolean }[]): string => JSON.stringify(arr)

const CARDS: { label: string; card: AnkiCard }[] = [
  {
    label: 'Part 1（2 点·满）',
    card: mk({
      questionId: 'p1', part: 1, questionText: 'Do you usually go to bed early or late?',
      corpusSummary: '习惯晚睡、深夜脑子最清醒',
      analysis: fp([
        { title: '开门见山', desc: '开门见山先说你是早睡还是晚睡，一句话把习惯说清楚，别铺垫' },
        { title: '点到即止', desc: '挑一个真实小细节点一下（比如什么时候脑子最清醒、早上起不起得来）' },
      ]),
      generatedAnswer: gen([
        { idx: 0, en: "I'm a real night owl, I usually don't go to bed until after midnight.", noMaterial: false },
        { idx: 1, en: 'My brain actually wakes up after 10 p.m., so I do important stuff late at night.', noMaterial: false },
      ]),
    }),
  },
  {
    label: 'Part 2（3 点·满）',
    card: mk({
      questionId: 'p2', part: 2,
      corpusSummary: '跟室友因宿舍卫生分工道歉',
      questionText: 'Describe a time when you apologized to someone. You should say: who you apologized to, what the situation was, why you apologized, and how you felt afterwards.',
      cueCardTitle: 'a time you apologized to someone',
      analysis: fp([
        { title: '交代背景', desc: '一句话带过是跟谁、因为什么事，别在时间和细节精确度上停留' },
        { title: '讲清重点', desc: '为什么会到需要道歉这一步，把起因或冲突讲清楚，这是最该展开的' },
        { title: '补得更完整', desc: '道歉之后的感受、关系有没有变化' },
      ]),
      generatedAnswer: gen([
        { idx: 0, en: 'It was an apology to my roommate about our dorm cleaning duties.', noMaterial: false },
        { idx: 1, en: 'I snapped at her in front of others, saying she never cleaned up, and it really hurt her.', noMaterial: false },
        { idx: 2, en: 'After we talked it out, we got along even better and started communicating more openly.', noMaterial: false },
      ]),
    }),
  },
  {
    label: 'Part 2（含空点）',
    card: mk({
      questionId: 'p2e', part: 2, corpusSummary: '去家附近公园湖边散步解压',
      questionText: 'Describe a place you like to go to relax. You should say: where it is, how often you go, what you do there, and why it helps you relax.',
      cueCardTitle: 'a place you like to relax',
      analysis: fp([
        { title: '交代背景', desc: '一句话说清是什么地方、多久去一次' },
        { title: '讲清重点', desc: '它凭什么能让你放松，把具体做法和氛围讲透' },
        { title: '补得更完整', desc: '带给你的感受、和别处的不同' },
      ]),
      generatedAnswer: gen([
        { idx: 0, en: "It's a small park near my home, and I go there whenever I need a break.", noMaterial: false },
        { idx: 1, en: 'I just walk slowly around the lake with music on, and it feels really quiet and calm.', noMaterial: false },
        { idx: 2, en: null, noMaterial: true },
      ]),
    }),
  },
  {
    label: 'Part 3（论点-论据·静态示范）',
    card: mk({
      questionId: 'p3', part: 3, parentQuestionId: 'p2', generatedAnswer: null,
      questionText: 'Do you think people apologize enough these days?',
      analysis: fp([
        { title: '表明立场', desc: '先给出你的观点：现代人道歉够不够', example: 'I think people actually apologize less than before.' },
        { title: '讲清理由', desc: '用一个理由支撑你的立场', example: "Many just say sorry quickly to end things, not because they truly mean it." },
        { title: '延伸对比', desc: '和过去对比，或补一个不同角度', example: 'Back then, an apology often meant real effort to fix what went wrong.' },
      ]),
    }),
  },
]

export default function AnkiPreviewPage(): React.JSX.Element {
  const [i, setI] = useState(0)
  const { label, card } = CARDS[i]
  return (
    <div className="min-h-dvh bg-bg-page flex flex-col">
      <div className="flex flex-col items-center gap-4 px-6 pt-8">
        <div className="flex flex-wrap gap-2 justify-center">
          {CARDS.map((c, idx) => (
            <button
              key={c.card.questionId}
              onClick={() => setI(idx)}
              className={`min-h-[44px] px-4 rounded-full text-[13px] font-medium border ${
                idx === i ? 'bg-brand-primary-light border-brand-primary text-brand-primary-dark' : 'bg-white border-neutral-border text-v2-text-muted'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-v2-text-muted">⚠️ 临时预览 · {label} · 点卡翻面看背面、左右拖动评级、📝 编辑</p>
      </div>
      <div className="flex-1 flex items-center justify-center px-6 py-6 w-full">
        <QuestionFlashCard
          key={card.questionId}
          card={card}
          onGrade={(r) => { console.log('grade', r); setI((p) => (p + 1) % CARDS.length) }}
          onEditPoint={async (idx, en) => { console.log('editPoint', idx, en) }}
          onSupplement={(qid) => console.log('supplement', qid)}
        />
      </div>
    </div>
  )
}
