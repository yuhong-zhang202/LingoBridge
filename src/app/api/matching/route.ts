/**
 * @module   api/matching
 * @desc     POST 接口：按 corpusId 服务端读取整理后故事 → 萃取观察点 → 返回真实匹配题目（故事正文不进 URL）
 * @author   LingoBridge
 * @created  2026-06-03
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { matchByStory, type FunnelMatchResult } from '@/services/matching'
import { logApiUsage, API_PRICING } from '@/lib/api-logger'
import { getCorpusByIdServer } from '@/lib/db/corpus-server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { SCORE_HIGH, SCORE_MID, SCORE_LOW } from '@/lib/constants'

/** 相关性分数 → 匹配档位（与 matching 页分组判定一致，无 score 视为高匹配；< SCORE_LOW 不展示亦不入库） */
function levelForScore(score: number | undefined): 'high' | 'mid' | 'low' | null {
  const s = score ?? 100
  if (s >= SCORE_HIGH) return 'high'
  if (s >= SCORE_MID) return 'mid'
  if (s >= SCORE_LOW) return 'low'
  return null
}

/**
 * 把匹配结果落库：对每个匹配题 upsert 一行（corpus_id,question_id 冲突即更新）。
 * 使用 service_role client，user_id 取自 corpus 行；调用方需 catch，写库失败不阻断匹配返回。
 */
async function persistMatches(corpusId: string, result: FunnelMatchResult): Promise<void> {
  const supabase = getSupabaseServer()
  const { data: corpusRow, error: cErr } = await supabase
    .from('corpus')
    .select('user_id')
    .eq('id', corpusId)
    .maybeSingle()
  if (cErr) throw cErr
  const userId = (corpusRow as { user_id: string } | null)?.user_id
  if (!userId) return

  const rows = result.questions
    .map((q) => ({ q, level: levelForScore(q.relevanceScore) }))
    .filter((x): x is { q: typeof x.q; level: 'high' | 'mid' | 'low' } => x.level !== null)
    .map((x) => ({ user_id: userId, corpus_id: corpusId, question_id: x.q.id, match_level: x.level }))
  if (rows.length === 0) return

  const { error } = await supabase
    .from('corpus_question_matches')
    .upsert(rows, { onConflict: 'corpus_id,question_id' })
  if (error) throw error
}

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const body = (await req.json()) as { corpusId?: unknown }
    const corpusId = typeof body.corpusId === 'string' ? body.corpusId.trim() : ''
    if (!corpusId) {
      return NextResponse.json({ error: 'corpusId 不能为空' }, { status: 400 })
    }
    const cleanedText = (await getCorpusByIdServer(corpusId))?.trim() ?? ''
    if (!cleanedText) {
      return NextResponse.json({ error: '语料无正文或不存在' }, { status: 400 })
    }
    const result = await matchByStory(cleanedText)
    // 持久化匹配结果供反查；写库失败不阻断匹配返回
    await persistMatches(corpusId, result).catch((e) => logErr('[matching persist]', e))
    // extractCorpus 内未向上暴露 usage，按语料字数估算输入 token（中文约 0.8 token/字 + 系统提示约 1200）
    const promptTokens = Math.round(cleanedText.length * 0.8 + 1200)
    const completionTokens = 100
    logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: promptTokens + completionTokens, usage_unit: 'tokens', estimated_cost_cny: (promptTokens / 1_000_000) * API_PRICING.qwen_plus_input_per_1m + (completionTokens / 1_000_000) * API_PRICING.qwen_plus_output_per_1m, latency_ms: Date.now() - t0, status: 'success', metadata: { prompt_tokens: promptTokens, completion_tokens: completionTokens } }).catch(() => {})
    return NextResponse.json(result)
  } catch (e) {
    logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error' }).catch(() => {})
    logErr('[matching API]', e)
    return NextResponse.json({ error: '匹配失败' }, { status: 500 })
  }
}
