/**
 * @module   dashboard/CostCards
 * @desc     看板三张费用卡片 — 累计 / 本月 / 今日，顶部彩条 + 金额 + 副信息
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { formatCnyNumber } from '@/lib/format-cost'

// USD 副行汇率：写死估算值，非实时汇率。展示时统一带"≈"并在卡区下方标脚注（见 page.tsx）。
const USD_RATE = 7.2

type CostCardData = {
  allTimeCost: number; allTimeCalls: number
  monthCost: number;  monthCalls: number; monthChange: number | null
  todayCost:  number; todayCalls: number
}

// 副信息语气：up=费用环比上涨（暖色/警示，不用安抚绿），down=下跌（绿），neutral=中性说明
type SubTone = 'up' | 'down' | 'neutral'
type Sub = { text: string; tone: SubTone }

const CARDS: Array<{
  key: string; icon: string; accent: string
  getLabel: () => string
  getCost: (d: CostCardData) => number
  getSub: (d: CostCardData) => Sub
}> = [
  {
    key: 'allTime', icon: '📊', accent: '#D4875A',
    getLabel: () => '累计总花费',
    getCost:  (d: CostCardData) => d.allTimeCost,
    getSub:   (d: CostCardData) => ({ text: `共 ${d.allTimeCalls} 次调用`, tone: 'neutral' }),
  },
  {
    key: 'month', icon: '📅', accent: '#7BA699',
    getLabel: () => `${new Date().getMonth() + 1}月花费`,
    getCost:  (d: CostCardData) => d.monthCost,
    getSub:   (d: CostCardData): Sub =>
      d.monthChange !== null
        ? d.monthChange >= 0
          ? { text: `↑ 环比 ${Math.abs(d.monthChange)}%`, tone: 'up' }
          : { text: `↓ 环比 ${Math.abs(d.monthChange)}%`, tone: 'down' }
        : { text: `共 ${d.monthCalls} 次调用`, tone: 'neutral' },
  },
  {
    key: 'today', icon: '⚡', accent: '#9A7DB8',
    getLabel: () => '今日花费',
    getCost:  (d: CostCardData) => d.todayCost,
    getSub:   (d: CostCardData) => ({ text: `共 ${d.todayCalls} 次调用`, tone: 'neutral' }),
  },
]

// 语气 → 文字色：涨费用用警示暖色（warning-text，达 AA），跌用绿（success 深化），中性用次级文字色
const SUB_TONE_CLASS: Record<SubTone, string> = {
  up:      'text-warning-text',
  down:    'text-brand-accent-dark',
  neutral: 'text-v2-text-secondary',
}

/**
 * 三张横排费用卡片
 * @param data  dashboard API 返回的费用字段子集
 */
export default function CostCards({ data }: { data: CostCardData }) {
  return (
    <div className="flex gap-2.5 flex-wrap">
      {CARDS.map(card => {
        const cost = card.getCost(data)
        const sub  = card.getSub(data)
        return (
          <div key={card.key} className="flex-1 min-w-[140px] bg-white rounded-[18px] border border-black/[0.05] overflow-hidden">
            <div className="h-[3px]" style={{ backgroundColor: card.accent, opacity: 0.6 }} />
            <div className="px-4 pt-3 pb-4">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[14px]">{card.icon}</span>
                <span className="text-[11px] text-v2-text-muted">{card.getLabel()}</span>
              </div>
              <div className="text-[26px] font-bold text-v2-text-primary leading-tight">
                ¥{formatCnyNumber(cost)}
              </div>
              {/* USD 副行为估算：带"≈"避免误读为精确换算，汇率脚注见卡区下方 */}
              <div className="text-[11px] text-v2-text-muted mt-0.5">
                ≈ ${(cost / USD_RATE).toFixed(2)}
              </div>
              {/* 副行改用语气色承载：涨费用警示暖色、跌费用绿（不再用安抚绿弱化涨的警示） */}
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: card.accent }} />
                <span className={`text-[11px] font-medium ${SUB_TONE_CLASS[sub.tone]}`}>{sub.text}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
