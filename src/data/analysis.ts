/**
 * @module   analysis
 * @desc     /analysis 页面 mock 数据 — 题目侧重点分析与句型框架
 * @author   LingoBridge
 * @created  2026-05-28
 */

export type FocusPoint = {
  title: string
  desc: string
}

export type SentenceFrame = {
  text: string   // 含 [xxx] 的高亮文本
  tip?: string
}

export type AnalysisData = {
  questionId: string
  part: 'Part 1' | 'Part 2' | 'Part 3'
  en: string
  zh: string
  focusPoints: FocusPoint[]
  sentenceFrames: SentenceFrame[]
  dimension?: string
  observationPoint?: string
  structureLabel?: string
}

export const MOCK_ANALYSIS: AnalysisData = {
  questionId: 'mq1',
  part: 'Part 1',
  en: 'Do you often go to parks or outdoor spaces?',
  zh: '你经常去公园或户外场所吗？',
  dimension: '情绪内核',
  observationPoint: '一次让你压力大的具体经历',
  structureLabel: '事件 · 情绪 · 行动 · 感悟',
  focusPoints: [
    {
      title: '描述发生了什么',
      desc: '简洁交代事件背景：什么时候、发生了什么、你在哪里。1-2句话，不要展开。',
    },
    {
      title: '说出当时的感受',
      desc: '用具体的情绪词描述你的第一反应。避免只说"I was upset"，要说出为什么（e.g. "I panicked because..."）',
    },
    {
      title: '你做了什么',
      desc: '描述你采取的行动步骤。这里是内容最多的部分，撑起 Part 2 的时长。',
    },
    {
      title: '结果或感悟',
      desc: '事情如何收尾，或你从中学到什么。一句话点题，给答案一个收口。',
    },
  ],
  sentenceFrames: [
    {
      text: 'I [go to the park] quite often — usually [on weekends] when I need to [clear my head].',
      tip: '频率 + 时间 + 原因三要素',
    },
    {
      text: 'There\'s a [small park near my home] where I like to [take a slow walk] and [enjoy the fresh air].',
      tip: '具体地点 + 具体行为',
    },
    {
      text: 'Last weekend, I actually [spent the whole afternoon] there — it was [surprisingly relaxing].',
      tip: '引入个人经历作佐证',
    },
  ],
}
