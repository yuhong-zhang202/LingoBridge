'use client'
/**
 * @module   dashboard/FunnelFootnotes
 * @desc     挂在七步漏斗下面的两块注脚，拆成两个导出（它们回答的是不同的问题）：
 *             · <FunnelQualityNotes>  「走到这一步的人，体验到的是什么」—— 只浏览未动手 /
 *                                      匹配质量 / 出题与停留 / 反馈卡；
 *             · <QuotaWallBlock>      「撞上试用额度墙的人后来怎么了」（撞墙窗口 30 天、观察期 7 天，
 *                                      两个口径都不随看板区间变）。
 *
 *   【空态一律写成人话，不摆一片 0】额度墙当前真实值是 wallUsers=0 —— 一屏 0% 会被读成
 *   「转化率 0%、劝退率 0%」，而真相是【没有人撞过墙】。同 CohortReturnTable 的 PendingCell
 *   「绝不显 0 冒充流失」。
 *
 * @author   LingoBridge
 * @created  2026-08-15
 */
import type { ReactNode } from 'react'
import type { GrowthState, GrowthFunnelResponse } from '@/hooks/useGrowthMetrics'

/** 注脚区的小节壳（沿用同页 CohortReturnTable / FlowHealthBlocks 的卡片范式，不另造视觉） */
function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="bg-white rounded-[16px] border border-black/[0.05] p-4 mt-3">
      <h2 className="text-[0.8125rem] font-semibold text-v2-text-primary mb-2">{label}</h2>
      {children}
    </section>
  )
}

/** 一条注脚行：左标题 + 右内容，10-11px，与漏斗表同一层级的信息密度 */
function Line({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="text-[0.6875rem] text-v2-text-secondary leading-relaxed mb-1.5">
      <span className="text-v2-text-muted">{title}：</span>
      {children}
    </div>
  )
}

/** 口径小字（10px muted，同漏斗段 FunnelNote 的字号色） */
function Note({ children }: { children: ReactNode }) {
  return <div className="text-[0.625rem] text-v2-text-muted leading-relaxed mt-1">{children}</div>
}

/**
 * 取数触顶提示（措辞与 CohortReturnTable 的 TruncatedNotice 同源：必须说【偏低】这个方向，
 * 只讲「数据不全」会让人以为可能偏高也可能偏低）。
 */
function TruncatedNotice() {
  return (
    <div role="alert" className="text-[0.6875rem] text-error mb-2 leading-relaxed">
      <span aria-hidden="true">⚠️</span> 取数触顶：最新那批事件被丢弃，本块的次数与人数【均偏低】（不会偏高）。
    </div>
  )
}

/**
 * 漏斗质量注脚：只浏览未动手 + 匹配质量 + 出题停留 + 反馈卡。
 * @param state  /api/dashboard/growth/funnel 的三态
 */
export function FunnelQualityNotes({ state }: { state: GrowthState<GrowthFunnelResponse> }) {
  const res = state.data
  const q = res?.quality ?? null
  const b = res?.browseOnly ?? null
  const dwell = q?.question.dwellMedianMs

  return (
    <Block label="走到这一步的人，体验到的是什么">
      {state.loading && !res && <div className="text-v2-text-muted text-[0.75rem] py-2">加载中…</div>}
      {state.error && <div className="text-v2-text-muted text-[0.75rem] py-2">注脚数据暂时读取失败，刷新页面重试。</div>}
      {q?.truncated === true && <TruncatedNotice />}

      {res?.browseOnlyPending === true ? (
        <Line title="只浏览未动手">
          <span className="text-v2-text-muted">RPC（get_funnel_browse_only）尚未接入，待跑迁移 0064 后自动显示。</span>
        </Line>
      ) : b && (
        <>
          <Line title="只浏览未动手">
            窗口内有页面浏览的注册用户 <span className="tabular-nums font-medium text-v2-text-primary">{b.pageViewUsers}</span> 人 ·
            其中核心活跃 <span className="tabular-nums font-medium text-v2-text-primary">{b.coreActiveUsers}</span> 人 ·
            来看了但一件事都没做 <span className="tabular-nums font-medium text-v2-text-primary">{b.browseOnlyUsers}</span> 人
          </Line>
          <Note>「只浏览未动手」是同一批注册用户的真集合差（SQL 的 except），不是把上面两个人数相减。</Note>
        </>
      )}

      {res?.qualityPending === true ? (
        <Line title="匹配质量 / 出题停留 / 反馈卡">
          <span className="text-v2-text-muted">埋点聚合暂不可用（查询失败或迁移未跑），恢复后自动显示。</span>
        </Line>
      ) : q && (
        <>
          <Line title="匹配质量">
            {q.match.rendered === 0
              ? <span className="text-v2-text-muted">本期没有一次匹配结果渲染</span>
              : (<>
                  出过匹配结果 <span className="tabular-nums font-medium text-v2-text-primary">{q.match.rendered}</span> 次 ·
                  一道都没匹配上 <span className="tabular-nums font-medium text-v2-text-primary">{q.match.noMatch}</span> 次
                  {q.match.noMatchRate !== null && <span className="text-v2-text-muted">（{q.match.noMatchRate}%）</span>}
                </>)}
          </Line>
          <Line title="出题与停留">
            共出题 <span className="tabular-nums font-medium text-v2-text-primary">{q.question.candidateTotal}</span> 道 ·
            点开 <span className="tabular-nums font-medium text-v2-text-primary">{q.question.opened}</span> 次 ·
            点开前停留中位数 {dwell == null
              ? <span className="text-v2-text-muted">暂无带停留时长的样本</span>
              : <span className="tabular-nums font-medium text-v2-text-primary">{(dwell / 1000).toFixed(1)}s</span>}
          </Line>
          <Note>出题数与点开次数【不构成点击率】：一次渲染出好几道题，可以点开多道、也可以一道都不点。停留用中位数不用均值（一个挂着页面去吃饭的样本就能把均值拉到几十分钟）。</Note>
          <Line title="反馈卡">
            主动结束练习 <span className="tabular-nums font-medium text-v2-text-primary">{q.feedback.endedUsers}</span> 人 ·
            攒下 <span className="tabular-nums font-medium text-v2-text-primary">{q.feedback.cardTotal}</span> 张 ·
            人均 {q.feedback.cardsPerUser === null
              ? <span className="text-v2-text-muted">无人主动结束，人均不成立</span>
              : <span className="tabular-nums font-medium text-v2-text-primary">{q.feedback.cardsPerUser} 张（n={q.feedback.endedUsers} 人）</span>} ·
            一张没攒下的 <span className="tabular-nums font-medium text-v2-text-primary">{q.feedback.zeroCardUsers}</span> 人
          </Line>
          <Note>本块的分母全部来自「主动点结束」的练习场次 —— 关标签页不上报，所以人数系统性偏低，这是「主动结束的人」的人均，不是全体练习者的人均。</Note>
        </>
      )}
    </Block>
  )
}

/**
 * 额度墙：撞墙人数 + 后续转化 / 沉默 + 观察期是否走完。
 * @param state  /api/dashboard/growth/funnel 的三态
 */
export function QuotaWallBlock({ state }: { state: GrowthState<GrowthFunnelResponse> }) {
  const res = state.data
  const w = res?.quotaWall ?? null
  const immature = w ? w.wallUsers - w.matureUsers : 0

  return (
    <Block label="撞上试用额度墙的人后来怎么了">
      {state.loading && !res && <div className="text-v2-text-muted text-[0.75rem] py-2">加载中…</div>}
      {state.error && <div className="text-v2-text-muted text-[0.75rem] py-2">额度墙数据暂时读取失败，刷新页面重试。</div>}

      {res?.quotaWallPending === true && (
        <div className="text-v2-text-muted text-[0.6875rem] leading-relaxed">
          额度墙 RPC（get_quota_wall_stats）尚未接入，待部署方跑迁移 0064 后自动显示真实数据。
        </div>
      )}

      {/* 空态写成人话：一屏 0% 会被读成「转化率 0%」，而真相是没人撞过墙 */}
      {w && w.wallUsers === 0 && (
        <div className="text-[0.6875rem] text-v2-text-secondary leading-relaxed">近 30 天无人撞上试用额度墙，两个比率无从谈起。</div>
      )}

      {w && w.wallUsers > 0 && (<>
        <Line title="撞墙">
          <span className="tabular-nums font-medium text-v2-text-primary">{w.wallUsers}</span> 人 ·
          撞墙后 7 天内注册 <span className="tabular-nums font-medium text-v2-text-primary">{w.convertedUsers}</span> 人
          {w.conversionRate !== null && <span className="text-v2-text-muted">（{w.conversionRate}%）</span>} ·
          撞墙后什么都没做 <span className="tabular-nums font-medium text-v2-text-primary">{w.silentUsers}</span> 人
          {w.silentRate !== null && <span className="text-v2-text-muted">（{w.silentRate}%）</span>}
        </Line>
        <Line title="观察期">
          已满 7×24 小时的 <span className="tabular-nums font-medium text-v2-text-primary">{w.matureUsers}</span> / {w.wallUsers} 人
          {immature > 0 && <span className="text-v2-text-muted">　—— 还有 {immature} 人观察期没走完，上面两个率【尚未定型】，别当结论用</span>}
        </Line>
      </>)}

      <Note>口径：撞墙窗口 30 天、观察期 7 天（两个独立口径，都不随上方区间选择器变）。「关闭弹层」不作为被劝退的证据 —— 关闭是关掉弹层的唯一方式，拿它当劝退率会得到一个永远接近 100% 的数。</Note>
    </Block>
  )
}
