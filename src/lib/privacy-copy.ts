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
 * v3（2026-08-03）：新增「使用行为统计」披露。此前披露通篇只讲「内容发给第三方 AI」，
 *   一字未提我们还记录使用行为（flow_events 带 user_id，按 PIPL 属个人信息处理）；
 *   2026-08-02 那批把埋点事件从 4 类扩到 10 类、首次覆盖到「开口之前」的整段行为，据实补上。
 *   属实质新增 → bump → 老用户重弹重签（缓存 key 含版本号，v2 缓存自然失效，无需手动清）。
 * v4（2026-08-12）：闭合跨境存储披露的同意敞口。2026-08-06 新增了「你的数据存放在哪里」一节，
 *   当时按产品方指示【刻意没有 bump】——只放进隐私详情页供查看、不弹窗打扰老用户，
 *   代价是已签的 125 名用户其同意记录对应的仍是不含跨境披露的 v3。
 *   PIPL 第 39 条要求向境外提供个人信息须取得单独同意，那是一笔明确记账的合规敞口。
 *   本次 bump 即闭合它：老用户下次进来重签一次，同意记录里就含跨境披露了。
 *   ⚠️ 措辞一字未改（v4 的正文 = 08-06 那版），本次【只动版本号】——bump 的理由是
 *   「同意记录要对得上已经生效的措辞」，不是又新增了什么。
 *   ⚠️ 重签成本随用户数线性上涨，125 人时做是最便宜的时点；将来若再出现同类敞口，别再拖。
 */
export const BETA_PRIVACY_VERSION = 4

/**
 * 本版说明的最后更新日期 'YYYY-MM-DD'
 *
 * 保持 2026-08-06 不动：v4 的正文就是那天定稿的（新增「你的数据存放在哪里」一节）。
 * 本次 bump 只是让同意记录追上这份措辞，说明文本一个字都没改，故不是「又更新了一次」。
 */
export const BETA_PRIVACY_UPDATED_AT = '2026-08-06'

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

/**
 * 使用行为统计披露句（v3 新增）—— 诚实告知：我们记录不含内容的使用行为。
 *
 * 【为什么必须补】此前披露只讲「内容会发给第三方 AI」，完全没提我们还在记录使用行为；
 * 而 flow_events 每行都带 user_id，按 PIPL 属个人信息处理。2026-08-02 那批把事件从 4 类
 * 扩到 10 类、并首次覆盖到「用户开口之前」的整段行为（点了哪个入口、麦克风授权结果、
 * 采集开始/提交结局/中途放弃、AI 调用成败与耗时），据实补上。
 *
 * 【措辞的两条硬要求】① 举的例子必须是我们真的在记的（别写没记的东西充数）；
 * ② 必须明写「不包含你说的话或写的文字」——这是 props 白名单机制的用户侧承诺，
 *    对应 api/events 的 sanitize（只放行枚举/整数/布尔，任何自由文本字段一律不设）。
 *    这条边界一旦在代码里被破坏，这句披露就成了假话，所以两边要互相引着看。
 */
export const PRIVACY_USAGE_ANALYTICS_DISCLOSURE =
  '为了解产品哪一步不好用，我们会记录不含内容的使用行为，例如点了哪个入口、录音持续了多久、某一步是成功还是失败。这些记录不包含你说的话或写的文字。'

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
  PRIVACY_USAGE_ANALYTICS_DISCLOSURE,
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
    // v3 新增：使用行为统计披露。上面两节讲的是「内容去了哪、谁会读」，这节讲「我们还记了什么」。
    heading: '我们记录哪些使用行为',
    paragraphs: [
      PRIVACY_USAGE_ANALYTICS_DISCLOSURE,
      '记录的都是状态与数字，比如某个按钮有没有被点、录音持续了多少秒、输入了多少个字、某次处理是成功还是失败、失败的原因属于哪一类。',
      '这些记录里不会出现你的故事原文、语音转写的内容，也不会出现你输入的文字。',
    ],
  },
  {
    // v4 新增：跨境存储披露。上面几节讲的是「内容发给谁处理」，这节讲「数据存放在哪个国家」——
    // 这是两件事：处理方（字节、阿里云）都在境内，而我们自己的数据库与应用托管在境外，
    // 此前的文案完全没提后者，等于漏掉了唯一真正出境的那一项。
    heading: '你的数据存放在哪里',
    paragraphs: [
      '我们的数据库位于新加坡，应用服务器位于中国香港。这意味着你的故事、语音转写文字与账号信息会存放在中国大陆境外。',
      '把服务器放在这两个位置，是为了让国内访问更快、也让 AI 处理的链路更短。处理你内容的两家 AI 服务商都在中国大陆境内。',
      '你可以随时在这个页面了解数据的处理方式，也可以在设置里删除自己的故事或注销账号，注销会一并删除境外存储的全部内容。',
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
