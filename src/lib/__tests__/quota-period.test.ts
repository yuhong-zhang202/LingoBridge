/**
 * @module   quota-period.test
 * @desc     额度日界/月界的东八区口径守卫。**全部时刻都是注入的**，不依赖跑测试时的真实时钟
 *           （日界这种东西若靠真实钟测，半夜跑 CI 就会飘，而半夜恰恰是这条 bug 唯一发作的时段）。
 *
 *           钉四件事：
 *             1. 香港 00:30（= UTC 前一天 16:30）算**新的一天** —— 这就是本次修的那一下：
 *                旧口径下用户凌晨 0 点半打开产品仍被昨天的额度拦着，要等到早上 8 点才恢复；
 *             2. 香港 23:59 与次日 00:01 分属两天，08:00 前后不是日界；
 *             3. 月界：香港每月 1 日 00:30 已属新月（含跨年）；
 *             4. **切换方向守卫**：同一时刻，新口径的可用次数恒 ≥ 旧口径。产品方拍板
 *                「有人当天额度被砍」绝对不可接受，这两个用例就是那条红线的物理锚点。
 * @author   LingoBridge
 * @created  2026-08-12
 */
import { quotaDayKey, quotaMonthStartISO, MONTH_TZ_SWITCH_GRACE_UNTIL_MS } from '@/lib/quota-period'
import { nextMonthFirstLabel, hkMonthStartMs } from '@/lib/date'

/** 旧口径的日桶键：UTC 当天（迁移前 Postgres `current_date` 在 UTC 库上的行为）。 */
function legacyUtcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** 旧口径的月桶起点：某个固定时区偏移下的「当月 1 日 0 点」（模拟客户端设备时区 / 服务端容器时区）。 */
function legacyLocalMonthStartMs(now: Date, offsetMinutes: number): number {
  const wall = new Date(now.getTime() + offsetMinutes * 60_000)
  return Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), 1) - offsetMinutes * 60_000
}

describe('日界 · 东八区', () => {
  it('香港 00:30（UTC 前一天 16:30）已经是新的一天 —— 本次修复的核心用例', () => {
    // 2026-08-02T16:30Z = 香港 2026-08-03 00:30
    expect(quotaDayKey(new Date('2026-08-02T16:30:00Z'))).toBe('2026-08-03')
    // 旧口径在这一刻还认为是 08-02，用户要再等 7.5 小时额度才恢复
    expect(new Date('2026-08-02T16:30:00Z').toISOString().slice(0, 10)).toBe('2026-08-02')
  })

  it('香港 23:59 与次日 00:01 分属两天', () => {
    expect(quotaDayKey(new Date('2026-08-02T15:59:00Z'))).toBe('2026-08-02')   // 香港 08-02 23:59
    expect(quotaDayKey(new Date('2026-08-02T16:01:00Z'))).toBe('2026-08-03')   // 香港 08-03 00:01
  })

  it('香港早上 8 点前后同属一天（旧口径正是在这里跳的日，新口径不该跳）', () => {
    expect(quotaDayKey(new Date('2026-08-02T23:59:00Z'))).toBe('2026-08-03')   // 香港 08-03 07:59
    expect(quotaDayKey(new Date('2026-08-03T00:01:00Z'))).toBe('2026-08-03')   // 香港 08-03 08:01
  })

  it('跨月 / 跨年边界照常（月末与元旦）', () => {
    expect(quotaDayKey(new Date('2026-08-31T16:00:00Z'))).toBe('2026-09-01')
    expect(quotaDayKey(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01')
  })
})

describe('日界 · 切换方向守卫（只多不少）', () => {
  // 日额度是【按桶键查表】而非按时间范围扫行，故这里直接模拟真实数据形态：
  // 切换前的每一次调用都按旧规则写进 day=UTC日期 的桶，切换时刻 T 分别用新旧键去查这批行。
  const seededCalls: Date[] = []
  for (let h = 0; h < 24 * 4; h += 1) {                  // 切换前 4 天，每小时一次调用
    seededCalls.push(new Date(Date.parse('2026-07-30T00:00:00Z') + h * 3600_000))
  }
  const usedUnder = (key: string): number =>
    seededCalls.filter((s) => legacyUtcDayKey(s) === key).length

  it('切换瞬间：无论落在一天的哪一分钟，新口径的「今日已用」都不多于旧口径 ⇒ 可用次数只多不少', () => {
    for (let minute = 0; minute < 24 * 60 * 2; minute += 1) {   // 逐分钟扫两整天，2880 个切换时刻
      const t = new Date(Date.parse('2026-08-02T00:00:00Z') + minute * 60_000)
      const usedNew = usedUnder(quotaDayKey(t))            // 新键去查旧规则写下的行
      const usedOld = usedUnder(legacyUtcDayKey(t))
      expect(usedNew).toBeLessThanOrEqual(usedOld)
    }
  })

  it('新日期键恒等于或晚于旧日期键（+1 天时该桶必为空，因为旧规则要到香港 08:00 才开始写它）', () => {
    for (let minute = 0; minute < 24 * 60; minute += 5) {
      const t = new Date(Date.parse('2026-08-31T00:00:00Z') + minute * 60_000)   // 含跨月
      expect(quotaDayKey(t) >= legacyUtcDayKey(t)).toBe(true)
    }
    const t = new Date('2026-08-02T16:30:00Z')          // 香港 08-03 00:30
    expect(quotaDayKey(t)).toBe('2026-08-03')
    expect(usedUnder('2026-08-03')).toBe(0)             // 该桶此刻必然还是空的
    // 旧口径写进 day='2026-08-03' 的行只可能产生于 UTC 08-03 当天，即香港 08-03 08:00 之后
    expect(Date.parse('2026-08-03T00:00:00Z')).toBeGreaterThan(t.getTime())
  })
})

describe('月界 · 东八区', () => {
  it('香港 9 月 1 日 00:30 已属新的一月（守卫到期后的纯东八区口径）', () => {
    const t = new Date('2026-08-31T16:30:00Z')          // 香港 2026-09-01 00:30
    expect(t.getTime()).toBeGreaterThanOrEqual(MONTH_TZ_SWITCH_GRACE_UNTIL_MS)
    expect(quotaMonthStartISO(t)).toBe('2026-08-31T16:00:00.000Z')   // = 香港 09-01 00:00
  })

  it('香港月末最后一分钟仍属旧月', () => {
    const t = new Date('2026-09-30T15:59:00Z')          // 香港 2026-09-30 23:59
    expect(quotaMonthStartISO(t)).toBe('2026-08-31T16:00:00.000Z')   // = 香港 09-01 00:00
  })

  it('跨年：香港 2027-01-01 00:30 属 1 月', () => {
    expect(quotaMonthStartISO(new Date('2026-12-31T16:30:00Z'))).toBe('2026-12-31T16:00:00.000Z')
  })

  it('hkMonthStartMs 的月偏移会跨年进位', () => {
    expect(new Date(hkMonthStartMs(new Date('2026-12-15T00:00:00Z'), 1)).toISOString())
      .toBe('2026-12-31T16:00:00.000Z')
  })
})

describe('月界 · 一次性切换守卫（只多不少）', () => {
  it('切换当月取 max(东八区月初, UTC 月初)：与旧服务端逐字相同，不追算任何历史语料', () => {
    const t = new Date('2026-08-12T07:00:00Z')          // 香港 08-12 15:00，守卫仍在有效期内
    expect(t.getTime()).toBeLessThan(MONTH_TZ_SWITCH_GRACE_UNTIL_MS)
    expect(quotaMonthStartISO(t)).toBe('2026-08-01T00:00:00.000Z')   // = 旧服务端（UTC 月初）
  })

  it('切换当月的错位窗口（香港 1 日 00:00–08:00）取东八区月初 = 新月新额度（多给的方向）', () => {
    // 假设迁移赶在 8/1 凌晨上线：此刻 UTC 还在 7 月，旧口径会拿 7 月的用量拦人
    const t = new Date('2026-07-31T16:30:00Z')          // 香港 08-01 00:30
    expect(quotaMonthStartISO(t)).toBe('2026-07-31T16:00:00.000Z')   // = 香港 08-01 00:00
  })

  it('切换过渡期内、对任意设备时区，新月界都不早于旧口径实际生效的月界 ⇒ 本月已用只会更少', () => {
    // 旧的实际生效下界 = min(设备月初, UTC 月初)：客户端先拦、服务端 402 兜底，严的一方说了算。
    // 扫描区间 = 最早可能上线时刻 → 守卫到期，逐 15 分钟；时区覆盖 UTC-12 … UTC+14 及半时区。
    // 【为什么只扫到期为止】「新旧口径需要比」只在切换当月成立；9 月起每月都是完整对齐的
    // 东八区自然月，月初 8 小时本就该算新月，没有「旧口径」可比（到期本身的安全性见下一个用例）。
    const offsets: number[] = []
    for (let h = -12; h <= 14; h += 1) offsets.push(h * 60)
    offsets.push(330, 345, -210)                        // 印度 / 尼泊尔 / 纽芬兰等半时区
    const from = Date.parse('2026-08-12T00:00:00Z')
    for (let t0 = from; t0 <= MONTH_TZ_SWITCH_GRACE_UNTIL_MS; t0 += 15 * 60_000) {
      const t = new Date(t0)
      const next = Date.parse(quotaMonthStartISO(t))
      for (const off of offsets) {
        const legacy = Math.min(legacyLocalMonthStartMs(t, off), legacyLocalMonthStartMs(t, 0))
        expect(next).toBeGreaterThanOrEqual(legacy)
      }
      // 月界必须落在当前时刻之前（否则本月用量恒为 0，等于额度失效）
      expect(next).toBeLessThanOrEqual(t.getTime())
    }
  })

  it('守卫到期那一刻月计数本就归零（下界 = 该时刻本身），故切回纯东八区不可能让谁变少', () => {
    const expiry = new Date(MONTH_TZ_SWITCH_GRACE_UNTIL_MS)
    expect(expiry.toISOString()).toBe('2026-08-31T16:00:00.000Z')          // = 香港 09-01 00:00
    expect(quotaMonthStartISO(expiry)).toBe(expiry.toISOString())
  })
})

describe('文案口径 · 额度重置日标签', () => {
  it('按东八区取下月 1 日（香港月末最后一分钟仍显示下月）', () => {
    expect(nextMonthFirstLabel(new Date('2026-08-31T15:59:00Z'))).toBe('9月1日')   // 香港 08-31 23:59
    expect(nextMonthFirstLabel(new Date('2026-08-31T16:01:00Z'))).toBe('10月1日')  // 香港 09-01 00:01
  })

  it('跨年显示 1月1日', () => {
    expect(nextMonthFirstLabel(new Date('2026-12-15T00:00:00Z'))).toBe('1月1日')
  })
})
