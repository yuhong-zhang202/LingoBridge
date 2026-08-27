/**
 * @module   matching/relevance-section-title.test
 * @desc     详情卡「理由区」标题与右上角档位徽标的守卫 —— 钉住产品方拍板的用户可见文案。
 *
 *   【为什么补这组】这条改动（低相关档标题由「这道题和你的语料差在哪」→「不够贴合」，
 *   同时右上角同名徽标不再渲染）上线时**零测试覆盖**，红队在事后审计里点名：
 *   全仓搜这三句文案，`__tests__` 下零命中 —— 谁改回去都没人知道。
 *
 *   【钉的是什么】三条产品判断，不是实现细节：
 *     · 低相关档不许说「为什么这道题适合你」—— 那是句谎话，这道题恰恰不适合；
 *     · high / mid / 未打分档使用中性的「说明」标题；
 *     · 同一句判断不许在一屏里出现两次（右上角徽标 + 下方标题）。
 *   所以除了正向断言，还有一条**反向**断言：low 档下那句谎话一个字都不许出现。
 *   只钉正向的话，"两句都显示" 这种改法照样能通过。
 *
 * @author   LingoBridge
 * @created  2026-08-15
 */
import { relevanceSectionTitle, shouldShowTierBadge, type Tier } from '@/app/matching/MatchingDesktop'

describe('relevanceSectionTitle · 理由区标题按档切', () => {
  it('低相关档说「不够贴合」，不说「为什么这道题适合你」', () => {
    expect(relevanceSectionTitle('low')).toBe('不够贴合')
  })

  it('【反向】低相关档下，那句谎话一个字都不出现', () => {
    const title = relevanceSectionTitle('low')
    for (const forbidden of ['适合', '为什么这道题', '差在哪']) {
      expect(title).not.toContain(forbidden)
    }
  })

  it('high / mid 使用中性的「说明」标题', () => {
    expect(relevanceSectionTitle('high')).toBe('说明')
    expect(relevanceSectionTitle('mid')).toBe('说明')
  })

  it('未打分（降级态）使用中性的「说明」标题', () => {
    expect(relevanceSectionTitle(null)).toBe('说明')
  })
})

describe('shouldShowTierBadge · 右上角档位徽标', () => {
  it('low 不渲染徽标：与下方标题重复，同一句判断不说两遍', () => {
    expect(shouldShowTierBadge('low')).toBe(false)
  })

  it('未打分不渲染徽标：降级态下标任何档都是在编', () => {
    expect(shouldShowTierBadge(null)).toBe(false)
  })

  it('high / mid 照常渲染：那两档的徽标是正向信息，不与标题重复', () => {
    expect(shouldShowTierBadge('high')).toBe(true)
    expect(shouldShowTierBadge('mid')).toBe(true)
  })

  it('【不变式】徽标与「不够贴合」标题恒不同时出现 —— 遍历全部档位穷举', () => {
    const all: (Tier | null)[] = ['high', 'mid', 'low', null]
    for (const tier of all) {
      const badgeShown = shouldShowTierBadge(tier)
      const titleSaysLow = relevanceSectionTitle(tier) === '不够贴合'
      expect(badgeShown && titleSaysLow).toBe(false)
    }
  })
})
