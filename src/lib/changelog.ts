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
    // 版本号用 semver（vX.Y.Z）——isNewerVersion / 铃铛红点按段数值比较，不能用日期串（NaN 会破坏红点）。
    // 首页公告卡（ChangelogAnnouncement）只取 CHANGELOG[0] 主动弹一次；每次发版有用户可见改动时在此加新条。
    version: 'v0.9.0',
    date: '2026-07-31',
    title: '练习反馈升级',
    notes: [
      '句子优化解释分「语法」「词组」两栏，直指改进点',
      '反馈卡片：练习优化的句子连同解释存入素材库，随时复习',
      '教练对话更贴近真实考官：Part 2 完整长答后自然延伸至 Part 3',
      '题库速览新增「今日复习」与 Part 分级筛选',
      '素材库与首页焕新，开放邮箱注册',
      '题库速览、题卡复习加载更快，进入即刷',
    ],
  },
  {
    version: 'v0.8.0',
    date: '2026-07-25',
    title: '题库速览上线',
    notes: [
      '题库速览上线：当季题卡随时刷、绑语料生成你的答法',
      '录音转写更稳：人多时自动排队重试、转写失败可改用文字输入，不用重说',
      '额度提示更清楚：撞额度时同时显示「故事练习」和「题目练习」两个额度的真实用量',
    ],
  },
  {
    version: 'v0.7.0',
    date: '2026-07-10',
    title: '桌面端全新体验',
    notes: [
      '桌面端全新体验：核心练习流程与题库、素材库、我的等页面完成桌面版重新设计',
      '支持上传自定义头像，练习对话里同步显示',
      '新增备考目标与考试倒计时，把目标分和考试日期放在显眼处',
      '新增「关于 LingoBridge」介绍页',
      '更新提醒：有新版本时铃铛会提示，可一键刷新',
      '修改密码入口移至「设置」',
      '大量无障碍与体验优化（键盘操作、读屏支持、对比度、动效减弱）',
    ],
  },
]

/** 当前最新版本号（构建时烘焙；客户端与 /api/version 对比可检测旧标签页） */
export const LATEST_VERSION = CHANGELOG[0]!.version

/**
 * 取当前要展示的最新一条更新（首页公告卡 ChangelogAnnouncement 用）。
 * @returns  最新一条 ChangelogEntry；列表为空时返回 null（不展示公告）
 */
export function getLatestChangelog(): ChangelogEntry | null {
  return CHANGELOG[0] ?? null
}

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
