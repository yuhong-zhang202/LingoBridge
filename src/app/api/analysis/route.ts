/**
 * @module   api/analysis
 * @desc     GET ?questionId → 取题 + Claude 生成侧重点分析（密钥只在服务端）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { getQuestionById } from '@/lib/db/questions'
import { generateAnalysis } from '@/services/analysis'
import { DIMENSION_LABEL } from '@/lib/constants'
import type { AnalysisResponse, DimensionLabel } from '@/lib/types'

// 观察点 code 前缀 → 维度 id
const PREFIX_DIM: Record<string, keyof typeof DIMENSION_LABEL> = {
  EMO: 'emotion', REL: 'relationship', SPA: 'space', SPI: 'spirit', GRO: 'growth', VALUE: 'value',
}
function dimFromCode(code: string | undefined): DimensionLabel | null {
  if (!code) return null
  const dim = PREFIX_DIM[code.split('_')[0]]
  return dim ? DIMENSION_LABEL[dim] : null
}

export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const questionId = searchParams.get('questionId') ?? ''
  if (!questionId) {
    return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
  }

  try {
    const q = await getQuestionById(questionId)
    if (!q) {
      return NextResponse.json({ error: '题目不存在' }, { status: 404 })
    }

    // Part 2：完整 cue card 喂 AI，展示用短标题
    const enForAI = q.question_text
    const enForDisplay = q.part === 2 ? (q.cue_card_title ?? q.question_text) : q.question_text
    const zhForDisplay = q.part === 2 ? (q.cue_card_title_zh ?? '') : (q.question_text_zh ?? '')

    const analysis = await generateAnalysis({ part: q.part, en: enForAI, zh: q.question_text_zh })

    const body: AnalysisResponse = {
      question: {
        id: q.id,
        part: q.part,
        en: enForDisplay,
        zh: zhForDisplay,
        dimension: dimFromCode(q.observation_points[0]),
        isNew: q.is_new,
      },
      analysis,
    }
    return NextResponse.json(body)
  } catch (e) {
    console.error('[analysis API] error', e)
    return NextResponse.json({ error: '生成分析失败' }, { status: 500 })
  }
}
