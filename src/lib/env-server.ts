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

  // LLM 原始输出留存目录（相对/绝对路径）。留空=不留存（生产默认）。
  // 非空时 lib/llm.ts 会把每次调用的完整 prompt + 原始输出落盘成 JSONL，供离线复盘「模型是否把
  // score/reason 贴错 id」。含用户故事原文，务必只指向 .gitignore 内的本地目录，切勿在生产开启。
  // 落盘时目录 0o700 / 文件 0o600（见 llm.ts:appendRawLog）。
  llmRawLogDir: process.env.LLM_RAW_LOG_DIR ?? '',

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
   * 生产要复盘 → 用 llmRawLogDir（它有 0o600 保护），不要用这个。
   */
  llmDebug: process.env.LLM_DEBUG === '1' && process.env.NODE_ENV !== 'production',
}
