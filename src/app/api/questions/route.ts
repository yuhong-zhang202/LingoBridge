/**
 * @module   api/questions
 * @desc     题库 API — 支持按 Part / 观察点 / 随机切换查询
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getQuestions, getQuestionsByObservation, getRandomSwitchQuestion } from '@/lib/db/questions'

// 题库低频变化，稳定查询走 CDN 缓存挡脚本刷量；随机切换题不缓存（每次须返回不同题）
const STABLE_CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400'

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode')

  try {
    // /api/questions?mode=switch → 切换池随机题目
    if (mode === 'switch') {
      const excludeRaw = searchParams.get('exclude') ?? ''
      const excludeIds = excludeRaw ? excludeRaw.split(',') : []
      const question = await getRandomSwitchQuestion(excludeIds)
      // 随机切换题就是要每次不同，显式 no-store 排除 CDN 缓存
      return NextResponse.json({ question }, { headers: { 'Cache-Control': 'no-store' } })
    }

    // /api/questions?mode=by-observation&obs=SPA_03
    if (mode === 'by-observation') {
      const obs = searchParams.get('obs')
      if (!obs) {
        return NextResponse.json({ error: '缺少 obs 参数' }, { status: 400 })
      }
      const questions = await getQuestionsByObservation(obs)
      return NextResponse.json({ questions }, { headers: { 'Cache-Control': STABLE_CACHE } })
    }

    // /api/questions?part=1 （默认：全部题目）
    const partRaw = searchParams.get('part')
    const part = partRaw ? (Number(partRaw) as 1 | 2 | 3) : undefined
    const questions = await getQuestions(part)
    return NextResponse.json({ questions }, { headers: { 'Cache-Control': STABLE_CACHE } })
  } catch (err) {
    logErr('[questions API]', err)
    return NextResponse.json({ error: '获取题目失败' }, { status: 500 })
  }
}
