/**
 * @module   api/questions
 * @desc     题库 API — 支持按 Part / 观察点 / 随机切换查询
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { getQuestions, getQuestionsByObservation, getRandomSwitchQuestion } from '@/lib/db/questions'

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode')

  try {
    // /api/questions?mode=switch → 切换池随机题目
    if (mode === 'switch') {
      const excludeRaw = searchParams.get('exclude') ?? ''
      const excludeIds = excludeRaw ? excludeRaw.split(',') : []
      const question = await getRandomSwitchQuestion(excludeIds)
      return NextResponse.json({ question })
    }

    // /api/questions?mode=by-observation&obs=SPA_03
    if (mode === 'by-observation') {
      const obs = searchParams.get('obs')
      if (!obs) {
        return NextResponse.json({ error: '缺少 obs 参数' }, { status: 400 })
      }
      const questions = await getQuestionsByObservation(obs)
      return NextResponse.json({ questions })
    }

    // /api/questions?part=1 （默认：全部题目）
    const partRaw = searchParams.get('part')
    const part = partRaw ? (Number(partRaw) as 1 | 2 | 3) : undefined
    const questions = await getQuestions(part)
    return NextResponse.json({ questions })
  } catch (err) {
    console.error('[questions API] error', err)
    return NextResponse.json({ error: '获取题目失败' }, { status: 500 })
  }
}
