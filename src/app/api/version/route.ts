/**
 * @module   api/version
 * @desc     返回线上此刻部署的最新版本号（服务端 import changelog，随每次部署更新）。
 *           客户端 UpdateBanner 以此对比构建时烘焙的本地版本，检测「运行中的旧标签页」。
 *
 *           另返回 commit / builtAt，用于回答「线上跑的到底是哪次推送」——
 *           2026-08-13 排查部署失败时，因 version 只在有用户可见改动时才 bump，
 *           这个问题答不出来，只能靠试录音反推。现在一次 curl 即可：
 *             curl -s https://<生产域>/api/version
 *
 * @author   LingoBridge
 * @created  2026-07-10
 */
import { NextResponse } from 'next/server'
import { LATEST_VERSION } from '@/lib/changelog'

// 禁止静态化与缓存：必须每次请求都返回当前部署的版本
export const dynamic = 'force-dynamic'

// next.config.mjs 在构建时烘焙（env 注入），此处是被替换后的字面量，不读运行时环境。
// 'unknown' 表示构建机既无环境变量也读不到 .git —— 是【如实报告取不到】，不是伪造值。
const COMMIT = process.env.BUILD_COMMIT ?? 'unknown'
const BUILT_AT = process.env.BUILT_AT ?? 'unknown'

export function GET(): NextResponse {
  return NextResponse.json(
    // ⚠️ version 字段是 UpdateBanner 的既有契约（它只读这一个键），只可增字段、不可改名或删。
    { version: LATEST_VERSION, commit: COMMIT, builtAt: BUILT_AT },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
