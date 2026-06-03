/**
 * @module   env
 * @desc     统一环境变量访问入口，禁止在代码其他处直接使用 process.env
 * @author   LingoBridge
 * @created  2026-06-02
 */

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,

  // 千问 / DashScope —— 服务端专用，切勿加 NEXT_PUBLIC_，切勿在客户端代码里引用
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY ?? '',
  dashscopeBaseUrl:
    process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',

  // Anthropic / Claude —— 服务端专用，切勿加 NEXT_PUBLIC_
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
}
