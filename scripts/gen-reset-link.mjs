#!/usr/bin/env node
/**
 * @module   gen-reset-link
 * @desc     【运维脚本】用 service_role 给指定邮箱生成一条密码重置链接（recovery action_link）。
 *           当用户收不到邮件时，把打印出的链接私下发给他完成重置。本脚本仅在本机/服务器跑，
 *           不会被打进前端 bundle。
 * @author   LingoBridge
 * @created  2026-06-17
 *
 * 用法：
 *   node --env-file=.env.local scripts/gen-reset-link.mjs user@example.com
 *
 * 依赖环境变量：
 *   SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_URL  — 项目地址
 *   SUPABASE_SERVICE_ROLE_KEY                — 管理员 key（绝不放进前端）
 *   SITE_URL（可选）                          — 默认 http://localhost:3000
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const siteUrl = process.env.SITE_URL ?? 'http://localhost:3000'

if (!url || !key) {
  console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 环境变量')
  process.exit(1)
}

const email = process.argv[2]
if (!email) {
  console.error('用法：node --env-file=.env.local scripts/gen-reset-link.mjs <email>')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data, error } = await supabase.auth.admin.generateLink({
  type: 'recovery',
  email,
  options: { redirectTo: `${siteUrl}/reset-password` },
})

if (error) {
  console.error('生成重置链接失败：', error.message)
  process.exit(1)
}

const link = data?.properties?.action_link
if (!link) {
  console.error('未取到 action_link，返回结构：', JSON.stringify(data, null, 2))
  process.exit(1)
}

console.log(link)
