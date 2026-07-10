/**
 * @module   changelog
 * @desc     更新日志与版本号唯一真源 —— 发版时在 CHANGELOG 数组【开头】加一条新条目即可：
 *           「关于」页版本号、顶栏铃铛面板、红点未读判断、/api/version 全部据此联动。
 * @author   LingoBridge
 * @created  2026-07-10
 */

export interface ChangelogEntry {
  /** 形如 'v0.6.0'（语义化三段，isNewerVersion 按段数值比较） */
  version: string
  /** 发布日期 'YYYY-MM-DD' */
  date: string
  /** 一句话标题 */
  title: string
  /** 要点列表（面向用户的说法，不写内部实现） */
  notes: string[]
}

/** 最新在前；发版时在数组开头加新条目 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: 'v0.6.0',
    date: '2026-07-10',
    title: '头像上传与体验优化',
    notes: [
      '支持上传自定义头像，练习对话里同步显示',
      '新增「关于 LingoBridge」介绍页',
      '键盘操作与读屏体验全面改进',
    ],
  },
]

/** 当前最新版本号（构建时烘焙；客户端与 /api/version 对比可检测旧标签页） */
export const LATEST_VERSION = CHANGELOG[0]!.version

/**
 * 版本比较：a 是否比 b 新（支持 'v0.6.0' 形式，逐段数值比较，缺段按 0）
 * @param a 待比较版本
 * @param b 基准版本
 */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}
