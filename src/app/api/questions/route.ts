/**
 * @module   api/questions
 * @desc     题库 API — 支持按 Part / 观察点 / 随机切换查询
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getQuestions, getQuestionsByObservation, getRandomSwitchQuestion } from '@/lib/db/questions'
import { requireUserAllowAnon } from '@/lib/api-auth'
import { getPracticedQuestionIdsServer } from '@/lib/db/practice-sessions-server'

// 题库低频变化，稳定查询走 CDN 缓存挡脚本刷量；随机切换题不缓存（每次须返回不同题）
const STABLE_CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400'

// exclude 参数来自 URL、用户可控，会被拼进 PostgREST `not.in.(...)` filter 串（见 db/questions.ts）。
// 虽当前打在公开的 questions 表 + PostgREST 语法层免疫（不吃子查询、跨参数 breakout 被 URL 编码挡死），
// 但「未净化输入直拼 filter」是坏习惯：进 filter 前一律过 UUID 白名单，非法元素丢弃，从源头掐断注入面。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode')

  try {
    // /api/questions?mode=switch → 切换池随机题目
    if (mode === 'switch') {
      const excludeRaw = searchParams.get('exclude') ?? ''
      const sessionExclude = excludeRaw ? excludeRaw.split(',') : []
      // 永久排除该用户「已练过」（练习对话完成后点「结束」= 走完完整链路）的题：从 Bearer 反查 userId，
      // service_role 查其 practice_sessions.question_id。无有效 session 或查询失败时降级为「不排已练」，抽题照常。
      let practiced: string[] = []
      try {
        const { userId } = await requireUserAllowAnon(request)
        try {
          practiced = await getPracticedQuestionIdsServer(userId)
        } catch (e) {
          logErr('[questions API] 读已练题失败，降级不排除', e)
        }
      } catch {
        // 无有效 session（尚未建匿名会话等边缘情况）：静默降级，不做已练排除
      }
      // 净化：只保留合法 UUID（非法元素直接丢弃、不报错，保持「降级照常抽题」语义）。
      // practiced 来自服务端本就是 UUID，不受影响；sessionExclude 里任何畸形值在进 filter 前被剔除。
      const excludeIds = Array.from(new Set([...sessionExclude, ...practiced])).filter((id) => UUID_RE.test(id))
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
