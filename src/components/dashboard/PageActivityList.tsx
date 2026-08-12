'use client'
/**
 * @module   dashboard/PageActivityList
 * @desc     「哪些页面被用得多」（方案 §四）—— 窗口内 page.view 按 route 聚合：
 *           打开次数横条（与环节成本条同范式）+「用过的人」user_id 去重副列。
 *           【防 UV 误读是本块第一要求】：列名叫「打开次数」；「用过的人」并列副列；
 *           首页行【内联】标注系统性偏低（未建会话的新访客不上报，不放脚注里藏着）。
 *           数据不足降级：窗口 0 行 → 虚线占位框；有数但埋点未满 7 天 → 顶部常驻事实陈述行（muted 非告警色）。
 *           默认列前 8，其余收进「展开全部 N 个页面」（<details> 默认收起、非受控）。
 *           类型与 lib/db/dashboard-metrics 的 PageViewStat 手工对齐（server-only 模块不进客户端）。
 *           2026-08-12 增：truncated=true（取数触顶）时在列表上方常驻警示行，明说次数/人数【偏低】。
 * @author   LingoBridge
 * @created  2026-08-04
 */

/** 单页面统计（与 dashboard-metrics.PageViewStat 一致） */
export type PageViewStat = { route: string; views: number; users: number }

/** 页面浏览埋点上线日（东八区）：满 7 天前顶部常驻「积累 N 天」事实陈述行 */
const PAGE_VIEW_LAUNCH = '2026-08-03'
const PAGE_VIEW_LAUNCH_TS = Date.parse('2026-08-02T16:00:00.000Z')   // 东八区 08-03 00:00
const DAY_MS = 24 * 60 * 60 * 1000

/** route 枚举 code → 中文页面名（与 lib/page-route 的 PAGE_ROUTE 白名单一一对应；未知 code 原样显示不吞） */
const ROUTE_LABEL: Record<string, string> = {
  home:              '首页',
  write:             '文字输入',
  recording:         '录音',
  restructure:       '语料整理',
  matching:          '匹配结果',
  practice_question: '题目练习页',
  analysis:          '侧重点分析',
  practice:          '练习对话',
  question_bank:     '题库',
  library:           '素材库',
  review:            '复习',
  anki_review:       '闪卡复习',
  profile:           '我的',
  settings:          '设置',
  login:             '登录',
  reset_password:    '重置密码',
  about:             '关于',
  privacy:           '隐私政策',
  privacy_beta:      '内测隐私说明',
  feedback:          '练习反馈',
  dashboard:         '经营看板',
  other:             '其他（未登记页面）',
}

/** 默认露出的行数，其余收进「展开全部」 */
const TOP_N = 8

/** 一行页面统计：中文名（首页带内联偏低标注）+ 归一化横条 + 打开次数 + 用过的人 */
function PageRow({ stat, max }: { stat: PageViewStat; max: number }) {
  const label = ROUTE_LABEL[stat.route] ?? stat.route
  return (
    <div className="flex items-center gap-3">
      <span className="text-[0.6875rem] text-v2-text-secondary w-32 flex-shrink-0 truncate">
        {label}
        {/* 首页行内联标注（不放脚注）：未建会话的新访客不上报，这行系统性偏低 */}
        {stat.route === 'home' && <span className="text-v2-text-muted">（此行系统性偏低*）</span>}
      </span>
      <div className="flex-1 h-2 bg-black/[0.04] rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-brand-accent/70"
          style={{ width: `${max > 0 ? (stat.views / max) * 100 : 0}%` }} />
      </div>
      <span className="text-[0.6875rem] font-medium text-v2-text-primary w-12 text-right flex-shrink-0 tabular-nums">{stat.views}</span>
      <span className="text-[0.625rem] text-v2-text-muted w-12 text-right flex-shrink-0 tabular-nums">{stat.users} 人</span>
    </div>
  )
}

/**
 * 取数触顶提示（样式逐字照抄 FlowHealthBlocks 的 TruncatedAlert：role="alert" + 11px 错误色）。
 * 【必须说方向】分页按时间升序、被截掉的永远是最新那批 → 恒定偏低，绝不会偏高；
 * 只说「数据不全」会让人以为两个方向都有可能，进而把「某页面在降温」当成真事。
 */
function TruncatedNotice() {
  return (
    <div role="alert" className="text-[0.6875rem] text-error mb-2 leading-relaxed">
      {/* 整句写成一行：JSX 里换行会被折成一个空格，中文标点后跟空格很难看 */}
      <span aria-hidden="true">⚠️</span> 取数触顶：最新那批数据被丢弃，下列打开次数与人数【均偏低】（不会偏高），页面之间的排序也可能因此失真。
    </div>
  )
}

/**
 * 页面活跃列表
 * @param stats       /api/dashboard 的 pageViewStats 字段；null = 读取失败降级
 * @param truncated   /api/dashboard 的 pageViewsTruncated：true = 取数触顶、次数与人数均偏低
 * @param windowDays  当前区间天数（口径小字用）
 */
export default function PageActivityList({ stats, truncated, windowDays }: {
  stats: PageViewStat[] | null; truncated: boolean; windowDays: number
}) {
  // 埋点积累天数（东八区，含上线当天）：满 7 天后事实陈述行自动消失
  const daysCollected = Math.floor((Date.now() - PAGE_VIEW_LAUNCH_TS) / DAY_MS) + 1
  const max = stats?.reduce((m, s) => Math.max(m, s.views), 0) ?? 0
  const head = stats?.slice(0, TOP_N) ?? []
  const rest = stats?.slice(TOP_N) ?? []

  return (
    <section aria-label="哪些页面被用得多" className="bg-white rounded-[16px] border border-black/[0.05] p-4 mt-4">
      <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary">哪些页面被用得多</h2>
        <span className="text-[0.6875rem] text-v2-text-muted">近 {windowDays} 天 · 打开次数 / 用过的人</span>
      </div>

      {/* 触顶提示放在列表【之前】：数字的可信度是读列表的前提，放脚注里等于没说 */}
      {truncated && <TruncatedNotice />}

      {stats == null && (
        <div className="text-v2-text-muted text-[0.75rem] py-4 text-center">页面浏览数据暂时读取失败，刷新页面重试。</div>
      )}

      {stats != null && stats.length === 0 && (
        /* 窗口 0 行降级：虚线占位（与看板既有 PendingPlaceholder 同视觉），不硬编错数 */
        <div className="bg-black/[0.02] rounded-[12px] border border-dashed border-black/[0.1] px-4 py-3">
          <div className="text-[0.625rem] text-v2-text-muted leading-relaxed">
            页面浏览埋点 {PAGE_VIEW_LAUNCH} 上线，本窗口暂无数据。
          </div>
        </div>
      )}

      {stats != null && stats.length > 0 && (<>
        {/* 埋点未满 7 天：常驻事实陈述行（muted 非告警色），满 7 天自动消失 */}
        {daysCollected < 7 && (
          <div className="text-[0.625rem] text-v2-text-muted mb-2 leading-relaxed">
            页面浏览埋点自 {PAGE_VIEW_LAUNCH} 上线，现仅积累 {daysCollected} 天，方向参考、别当结论。
          </div>
        )}
        <div className="space-y-2">
          {head.map(s => <PageRow key={s.route} stat={s} max={max} />)}
        </div>
        {rest.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer list-none text-[0.6875rem] text-v2-text-muted min-h-[44px] flex items-center select-none">
              展开全部 {stats.length} 个页面
            </summary>
            <div className="space-y-2 mt-1">
              {rest.map(s => <PageRow key={s.route} stat={s} max={max} />)}
            </div>
          </details>
        )}
        {/* 防 UV 误读脚注：打开次数 ≠ 人数；首页缺口的去处（新访客量看注册数） */}
        <div className="text-[0.625rem] text-v2-text-muted mt-3 leading-relaxed">
          * 打开次数 = 页面加载次数，刷新 / 多开会重复计，不是访问人数；「用过的人」才是去重人数。<br />
          * 首页对未建会话的新访客不上报，该行偏低；新访客量看注册数。已剔除自测流量与内部账户。
        </div>
        {/* 读屏兜底数据表：横条与数字是 div 排版，语义上不成表（同页图表既有标准） */}
        <table className="sr-only">
          <caption>各页面打开次数与用过的人（近 {windowDays} 天，已剔除自测与内部账户）</caption>
          <thead>
            <tr><th scope="col">页面</th><th scope="col">打开次数</th><th scope="col">用过的人</th></tr>
          </thead>
          <tbody>
            {stats.map(s => (
              <tr key={s.route}>
                <th scope="row">{ROUTE_LABEL[s.route] ?? s.route}</th>
                <td>{s.views}</td>
                <td>{s.users}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>)}
    </section>
  )
}
