/**
 * @module   MatchStatusNote.test
 * @desc     状态说明卡的渲染验证 —— 判据函数（match-early-hint.test）只证「该不该提示」，
 *           这一份证「提示真的从 meta 帧一路走到了 DOM」：外壳 → MatchStatusNote → MatchingProgress
 *           这条 props 链只要断一环，纯函数测试全绿而用户屏幕上什么都没有。
 *
 *   项目内没有 testing-library / 浏览器自动化，故用 react-dom/server 静态渲染取 HTML 断言：
 *   useEffect 不跑（计时器不启动），但本次要验的东西（提示行是否出现、名字是否露 code）全在首帧标记里。
 *
 * @author   LingoBridge
 * @created  2026-08-15
 */
import { renderToStaticMarkup } from 'react-dom/server'
import MatchStatusNote from '@/components/matching/MatchStatusNote'
import { matchEarlyHint } from '@/lib/match-early-hint'
import type { MatchPhase } from '@/app/matching/phase'
import type { MatchedPoint } from '@/lib/types'

const PRIMARY: MatchedPoint = {
  pointCode: 'REL_11',
  pointName: '一次关系摩擦或冲突',
  dimension: '人际羁绊',
  reason: '整段故事的重心在那次争执上',
}

/**
 * 按两端共用的调用方式渲染说明卡。
 * @param phase 页面形态
 * @param meta  meta 帧字段子集；null = 无 meta 帧（?stream=0 降级路）
 * @returns     静态 HTML
 */
function render(phase: MatchPhase, meta: Parameters<typeof matchEarlyHint>[0]): string {
  return renderToStaticMarkup(
    <MatchStatusNote
      phase={phase}
      cardClassName="px-4 py-3 min-h-[84px]"
      secondary={null}
      hasHigh={false}
      matchedViaSecondary={false}
      arrivedCount={0}
      candidateCount={meta?.candidateCount ?? null}
      earlyHint={matchEarlyHint(meta)}
      missingCorpus={false}
      onRetry={() => {}}
    />,
  )
}

describe('MatchStatusNote · 等待期前置提示真的渲染出来了', () => {
  test('走邻居 + 等待中：提示行出现，带观察点中文名，不含 code', () => {
    const html = render('waiting', { primary: PRIMARY, matchedViaNeighbor: true, candidateCount: 4 })
    expect(html).toContain('一次关系摩擦或冲突')
    expect(html).toContain('这一季的真题里没有直接问它的')
    expect(html).not.toContain('REL_11')
  })

  test('题目已在陆续到达（streaming）时提示仍在：等待没结束，这句话就还成立', () => {
    const html = render('streaming', { primary: PRIMARY, matchedViaNeighbor: true, candidateCount: 4 })
    expect(html).toContain('这一季的真题里没有直接问它的')
  })

  test('正常召回：等待卡里没有任何前置提示（保持现状）', () => {
    const html = render('waiting', { primary: PRIMARY, matchedViaNeighbor: false, candidateCount: 8 })
    expect(html).not.toContain('这一季的真题')
    // 进度条与分阶段文案照常
    expect(html).toContain('正在读你的故事…')
  })

  test('?stream=0 降级路（无 meta 帧）：不提示、不崩', () => {
    expect(() => render('waiting', null)).not.toThrow()
    expect(render('waiting', null)).not.toContain('这一季的真题')
  })

  test('定稿态（result）不渲染前置提示：卡里换成结果说明，等待期的话不许留在屏幕上', () => {
    const html = render('result', { primary: PRIMARY, matchedViaNeighbor: true, candidateCount: 4 })
    expect(html).not.toContain('这一季的真题里没有直接问它的')
  })
})
