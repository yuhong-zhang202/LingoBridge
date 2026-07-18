/**
 * @module   privacy-copy
 * @desc     内测数据处理说明的结构化文案唯一真源。
 *           页面 /privacy/beta 与设置页据此渲染；FirstUseConsent 同意闸复用其中的弹窗披露摘要
 *           （CONSENT_POPUP_*）与服务商措辞常量，避免"语音=字节 / 文本=阿里云"口径再次漂移。
 *           BETA_PRIVACY_VERSION 兼作同意闸落库的 consent_version：措辞实质变更即 bump → 老用户重弹重签。
 *           CONSENT_SCOPE_SNAPSHOT 是同意时展示范围的原文快照来源（写入 consent_records.scope_snapshot）。
 * @author   LingoBridge
 * @created  2026-07-17
 */

/**
 * 内测数据处理说明 / 同意披露的版本号：措辞实质变更时 +1。
 * 兼作 consent_records.consent_version 与同意闸 localStorage 缓存 key 的唯一版本源（别再手维两套）。
 * v2（2026-07-18）：新增「人读披露」句（内部人员可能阅读故事内容）——属实质新增，bump 后老用户重弹重签。
 */
export const BETA_PRIVACY_VERSION = 2

/** 本版说明的最后更新日期 'YYYY-MM-DD' */
export const BETA_PRIVACY_UPDATED_AT = '2026-07-18'

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

/**
 * 人读披露句 —— 诚实告知：内部人员可能阅读用户故事内容（用于改进产品 + 建立评测基准）。
 * 此前披露只讲「发给第三方 AI」，未讲「我方人可能读」；据实补上（台账 094 之后新增）。
 * 属实质新增，故触发 BETA_PRIVACY_VERSION bump（老用户重新弹窗重签）。弹窗摘要与 beta 页均引用本句，逐字一致。
 */
export const PRIVACY_HUMAN_READ_DISCLOSURE =
  '为改进产品与建立评测基准，我方内部人员可能阅读你的故事内容。'

/** 首次同意弹窗标题（唯一真源，同时进 scope_snapshot 快照） */
export const CONSENT_POPUP_TITLE = '开始前，关于你的隐私'

/**
 * 首次同意弹窗展示的披露摘要（逐段渲染）。
 * 既是 FirstUseConsent 弹窗正文的唯一真源，也是写入 consent_records.scope_snapshot 的原文快照来源——
 * 二者同源，保证「库里冻结的范围」= 「用户当刻实际看到的范围」。第二段即人读披露句。
 */
export const CONSENT_POPUP_DISCLOSURE: readonly string[] = [
  `为了把你说的话转成文字、并生成题目和练习反馈，你的录音与文字会发送给第三方 AI 服务处理——语音转写用${PRIVACY_VENDOR.voice}，内容分析用${PRIVACY_VENDOR.text}。仅用于练习功能，不出售你的数据。我们会将内部的 AI 分析日志保留 30 天用于改进产品，到期自动删除。`,
  PRIVACY_HUMAN_READ_DISCLOSURE,
]

/**
 * 同意范围快照 —— 写入 consent_records.scope_snapshot 的 jsonb 原文。
 * 由服务端（/api/consent）据此冻结「用户在本版本下同意时看到、同意了什么」，日后披露改版不篡改历史记录。
 * 完全由服务端从本文件构造，不接受客户端传入（防伪造），对齐 api/events 的「原文不由客户端塞库」纪律。
 */
export const CONSENT_SCOPE_SNAPSHOT = {
  version: BETA_PRIVACY_VERSION,
  title: CONSENT_POPUP_TITLE,
  disclosure: CONSENT_POPUP_DISCLOSURE,
  vendors: PRIVACY_VENDOR,
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
    // v2 新增：人读披露（诚实告知内部人员可能阅读故事内容）。留存那节按台账 094 一字不动。
    heading: '谁会阅读你的内容',
    paragraphs: [PRIVACY_HUMAN_READ_DISCLOSURE],
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
