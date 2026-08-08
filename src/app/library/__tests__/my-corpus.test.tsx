/**
 * @module   my-corpus.test
 * @desc     素材库「我的语料」tab 的守卫（2026-08-08 改版：卡片单位从「对子」换成「语料」）。
 *
 *   【为什么要有这组测试】改版前本 tab 只列已绑对子的语料（fetchAnkiCards 后 filter(corpusId !== null)），
 *   用户录了故事却还没绑题，在素材库里完全看不到 —— 这正是用户反馈的那条。同时按对子铺卡会让
 *   「一条语料绑 3 道题」变成 3 张卡，而删任一张会连带移除全部同源卡（用户点一张、消失三张）。
 *   这两条都是「跑起来看着挺正常、只有特定数据形状才暴露」的性质，必须钉成机器检查。
 *
 *   【每条守的是行为还是结构，逐条标注】
 *     · describe 一 ~ 四：守【行为】—— 合并/筛选/搜索/空态判定/文案都是纯函数，测的是真实返回值。
 *     · describe 五：守【结构】—— 本仓库无 jsdom / testing-library 且禁止新增依赖，交互点不下去，
 *       只能用 renderToStaticMarkup 对渲染产物做结构断言（li 个数、可点 chip 个数、aria 属性、文案在不在）。
 *       它证明不了「点了会跳到哪」，那部分由 describe 六的源码守卫兜一层。
 *     · describe 六：守【结构】—— 对 MyCorpusTab 源码做文本断言（并发拉取、上报口径、CTA 落点）。
 *       容器组件的数据流全在 useEffect 里，SSR 渲染只出骨架屏，静态渲染够不着。
 * @author   LingoBridge
 * @created  2026-08-08
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Corpus } from '@/lib/types'
import type { AnkiCard } from '@/lib/anki/list'
import MyCorpusCard from '../MyCorpusCard'
import MyCorpusList from '../MyCorpusList'
import MyCorpusFilterBar from '../MyCorpusFilterBar'
import {
  mergeCorpusWithCards,
  itemSearchText,
  matchesFilter,
  countByFilter,
  resolveListState,
  deleteConfirmDescription,
  bulkDeleteConfirmDescription,
  type MyCorpusItem,
} from '../my-corpus-model'

// ── fixture ────────────────────────────────────────────────────────────────
/** 造一条语料（只填本 tab 用得到的字段，其余给合法默认值） */
function corpus(id: string, over: Partial<Corpus> = {}): Corpus {
  return {
    id,
    userId: 'u1',
    source: 'voice',
    rawText: `原始转写 ${id}`,
    cleanedText: `整理后的故事 ${id}`,
    summary: `概括 ${id}`,
    audioUrl: null,
    status: 'extracted',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

/** 造一张已答的 anki 卡（对子） */
function card(questionId: string, corpusId: string | null, over: Partial<AnkiCard> = {}): AnkiCard {
  return {
    questionId,
    part: 1,
    parentQuestionId: null,
    topic: 'music',
    questionText: `题面 ${questionId}`,
    questionTextZh: null,
    cueCardTitle: null,
    cueCardTitleZh: null,
    season: '2026-05',
    corpusId,
    corpusSummary: null,
    generatedAnswer: null,
    editedAnswer: null,
    analysis: null,
    box: 1,
    dueAt: '2026-08-10T00:00:00.000Z',
    lastReviewedAt: null,
    hasCard: true,
    isAnswered: true,
    backKind: 'generated',
    ...over,
  }
}

/** 造一个列表项（渲染测试用） */
function item(id: string, questionCount: number, over: Partial<MyCorpusItem> = {}): MyCorpusItem {
  return {
    id,
    source: 'voice',
    text: `我讲的那段经历 ${id}`,
    summary: `概括 ${id}`,
    createdAt: '2026-08-01T00:00:00.000Z',
    questions: Array.from({ length: questionCount }, (_, i) => ({
      questionId: `${id}-q${i}`,
      part: 1 as const,
      title: `题面 ${id}-q${i}`,
      topic: 'music',
      backReady: true,
    })),
    ...over,
  }
}

const noop = (): void => {}

// ── 一、合并：一条语料一项，未绑题的也在 ─────────────────────────────────────
describe('mergeCorpusWithCards（守行为）', () => {
  it('未绑题的语料【会出现在列表里】—— 本次改版要解决的核心诉求', () => {
    // ⚠️ 变异守卫：把「未绑题的过滤掉」写回来（如 .filter(c => 有卡）→ 本条变红。
    const items = mergeCorpusWithCards([corpus('c1'), corpus('c2')], [card('q1', 'c1')])
    expect(items.map((it) => it.id)).toEqual(['c1', 'c2'])
    expect(items.find((it) => it.id === 'c2')?.questions).toHaveLength(0)
  })

  it('一条语料绑 3 道题时【只产生 1 项】，3 道题收进 questions —— 不是 3 项', () => {
    // ⚠️ 变异守卫：退回按对子铺卡（每张 anki 卡一项）→ 长度变成 3，本条变红。
    const items = mergeCorpusWithCards(
      [corpus('c1')],
      [card('q1', 'c1'), card('q2', 'c1'), card('q3', 'c1')],
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.questions.map((q) => q.questionId)).toEqual(['q1', 'q2', 'q3'])
  })

  it('默认按 createdAt 倒序【混排】，未绑题的不被置顶成一屏待办', () => {
    const items = mergeCorpusWithCards(
      [
        corpus('old-bound', { createdAt: '2026-08-01T00:00:00.000Z' }),
        corpus('new-free', { createdAt: '2026-08-05T00:00:00.000Z' }),
        corpus('mid-free', { createdAt: '2026-08-03T00:00:00.000Z' }),
      ],
      [card('q1', 'old-bound')],
    )
    expect(items.map((it) => it.id)).toEqual(['new-free', 'mid-free', 'old-bound'])
  })

  it('corpusId 为 null 的卡不参与合并，也不会凭空造出一项', () => {
    const items = mergeCorpusWithCards([corpus('c1')], [card('q1', null), card('q2', 'c1')])
    expect(items).toHaveLength(1)
    expect(items[0]?.questions).toHaveLength(1)
  })

  it('Part2 用 cue card 标题作题面，其余用题面本身', () => {
    const items = mergeCorpusWithCards(
      [corpus('c1')],
      [card('q1', 'c1', { part: 2, cueCardTitle: 'Describe a song' })],
    )
    expect(items[0]?.questions[0]?.title).toBe('Describe a song')
  })

  it('正文取整理后文本，没有时退回原始转写', () => {
    const items = mergeCorpusWithCards([corpus('c1', { cleanedText: null })], [])
    expect(items[0]?.text).toBe('原始转写 c1')
  })
})

// ── 二、筛选与搜索 ──────────────────────────────────────────────────────────
describe('筛选三档与计数（守行为）', () => {
  const items = [item('a', 2), item('b', 0), item('c', 1), item('d', 0)]

  it('「全部」= 全都在；「已结对」= 只留绑了题的；「还没绑题目」= 只留没绑的', () => {
    expect(items.filter((it) => matchesFilter(it, 'all')).map((it) => it.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(items.filter((it) => matchesFilter(it, 'paired')).map((it) => it.id)).toEqual(['a', 'c'])
    expect(items.filter((it) => matchesFilter(it, 'unpaired')).map((it) => it.id)).toEqual(['b', 'd'])
  })

  it('三档计数与筛选结果一致（M + K = 全部）', () => {
    const counts = countByFilter(items)
    expect(counts).toEqual({ all: 4, paired: 2, unpaired: 2 })
    expect(counts.paired + counts.unpaired).toBe(counts.all)
  })
})

describe('itemSearchText（守行为）', () => {
  it('可搜文本【包含语料正文】—— 用户搜自己的故事时脑子里是原话，不是 AI 写的概括', () => {
    // ⚠️ 变异守卫：把 item.text 从拼接里去掉 → 本条变红。
    const text = itemSearchText(item('a', 1, { text: '那年我在敦煌看了一场沙尘暴', summary: '旅行' }))
    expect(text).toContain('那年我在敦煌看了一场沙尘暴')
    expect(text).toContain('旅行')
    expect(text).toContain('题面 a-q0')
  })
})

// ── 三、四档空态的触发条件 ───────────────────────────────────────────────────
describe('resolveListState（守行为）', () => {
  const base = { loading: false, error: false, totalCount: 3, searching: false, filter: 'all' as const, visibleCount: 3 }

  it('loading 期即使 totalCount=0 也【不显示「一条都没有」】，走骨架屏', () => {
    // ⚠️ 变异守卫：把 loading 判断挪到 totalCount 之后 → 本条变红（这正是「空态闪一下」的成因）。
    expect(resolveListState({ ...base, loading: true, totalCount: 0, visibleCount: 0 })).toBe('loading')
  })

  it('error 优先于空态', () => {
    expect(resolveListState({ ...base, error: true, totalCount: 0, visibleCount: 0 })).toBe('error')
  })

  it('一条语料都没有 → empty-no-corpus', () => {
    expect(resolveListState({ ...base, totalCount: 0, visibleCount: 0 })).toBe('empty-no-corpus')
  })

  it('有语料、搜不到 → empty-search（搜索优先于筛选档空态）', () => {
    expect(resolveListState({ ...base, searching: true, visibleCount: 0, filter: 'unpaired' })).toBe('empty-search')
  })

  it('筛选「已结对」为空 → empty-paired', () => {
    expect(resolveListState({ ...base, filter: 'paired', visibleCount: 0 })).toBe('empty-paired')
  })

  it('筛选「还没绑题目」为空 → empty-unpaired', () => {
    expect(resolveListState({ ...base, filter: 'unpaired', visibleCount: 0 })).toBe('empty-unpaired')
  })

  it('有可见项就是列表，任何空态都不该抢在前面', () => {
    expect(resolveListState({ ...base, searching: true, filter: 'unpaired', visibleCount: 1 })).toBe('list')
  })
})

// ── 四、删除确认文案 ────────────────────────────────────────────────────────
describe('删除确认文案（守行为）', () => {
  it('单条 · 还没绑题：只说删的是那段经历本身、找不回', () => {
    expect(deleteConfirmDescription(0)).toBe('删掉的是你讲的那段经历本身，删除后没法找回。')
  })

  it('单条 · 已绑 N 道题：保留【含你手动编辑过的内容】这个知情点', () => {
    // ⚠️ 变异守卫：删掉括号里那句 → 本条变红。deleteCorpus 会连用户亲手改过的卡背一起清（0060 事务型 RPC），
    // 不可逆操作的确认框必须让他知情后再点，这是 2026-08-07 补上的、不许在改版里丢。
    const desc = deleteConfirmDescription(3)
    expect(desc).toContain('含你手动编辑过的内容')
    expect(desc).toContain('正用着它的 3 道题会变回「还没绑语料」')
    expect(desc).toContain('题卡和你的复习进度都还在')
  })

  it('桌面批量 · 有绑题的：报出其中几条正被题目用着，并保留知情点', () => {
    const desc = bulkDeleteConfirmDescription(5, 2)
    expect(desc).toContain('那几段经历本身')
    expect(desc).toContain('其中 2 条正被题目用着')
    expect(desc).toContain('含你手动编辑过的内容')
  })

  it('桌面批量 · 一条没绑题的：不硬塞卡背那句（没有卡背会被清，说了是误导）', () => {
    expect(bulkDeleteConfirmDescription(3, 0)).toBe('删掉的是你讲的那几段经历本身，删除后没法找回。')
  })
})

// ── 五、渲染产物结构 ────────────────────────────────────────────────────────
describe('列表与卡片的渲染结构（守结构，不是守交互）', () => {
  const listProps = {
    selecting: false,
    isSelected: (): boolean => false,
    onToggleSelect: noop,
    onRequestDelete: noop,
    onOpenQuestion: noop,
    onFindQuestions: noop,
  }

  it('列表是 <ul>/<li>：读屏才会报「共 N 项、第 3 项」', () => {
    // ⚠️ 变异守卫：改回 div 堆叠 → 本条变红。
    const markup = renderToStaticMarkup(
      <MyCorpusList items={[item('a', 1), item('b', 0)]} {...listProps} />,
    )
    expect(markup).toMatch(/^<ul\b/)
    expect(markup.match(/<li\b/g)).toHaveLength(2)
  })

  it('一条语料绑 3 道题时列表里【只有一个 li】，卡内 3 枚题目 chip', () => {
    // ⚠️ 变异守卫：退回按对子铺卡 → li 变 3 个，本条变红。
    const markup = renderToStaticMarkup(<MyCorpusList items={[item('a', 3)]} {...listProps} />)
    expect(markup.match(/<li\b/g)).toHaveLength(1)
    expect(markup).toContain('已绑 3 道题')
    for (const q of ['题面 a-q0', '题面 a-q1', '题面 a-q2']) expect(markup).toContain(q)
  })

  it('未绑题的卡：有「还没绑题目」标 +「去匹配题目」入口，没有「已绑」计数', () => {
    const markup = renderToStaticMarkup(
      <MyCorpusCard item={item('a', 0)} onOpenQuestion={noop} onFindQuestions={noop} />,
    )
    expect(markup).toContain('还没绑题目')
    expect(markup).toContain('去匹配题目')
    expect(markup).not.toContain('已绑')
    // 措辞红线：不许退回「未结对」（读起来像失败）或旧的「查看 ›」（落点其实会重跑整条 AI 匹配）
    expect(markup).not.toContain('未结对')
    expect(markup).not.toContain('查看')
  })

  it('已绑题的卡：不出现「去匹配题目」，且计数措辞是「已绑 N 道题」而不是「已匹配 N 道题」', () => {
    const markup = renderToStaticMarkup(
      <MyCorpusCard item={item('a', 2)} onOpenQuestion={noop} onFindQuestions={noop} />,
    )
    expect(markup).toContain('已绑 2 道题')
    expect(markup).not.toContain('已匹配')
    expect(markup).not.toContain('去匹配题目')
  })

  it('卡壳是普通白卡（rounded-16 + 描边），不是 AI 输出专用的渐变描边强调卡', () => {
    // ⚠️ 变异守卫：把 <Card> 换成 variant="gradient" 或手写 GRADIENT_BORDER_STYLE_FULL_OPAQUE → 本条变红。
    const markup = renderToStaticMarkup(
      <MyCorpusCard item={item('a', 1)} onOpenQuestion={noop} onFindQuestions={noop} />,
    )
    expect(markup).toContain('bg-white rounded-[16px] border border-black/[0.05]')
    expect(markup).not.toContain('rounded-[18px]')
  })

  it('来源徽章按 voice/text 分流（语音 / 文本）', () => {
    const voice = renderToStaticMarkup(
      <MyCorpusCard item={item('a', 0, { source: 'voice' })} onOpenQuestion={noop} onFindQuestions={noop} />,
    )
    const text = renderToStaticMarkup(
      <MyCorpusCard item={item('a', 0, { source: 'text' })} onOpenQuestion={noop} onFindQuestions={noop} />,
    )
    expect(voice).toContain('语音')
    expect(text).toContain('文本')
  })

  it('移动端卡角删除按钮：44×44 命中区 + 带语料信息的 aria-label（读屏能分清删的是哪条）', () => {
    const markup = renderToStaticMarkup(<MyCorpusList items={[item('a', 0)]} {...listProps} />)
    expect(markup).toContain('w-11 h-11')
    expect(markup).toContain('aria-label="删除语料：概括 a"')
  })

  it('筛选行：三档都带 aria-pressed，当前档为 true；移动端命中区 min-h-[44px]', () => {
    const markup = renderToStaticMarkup(
      <MyCorpusFilterBar value="unpaired" onChange={noop} counts={{ all: 4, paired: 2, unpaired: 2 }} />,
    )
    expect(markup.match(/aria-pressed="(true|false)"/g)).toHaveLength(3)
    expect(markup).toContain('aria-pressed="true"')
    expect(markup.match(/min-h-\[44px\]/g)?.length).toBeGreaterThanOrEqual(3)
    expect(markup).toContain('还没绑题目')
  })
})

// ── 六、容器源码守卫（够不着的部分） ─────────────────────────────────────────
describe('MyCorpusTab 源码守卫（守结构）', () => {
  const src = readFileSync(join(__dirname, '..', 'MyCorpusTab.tsx'), 'utf8')

  it('语料与对子【并发】拉取，不串行', () => {
    // ⚠️ 变异守卫：改成先 await listMyCorpus() 再 await fetchAnkiCards → 本条变红。
    const call = src.slice(src.indexOf('Promise.all(['), src.indexOf('])', src.indexOf('Promise.all([')))
    expect(call).toContain('listMyCorpus()')
    expect(call).toContain("fetchAnkiCards(1, 'answered')")
    expect(call).toContain("fetchAnkiCards(2, 'answered')")
  })

  it('对外上报的计数是【语料数】（items.length），不是对子数 —— 与 hub「已攒下 N 条」同口径', () => {
    expect(src).toContain('onCountChange?.(items.length)')
  })

  it('「去匹配题目」落点是 /matching?corpusId=（会跑一整条 AI 匹配），题目 chip 落点是 /analysis 复练范式', () => {
    expect(src).toContain('navigate(`/matching?corpusId=${encodeURIComponent(corpusId)}`)')
    expect(src).toContain('/analysis?questionId=')
    expect(src).toContain('review=1')
  })

  it('桌面批量删除先过 ConfirmDialog 再进撤销窗口（撤销窗口不承担知情职责）', () => {
    expect(src).toContain('setBulkConfirm(true)')
    expect(src).toContain('bulkDeleteConfirmDescription(sel.selectedCount, selectedBoundCount)')
  })
})
