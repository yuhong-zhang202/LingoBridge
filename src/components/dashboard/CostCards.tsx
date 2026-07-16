/**
 * @module   dashboard/CostCards
 * @desc     看板三张费用卡片 — 累计 / 本月 / 今日，顶部彩条 + 金额 + 副信息
 * @author   LingoBridge
 * @created  2026-06-04
 */

type CostCardData = {
  allTimeCost: number; allTimeCalls: number
  monthCost: number;  monthCalls: number; monthChange: number | null
  todayCost:  number; todayCalls: number
}

const CARDS = [
  {
    key: 'allTime', icon: '📊', accent: '#D4875A',
    getLabel: () => '累计总花费',
    getCost:  (d: CostCardData) => d.allTimeCost,
    getSub:   (d: CostCardData) => `共 ${d.allTimeCalls} 次调用`,
  },
  {
    key: 'month', icon: '📅', accent: '#7BA699',
    getLabel: () => `${new Date().getMonth() + 1}月花费`,
    getCost:  (d: CostCardData) => d.monthCost,
    getSub:   (d: CostCardData) =>
      d.monthChange !== null
        ? `${d.monthChange >= 0 ? '↑' : '↓'} 环比 ${Math.abs(d.monthChange)}%`
        : `共 ${d.monthCalls} 次调用`,
  },
  {
    key: 'today', icon: '⚡', accent: '#9A7DB8',
    getLabel: () => '今日花费',
    getCost:  (d: CostCardData) => d.todayCost,
    getSub:   (d: CostCardData) => `共 ${d.todayCalls} 次调用`,
  },
]

/**
 * 三张横排费用卡片
 * @param data  dashboard API 返回的费用字段子集
 */
export default function CostCards({ data }: { data: CostCardData }) {
  return (
    <div className="flex gap-2.5 flex-wrap">
      {CARDS.map(card => {
        const cost = card.getCost(data)
        return (
          <div key={card.key} className="flex-1 min-w-[140px] bg-white rounded-[18px] border border-black/[0.05] overflow-hidden">
            <div className="h-[3px]" style={{ backgroundColor: card.accent, opacity: 0.6 }} />
            <div className="px-4 pt-3 pb-4">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[14px]">{card.icon}</span>
                <span className="text-[11px] text-v2-text-muted">{card.getLabel()}</span>
              </div>
              <div className="text-[26px] font-bold text-v2-text-primary leading-tight">
                ¥{cost.toFixed(2)}
              </div>
              <div className="text-[11px] text-v2-text-muted mt-0.5">
                ${(cost / 7.2).toFixed(4)}
              </div>
              <div className="text-[11px] mt-1.5" style={{ color: card.accent }}>
                {card.getSub(data)}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
