/**
 * @module   api/pronounce
 * @desc     POST 想说词/被听成词 → 千问给音标 + 怎么念提示（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-11
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { generatePronunciationTip } from '@/services/pronounce'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { ANON_PRONOUNCE_LIMIT, REG_PRONOUNCE_DAILY_LIMIT } from '@/lib/constants'

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    const body = (await req.json()) as { intended?: unknown; heard?: unknown; context?: unknown }
    const intended = typeof body.intended === 'string' ? body.intended.trim() : ''
    const heard = typeof body.heard === 'string' ? body.heard.trim() : ''
    const context = typeof body.context === 'string' ? body.context : undefined
    if (!intended || !heard) {
      return NextResponse.json({ error: 'intended/heard 不能为空' }, { status: 400 })
    }
    // 输入上限（对所有用户生效，防刷 token）：想说词/被听成词各 100 字，出处句 500 字
    if (intended.length > 100 || heard.length > 100 || (context !== undefined && context.length > 500)) {
      return NextResponse.json({ error: '内容过长，请精简后再试' }, { status: 400 })
    }
    // 服务端硬防线：先计次再调 AI。匿名超上限 → 402(QUOTA_EXCEEDED)；注册超熔断上限 → 429（不带 code）。
    const dailyCount = await bumpDailyUsageServer(userId, 'pronounce')
    if (isAnonymous ? dailyCount > ANON_PRONOUNCE_LIMIT : dailyCount > REG_PRONOUNCE_DAILY_LIMIT) {
      return isAnonymous
        ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
        : NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })
    }
    // pronounce 不绑定具体语料，无 corpusId；带 userId 归属留证。
    const result = await runWithRawLogContext({ userId, corpusId: null }, () =>
      generatePronunciationTip(intended, heard, context),
    )
    return NextResponse.json(result)
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[pronounce API]', e)
    return NextResponse.json({ error: '生成发音提示失败' }, { status: 500 })
  }
}
