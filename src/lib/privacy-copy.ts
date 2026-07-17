/**
 * @module   privacy-copy
 * @desc     内测数据处理说明的结构化文案唯一真源（纯展示版）。
 *           页面 /privacy/beta 与设置页据此渲染；FirstUseConsent / 隐私政策页复用其中
 *           服务商措辞常量，避免"语音=字节 / 文本=阿里云"口径再次漂移。
 *           BETA_PRIVACY_VERSION + updatedAt 为将来措辞实质变更后重新征得同意留钩子。
 * @author   LingoBridge
 * @created  2026-07-17
 */

/** 内测数据处理说明的版本号：措辞实质变更时 +1（是否借此重新征得同意由产品方定） */
export const BETA_PRIVACY_VERSION = 1

/** 本版说明的最后更新日期 'YYYY-MM-DD' */
export const BETA_PRIVACY_UPDATED_AT = '2026-07-17'

/**
 * 服务商措辞常量 —— 唯一真源。
 * 语音（较不敏感）走字节；故事文本（较敏感）走阿里云。隐私相关文案一律引用这两个常量。
 */
export const PRIVACY_VENDOR = {
  /** 语音转写服务商 */
  voice: '字节跳动语音服务',
  /** 文本分析服务商 */
  text: '阿里云通义千问',
} as const

/** 内测数据处理说明的一个分节 */
export interface BetaPrivacySection {
  /** 小标题 */
  heading: string
  /** 正文段落（逐条渲染为一段） */
  paragraphs: string[]
}

/** 说明标题 */
export const BETA_PRIVACY_TITLE = '内测数据处理说明'

/**
 * 内测数据处理说明正文（产品方定稿五句，逐字重要 —— 台账 080）。
 * 纯展示：本文件不含任何勾选 / 落库逻辑。
 */
export const BETA_PRIVACY_SECTIONS: BetaPrivacySection[] = [
  {
    heading: '数据如何被处理',
    paragraphs: [
      `你的语音会发送至${PRIVACY_VENDOR.voice}转写为文字。`,
      `你的故事文本会发送至${PRIVACY_VENDOR.text}进行分析。`,
      `${PRIVACY_VENDOR.voice}与${PRIVACY_VENDOR.text}两家的条款均声明：通过 API 传输的数据不会用于训练其模型。`,
    ],
  },
  {
    heading: '数据保留多久',
    paragraphs: [
      '你的故事由你自己掌控：可随时自行删除，删除账号时也会一并删除，不会在 30 天后被自动删除。',
      '我们仅将内部的 AI 分析日志（用于留证与改进产品）保留 30 天，到期自动删除。',
      '若你的故事入选评测基准，则会长期保留；届时我们会另行征得你的单独同意，且你可随时要求删除。',
    ],
  },
]
