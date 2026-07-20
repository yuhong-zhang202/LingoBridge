/**
 * @module   env-server
 * @desc     【仅服务端】统一环境变量访问入口，含全部服务端密钥（dashscope / anthropic /
 *           doubao / adminEmails）及公开变量。含服务端密钥变量名，禁止被任何 'use client'
 *           文件或客户端可达的模块 import——一旦被前端链路引用，'server-only' 会让构建失败，
 *           变量名也会泄漏进 .next/static 前端 bundle。客户端请改引 @/lib/env。
 * @author   LingoBridge
 * @created  2026-06-02
 */
import 'server-only'

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,

  // 千问 / DashScope —— 服务端专用，切勿加 NEXT_PUBLIC_，切勿在客户端代码里引用
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY ?? '',
  dashscopeBaseUrl:
    process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',

  // Anthropic / Claude —— 服务端专用，切勿加 NEXT_PUBLIC_
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',

  // 豆包 ASR —— 服务端专用，切勿加 NEXT_PUBLIC_
  doubaoAsrAppId:       process.env.DOUBAO_ASR_APP_ID ?? '',
  doubaoAsrAccessToken: process.env.DOUBAO_ASR_ACCESS_TOKEN ?? '',

  // 管理员邮箱白名单（英文逗号分隔）—— 仅服务端读取，用于成本看板等敏感接口鉴权，切勿加 NEXT_PUBLIC_
  adminEmails: process.env.ADMIN_EMAILS ?? '',

  // 原始输出留证总开关（=1 开、其它/未设=关，默认关）。开启时 lib/raw-log.ts 把每次 LLM 调用的
  // 完整 prompt + 原始输出、每次 ASR 的转写原文入库（llm_raw_logs / asr_raw_logs，见 migration 0020），
  // 供离线复盘「模型是否把 score/reason 贴错 id」。含用户原文，靠表 RLS（service_role 唯一入口）+
  // pg_cron 30 天过期兜底；生产内测由产品方在 Zeabur 服务的环境变量里显式置 1。
  rawLogEnabled: process.env.RAW_LOG_ENABLED === '1',

  /**
   * 调试开关：为 true 时 lib/llm.ts 在【失败路径】上把模型原始输出打进 console。
   *
   * ⚠️ 模型输出含用户故事碎片——重排的 reason 会复述故事细节、萃取的证据字段会引用原文。
   *
   * **生产环境物理关闭，不靠任何人记得。** 2026-07-17 加固，两条理由：
   *  1. 此前它在 llm.ts 里【直读 process.env】，绕过本文件——env 校验层看不见它，
   *     `.env.example` 也没提，等于一个没人知道存在的暗雷。
   *  2. 这个项目今晚刚吃过「靠自觉的护栏不算护栏」的亏：guard-golden.sh 号称「物理拒绝」，
   *     实测 Bash 完全敞口，因为它依赖的是没人去试（台账 066）。
   *
   * 生产要复盘 → 开 rawLogEnabled（RAW_LOG_ENABLED=1，入库 + RLS + 30 天过期），不要用这个。
   */
  llmDebug: process.env.LLM_DEBUG === '1' && process.env.NODE_ENV !== 'production',

  /**
   * 重排打分路径开关：=1 走「AI 分维度 + 代码按权重合成」的新路径；默认（含未设/非 1）走现状单一总分。
   *
   * 第一阶段默认必须关，保证现网行为逐字不变；第二阶段 LOSO 拟合权重、红线验证通过后，
   * 再由产品方切开。两条路径的 prompt 与解析在 ranking.ts 内分开维护，互不污染。
   */
  rankingDimensional: process.env.RANKING_DIMENSIONAL === '1',

  /**
   * 匹配存档开关：默认启用「匹配一次→冻结存档→重访读档、不再跑模型」。
   * 设为 '0' 时命中判定被短路成「永远未命中」→ 立即回退到每次重访都重跑模型的旧行为
   * （快照表留着无害，不必回退迁移）。用于该功能上线出问题时的一键回滚。
   * 默认启用：仅显式设 '0' 才关闭（未设/其它值一律视为启用）。
   */
  matchSnapshotEnabled: process.env.MATCH_SNAPSHOT_ENABLED !== '0',

  /**
   * 同意审计痕迹的哈希盐（服务端专用，切勿加 NEXT_PUBLIC_）。
   *
   * 删号时先往 consent_audit 写一条去标识化痕迹（见 migration 0025），其中 email_hash =
   * sha256(lower(btrim(email)) || 本 salt)。邮箱空间小，裸 sha256 可被彩虹表反查回明文，
   * 故必须加盐；salt 只存在于环境变量，绝不落库、绝不进 git、代码里绝不硬编码任何默认值。
   *
   * ⚠️ 缺失时删号路由【在做任何删除动作之前】直接中止报 500（账号与数据完好，用户可重试）——
   * 即本变量未配 = 线上删号整体不可用。这是【故意做响的】：宁可让部署方立刻发现漏配，
   * 也不要静默跳过审计写入、等到监管来问才发现凭据一直没在写。
   *
   * ⚠️ 一旦启用【不可更换】：换 salt 会让此前写入的 email_hash 全部失配、再也无法比对。
   */
  consentHashSalt: process.env.CONSENT_HASH_SALT ?? '',
}
