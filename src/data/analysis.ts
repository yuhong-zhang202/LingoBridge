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
}

export const MOCK_ANALYSIS: AnalysisData = {
  questionId: 'mq1',
  part: 'Part 1',
  en: 'Do you often go to parks or outdoor spaces?',
  zh: '你经常去公园或户外场所吗？',
  focusPoints: [
    {
      title: '频率 + 场景描述',
      desc: '考官期待你说明去的频率，并具体描述是什么样的户外场所。',
    },
    {
      title: '感受 + 原因',
      desc: '表达你喜欢或不喜欢的原因，用情绪词让回答更生动。',
    },
    {
      title: '与个人经历结合',
      desc: '用最近的真实经历作为例子，使回答更具说服力。',
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
