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
}
