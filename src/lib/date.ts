/**
 * @module   date
 * @desc     日期格式化 + 东八区时刻换算的统一出口 —— 格式化一律走 Intl.DateTimeFormat，
 *           不手写 `${m}/${d}` 拼接（手写格式无视语言环境，且同一文案曾在 4 处各拷一份）。
 *
 *           2026-08-12 起本模块另承担「东八区分桶原语」：产品部署在香港、用户在东八区，
 *           而 DB 存 UTC、Node 容器时区不可控、浏览器跟随设备时区 —— 凡是「今天 / 本月」
 *           这类要跟用户墙上时钟对齐的换算，都必须显式折算，绝不能靠 `new Date().getMonth()`
 *           这类跟随运行环境时区的写法。额度的日界/月界口径见 lib/quota-period.ts。
 * @author   LingoBridge
 * @created  2026-07-10
 */

const MONTH_DAY = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' })
// 额度重置日标签固定按东八区渲染：额度月界本身就是东八区（见 quota-period），
// 标签若跟随设备时区，跨时区用户会在月末看到晚一天/早一天的重置日，与真实重置时刻对不上。
const MONTH_DAY_CN_HK = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Shanghai',
})

/**
 * 东八区偏移（毫秒）。香港/北京自 1991 年起无夏令时，全年恒定 +8，故用固定偏移量而非时区库。
 *
 * ⚠️ 与看板的 `src/lib/db/dashboard-shared.ts` 的 `HK_OFFSET_MS` **同值同语义**（同一口径的两处定义）。
 * 之所以没有直接 import：那份在 `import 'server-only'` 的模块里，客户端组件物理上引不到。
 * 合并成一份是审计排期里的 P2（要动看板文件），本次时区修复不碰看板，故按同一定义在此重述。
 */
export const HK_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * 把某一真实时刻折算成「东八区墙上时钟」：返回 Date 的 **UTC 字段** 即香港的年/月/日/时。
 * 与看板 route 的 `nowHk` 同款手法 —— 只用于取分桶字段，绝不用于展示（它的本地字段是错的）。
 * @param  now  真实时刻
 * @returns     字段被平移过的 Date（仅可读 getUTC* 系列）
 */
function toHkWallClock(now: Date): Date {
  return new Date(now.getTime() + HK_OFFSET_MS)
}

/**
 * 某一时刻在东八区的日期键，格式 `YYYY-MM-DD`。
 * 用于与 Postgres `date` 列（迁移 0062 起按东八区写入）逐字比对，故必须是零填充的 ISO 日期。
 * @param  now  真实时刻，默认当前
 * @returns     如 `2026-08-03`
 */
export function hkDayKey(now: Date = new Date()): string {
  return toHkWallClock(now).toISOString().slice(0, 10)
}

/**
 * 东八区某月 1 日 00:00 所对应的**真实 UTC 时刻**（毫秒）。
 * 例：东八区 2026-09-01 00:00 → UTC 2026-08-31 16:00。
 * @param  now          基准时刻（用它的东八区年月），默认当前
 * @param  monthOffset  月偏移，0=当月、1=下月、-1=上月（Date.UTC 自动处理跨年）
 * @returns             该月界的 UTC 毫秒时间戳
 */
export function hkMonthStartMs(now: Date = new Date(), monthOffset = 0): number {
  const hk = toHkWallClock(now)
  return Date.UTC(hk.getUTCFullYear(), hk.getUTCMonth() + monthOffset, 1) - HK_OFFSET_MS
}

/**
 * 短日期，如「7/10」——用于卡片角标、时间戳
 * @param date 目标日期，默认今天
 */
export function formatMonthDay(date: Date = new Date()): string {
  return MONTH_DAY.format(date)
}

/**
 * 下月 1 日的中文标签，如「8月1日」——用于额度重置日提示。
 * 按**东八区**取月份并按东八区渲染：额度月界是东八区的月界，标签必须同口径，
 * 否则跨时区用户会在月末最后 8 小时看到与实际重置时刻差一个月的日期。
 * @param from 基准日期，默认今天
 */
export function nextMonthFirstLabel(from: Date = new Date()): string {
  return MONTH_DAY_CN_HK.format(new Date(hkMonthStartMs(from, 1)))
}
