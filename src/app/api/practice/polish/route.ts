/**
 * @module   api/practice/polish
 * @desc     POST 一句英文 → 千问给优化版 + 改进说明（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { polishSentence } from '@/services/practice'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { ANON_POLISH_LIMIT, REG_POLISH_DAILY_LIMIT } from '@/lib/constants'

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    const body = (await req.json()) as { sentence?: unknown; aiQuestion?: unknown; level?: unknown }
    const sentence = typeof body.sentence === 'string' ? body.sentence.trim() : ''
    const aiQuestion = typeof body.aiQuestion === 'string' ? body.aiQuestion : undefined
    const level = typeof body.level === 'string' ? body.level : '6.0'
    if (!sentence) {
      return NextResponse.json({ error: 'sentence 不能为空' }, { status: 400 })
    }
    // 输入上限（对所有用户生效，防刷 token）
    if (sentence.length > 500) {
      return NextResponse.json({ error: '句子过长，请精简后再试' }, { status: 400 })
    }
    // 服务端硬防线：先计次再调 AI。匿名超上限 → 402(QUOTA_EXCEEDED)；注册超熔断上限 → 429（不带 code）。
    const dailyCount = await bumpDailyUsageServer(userId, 'polish')
    if (isAnonymous ? dailyCount > ANON_POLISH_LIMIT : dailyCount > REG_POLISH_DAILY_LIMIT) {
      return isAnonymous
        ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
        : NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })
    }
    // polish 是练习中的单句润色，不绑定具体语料，无 corpusId；带 userId 归属留证。
    const result = await runWithRawLogContext({ userId, corpusId: null }, () =>
      polishSentence(sentence, aiQuestion, level),
    )
    return NextResponse.json(result)
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[polish API]', e)
    return NextResponse.json({ error: '优化失败' }, { status: 500 })
  }
}
