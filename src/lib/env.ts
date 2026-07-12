/**
 * @module   env
 * @desc     【客户端安全】只暴露 NEXT_PUBLIC_ 公开环境变量（本就会进前端 bundle）。
 *           服务端密钥（dashscope / anthropic / doubao / adminEmails）已迁至 env-server.ts，
 *           以免变量名被打进 .next/static 前端 JS。服务端代码请改引 @/lib/env-server。
 * @author   LingoBridge
 * @created  2026-06-02
 */

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
}
