/**
 * @module   dashboard/CostCards
 * @desc     看板三张费用卡片 — 累计 / 本月 / 今日，顶部彩条 + 金额 + 副信息。
 *           2026-08-04 瘦身（方案 §六）：删 USD 副行与汇率换算（估算汇率的假精度）；
 *           月环比降为中性小字（内测费用基数极小，环比涨跌是噪音、不值得警示色）。
 * @author   LingoBridge
 * @created  2026-06-04
 */
import { formatCnyNumber } from '@/lib/format-cost'

type CostCardData = {
  allTimeCost: number; allTimeCalls: number
  monthCost: number;  monthCalls: number; monthChange: number | null; monthLabel: string
  todayCost:  number; todayCalls: number
}

const CARDS: Array<{
  key: string; icon: string; accent: string
  getLabel: (d: CostCardData) => string
  /** 时间范围标注：说清这张卡数的是哪段时间（消「饼图=近N天区间」与费用卡口径混淆） */
  range: string
  getCost: (d: CostCardData) => number
  getSub: (d: CostCardData) => string
}> = [
  {
    key: 'allTime', icon: '📊', accent: '#D4875A',
    getLabel: () => '累计总花费',
    range: '全部历史',
    getCost:  (d: CostCardData) => d.allTimeCost,
    getSub:   (d: CostCardData) => `共 ${d.allTimeCalls} 次调用`,
  },
  {
    key: 'month', icon: '📅', accent: '#7BA699',
    // 标签用服务端东八区月份（d.monthLabel），不用客户端 new Date()——见 route.ts monthLabel 注释
    getLabel: (d: CostCardData) => `${d.monthLabel}花费`,
    range: '本月 1 日至今 · 东八区',
    getCost:  (d: CostCardData) => d.monthCost,
    // 月环比中性小字：涨跌都不上色（基数极小时环比是噪音，警示交给结论条的成本判定）
    getSub:   (d: CostCardData) =>
      d.monthChange !== null
        ? `环比上月 ${d.monthChange >= 0 ? '+' : ''}${d.monthChange}%`
        : `共 ${d.monthCalls} 次调用`,
  },
  {
    key: 'today', icon: '⚡', accent: '#9A7DB8',
    getLabel: () => '今日花费',
    range: '今日 · 东八区',
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
        const sub  = card.getSub(data)
        return (
          <div key={card.key} className="flex-1 min-w-[140px] bg-white rounded-[18px] border border-black/[0.05] overflow-hidden">
            <div className="h-[3px]" style={{ backgroundColor: card.accent, opacity: 0.6 }} />
            <div className="px-4 pt-3 pb-4">
              <div className="flex items-center gap-1.5 mb-2">
                {/* 纯装饰 emoji：读屏会把它念成"条形图"之类的名字，对旁边的卡片标签是纯干扰 */}
                <span className="text-[0.875rem]" aria-hidden="true">{card.icon}</span>
                <span className="text-[0.6875rem] text-v2-text-muted">{card.getLabel(data)}</span>
              </div>
              <div className="text-[1.625rem] font-bold text-v2-text-primary leading-tight">
                ¥{formatCnyNumber(cost)}
              </div>
              {/* 副行统一中性小字（月环比不再上警示色，费用异常由结论条判定承担） */}
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: card.accent }} />
                <span className="text-[0.6875rem] text-v2-text-secondary">{sub}</span>
              </div>
              {/* 时间范围标注：三张卡口径各不同（全部历史 / 本月 / 今日），与下方饼图·趋势的「近 N 天区间」不是一回事，逐卡标清防混淆 */}
              <div className="text-[0.625rem] text-v2-text-muted mt-1.5">{card.range}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
