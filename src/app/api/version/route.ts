/**
 * @module   api/version
 * @desc     返回线上此刻部署的最新版本号（服务端 import changelog，随每次部署更新）。
 *           客户端 UpdateBanner 以此对比构建时烘焙的本地版本，检测「运行中的旧标签页」。
 * @author   LingoBridge
 * @created  2026-07-10
 */
import { NextResponse } from 'next/server'
import { LATEST_VERSION } from '@/lib/changelog'

// 禁止静态化与缓存：必须每次请求都返回当前部署的版本
export const dynamic = 'force-dynamic'

export function GET(): NextResponse {
  return NextResponse.json(
    { version: LATEST_VERSION },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
