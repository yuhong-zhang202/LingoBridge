/**
 * @module   dashboard/HeroMetrics
 * @desc     看板首屏 Hero 四数卡 —— 创始人「一眼非常清晰」的今日经营北极星。
 *           ① 今日活跃（注册，主卡跨 2 列）② 练习场次 ③ 故障两态 ④ 成本。
 *           全为【今日日历口径】，不随下方 Tier2 区间选择器变。
 *           顶部彩条 / 圆角 / emoji-aria-hidden 照搬 CostCards 语言；匿名绝不与注册相加。
 * @author   LingoBridge
 * @created  2026-07-25
 */
import { formatCny } from '@/lib/format-cost'

type HeroData = {
  registeredActiveToday: number
  anonSessionsToday: number
  practiceNew: number
  practiceReview: number
  practiceTotal: number
  todayFailuresByPhase: Array<{ phase: string; count: number }>
  todayFailuresTotal: number
  emptyRecordingToday: number
  todayCost: number
  avgDailyCost7: number
  dailyBudget: number
}

// 顶部彩条色值：沿用 CostCards 的内联 accent 写法（recharts/装饰条既有模式），非页面级背景，不违反禁令。
const BAR_PRIMARY = '#D4875A'   // brand-primary
const BAR_ACCENT  = '#7BA699'   // brand-accent
const BAR_COST    = '#9A7DB8'   // 今日成本（与 CostCards 今日卡同色）
const BAR_OK      = '#5BA08A'   // success
const BAR_ERROR   = '#AB5344'   // error

/** 卡片顶部 3px 彩条（照搬 CostCards：内联色值 + opacity 0.6） */
function TopBar({ color }: { color: string }) {
  return <div className="h-[3px]" style={{ backgroundColor: color, opacity: 0.6 }} />
}

/**
 * 首屏 Hero 四数卡
 * @param data  今日经营口径字段子集（活跃/匿名/练习/故障/成本）
 */
export default function HeroMetrics({ data }: { data: HeroData }) {
  const hasFailure = data.todayFailuresTotal > 0
  const topPhase   = data.todayFailuresByPhase[0]?.phase ?? '未知环节'
  // 成本告警：超日预算参照线（绝对过高）或超近 7 日均值 2 倍（突增），与 TodayStatusBar 同口径
  const costWarn = data.todayCost > data.dailyBudget
    || (data.avgDailyCost7 > 0 && data.todayCost > data.avgDailyCost7 * 2)

  return (
    <section aria-label="今日经营总览" className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-5">
      {/* ① 今日活跃（注册）—— 北极星，跨 2 列 */}
      <div className="md:col-span-2 bg-white rounded-[16px] border border-black/[0.05] overflow-hidden">
        <TopBar color={BAR_PRIMARY} />
        <div className="px-5 pt-3 pb-4">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[0.875rem]" aria-hidden="true">🧑‍💻</span>
            <span className="text-[0.6875rem] text-v2-text-muted">今日核心活跃 · 注册用户</span>
          </div>
          <div className="text-[2.5rem] md:text-[2.75rem] font-bold text-v2-text-primary leading-none tabular-nums">
            {data.registeredActiveToday}
          </div>
          {/* 匿名副行：去重身份（匿名 user_id 按设备持久去重，非唯一真人），绝不与注册相加。为 0 时整行隐藏 */}
          {data.anonSessionsToday > 0 && (
            <div className="flex items-center gap-1.5 mt-2.5">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-neutral-mid" />
              <span className="text-[0.75rem] text-v2-text-muted">
                另有匿名试用 {data.anonSessionsToday} · 去重身份 · 按设备持久 · 非唯一真人
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ② 练习场次 */}
      <div className="md:col-span-1 bg-white rounded-[16px] border border-black/[0.05] overflow-hidden">
        <TopBar color={BAR_ACCENT} />
        <div className="px-4 pt-3 pb-4">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[0.875rem]" aria-hidden="true">🎯</span>
            <span className="text-[0.6875rem] text-v2-text-muted">今日练习场次</span>
          </div>
          <div className="text-[1.75rem] font-bold text-v2-text-primary leading-none tabular-nums">
            {data.practiceTotal}
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-brand-primary" />
              <span className="text-[0.6875rem] text-v2-text-secondary tabular-nums">新练 {data.practiceNew}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-brand-accent" />
              <span className="text-[0.6875rem] text-v2-text-secondary tabular-nums">复练 {data.practiceReview}</span>
            </span>
          </div>
        </div>
      </div>

      {/* ③ 今日故障（两态）：状态不只靠色，必带文字 + aria-label */}
      <div
        aria-label={hasFailure
          ? `今日故障：共 ${data.todayFailuresTotal} 次，卡在${topPhase}；另有空录音 ${data.emptyRecordingToday} 次（不算故障）`
          : `今日故障：无故障；另有空录音 ${data.emptyRecordingToday} 次（不算故障）`}
        className={`md:col-span-1 rounded-[16px] border overflow-hidden ${hasFailure ? 'bg-error/[0.06] border-error/20' : 'bg-white border-black/[0.05]'}`}
      >
        <TopBar color={hasFailure ? BAR_ERROR : BAR_OK} />
        <div className="px-4 pt-3 pb-4">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[0.875rem]" aria-hidden="true">{hasFailure ? '🚨' : '✅'}</span>
            <span className="text-[0.6875rem] text-v2-text-muted">今日故障</span>
          </div>
          {hasFailure ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0 bg-error self-center" />
                <span className="text-[1.75rem] font-bold text-error leading-none tabular-nums">{data.todayFailuresTotal}</span>
                <span className="text-[0.75rem] text-error font-medium">卡在{topPhase}</span>
              </div>
              <div className="text-[0.6875rem] text-v2-text-muted mt-2">空录音 {data.emptyRecordingToday} 次 · 不算故障</div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0 bg-success" />
                <span className="text-[1.125rem] font-bold text-v2-text-primary">今日无故障</span>
              </div>
              <div className="text-[0.6875rem] text-v2-text-muted mt-2">空录音 {data.emptyRecordingToday} 次 · 不算故障</div>
            </>
          )}
        </div>
      </div>

      {/* ④ 今日成本 */}
      <div className="md:col-span-1 bg-white rounded-[16px] border border-black/[0.05] overflow-hidden">
        <TopBar color={BAR_COST} />
        <div className="px-4 pt-3 pb-4">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[0.875rem]" aria-hidden="true">💰</span>
            <span className="text-[0.6875rem] text-v2-text-muted">今日成本</span>
          </div>
          <div className={`text-[1.75rem] font-bold leading-none tabular-nums ${costWarn ? 'text-warning-text' : 'text-v2-text-primary'}`}>
            {formatCny(data.todayCost)}
          </div>
          <div className="text-[0.6875rem] text-v2-text-muted mt-2">
            近7日均 {formatCny(data.avgDailyCost7)} · 预算¥{data.dailyBudget}
          </div>
        </div>
      </div>
    </section>
  )
}
