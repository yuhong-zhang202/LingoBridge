/**
 * @module   dashboard/HeroMetrics
 * @desc     看板首屏 Hero 三卡（方案 §三，产品方拍板优先级：注册 → 活跃 → 练习）——
 *           今日新增注册 / 今日核心活跃 / 今日练习场次，等宽三卡、主数字同字号（无跨列主卡）。
 *           全为【今日日历口径】，不随下方区间选择器变。顶部 3px 彩条与参与度趋势三线同色编码
 *           （注册紫 / 活跃橙 / 练习绿），扫一眼卡、再看趋势线，颜色能对上号。
 *           原四卡的「计费失败」「成本」两卡撤出：失败由结论条第一 chip + ①区数据驱动展开承接，
 *           成本由结论条黄灯 chip + 钱区 summary 常驻数字承接（去向逐条钉死，见方案 §三表）。
 * @author   LingoBridge
 * @created  2026-07-25
 */

type HeroData = {
  newRegistrationsToday: number
  /** true = 真注册 RPC 未接入、计数为 profiles 降级值（含匿名·虚高），副行走降级文案 */
  newRegistrationsPending: boolean
  registeredActiveToday: number
  anonSessionsToday: number
  practiceNew: number
  practiceReview: number
  practiceTotal: number
}

// 顶部彩条色值：与 EngagementTrendChart 三线同色编码（recharts/装饰条既有内联写法，非页面级背景，不违反禁令）。
const BAR_REG      = '#9A7DB8'   // 注册 = band-70 品牌紫（同趋势图新增注册线）
const BAR_ACTIVE   = '#D4875A'   // 活跃 = brand-primary（同趋势图活跃线）
const BAR_PRACTICE = '#7BA699'   // 练习 = brand-accent（同趋势图练习场次线）

/** 卡片顶部 3px 彩条（沿用 CostCards 内联色值 + opacity 0.6 的既有模式） */
function TopBar({ color }: { color: string }) {
  return <div className="h-[3px]" style={{ backgroundColor: color, opacity: 0.6 }} />
}

/** 三卡统一主数字（等重，无跨列主卡）：text-[2.5rem] font-bold tabular-nums leading-none */
function HeroNumber({ value }: { value: number }) {
  return (
    <div className="text-[2.5rem] font-bold text-v2-text-primary leading-none tabular-nums">{value}</div>
  )
}

/**
 * 首屏 Hero 三数卡（今日新增注册 / 今日核心活跃 / 今日练习场次）
 * @param data  今日经营口径字段子集
 */
export default function HeroMetrics({ data }: { data: HeroData }) {
  return (
    <section aria-label="今日经营总览" className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
      {/* ① 今日新增注册（两态口径文案：RPC 可用 = 真注册；降级 = profiles 计数、含匿名，照实标注） */}
      <div className="bg-white rounded-[16px] border border-black/[0.05] overflow-hidden">
        <TopBar color={BAR_REG} />
        <div className="px-5 pt-3 pb-4">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[0.875rem]" aria-hidden="true">🌱</span>
            <span className="text-[0.6875rem] text-v2-text-muted">今日新增注册</span>
          </div>
          <HeroNumber value={data.newRegistrationsToday} />
          <div className="text-[0.625rem] text-v2-text-muted mt-2">
            {data.newRegistrationsPending
              ? '含匿名·待迁移生效（RPC 未接入，暂用 profiles 计数）'
              : '只计真注册（非匿名·有邮箱），东八区'}
          </div>
        </div>
      </div>

      {/* ② 今日核心活跃（注册用户）；匿名副行为 0 时整行隐藏，匿名绝不与注册相加 */}
      <div className="bg-white rounded-[16px] border border-black/[0.05] overflow-hidden">
        <TopBar color={BAR_ACTIVE} />
        <div className="px-5 pt-3 pb-4">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[0.875rem]" aria-hidden="true">🧑‍💻</span>
            <span className="text-[0.6875rem] text-v2-text-muted">今日核心活跃 · 注册用户</span>
          </div>
          <HeroNumber value={data.registeredActiveToday} />
          {/* 匿名副行：去重身份（匿名 user_id 按设备持久去重，非唯一真人） */}
          {data.anonSessionsToday > 0 && (
            <div className="flex items-center gap-1.5 mt-2">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-neutral-mid" />
              <span className="text-[0.75rem] text-v2-text-muted">
                另有匿名试用 {data.anonSessionsToday} · 去重身份 · 按设备持久 · 非唯一真人
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ③ 今日练习场次（新练 / 复练双色点副行） */}
      <div className="bg-white rounded-[16px] border border-black/[0.05] overflow-hidden">
        <TopBar color={BAR_PRACTICE} />
        <div className="px-5 pt-3 pb-4">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[0.875rem]" aria-hidden="true">🎯</span>
            <span className="text-[0.6875rem] text-v2-text-muted">今日练习场次</span>
          </div>
          <HeroNumber value={data.practiceTotal} />
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
    </section>
  )
}
