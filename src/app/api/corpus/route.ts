/**
 * @module   api/corpus
 * @desc     POST 创建一段新语料 —— 服务端强制故事月额度并落库（客户端直连 insert 可绕过额度，故搬服务端）。
 *           鉴权 + 配额照 /api/practice 模式：requireUser → 超额 402(QUOTA_EXCEEDED) → createCorpusServer。
 *           仅创建这一步服务端化；后续 updateCorpusCleaned / upsertMatch / 跳转仍走客户端 RLS。
 * @author   LingoBridge
 * @created  2026-07-12
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { logEvent } from '@/lib/events'
import { countCorpusThisMonthServer, countCorpusForUserServer, createCorpusServer } from '@/lib/db/corpus-server'
import { STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import { ANON_CORPUS_LIMIT } from '@/lib/constants'
import type { CorpusSource } from '@/lib/types'

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    // 同意闸硬前置：故事落库是「原文进系统、后续各 AI 出口取用」的咽喉。未捕获当前版本同意 → 403，
    // 从纵深封死「脚本绕过前端弹窗直灌语料、再走下游 AI 外发」的路径。
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied
    const body = (await req.json()) as { source?: unknown; rawText?: unknown }
    const source: CorpusSource = body.source === 'text' ? 'text' : 'voice'
    const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : ''
    if (!rawText) {
      return NextResponse.json({ error: 'rawText 不能为空' }, { status: 400 })
    }

    // 额度服务端强制：超额返回 402 + code=QUOTA_EXCEEDED，客户端据此弹配额提示。
    // 匿名用户走「试用仅 1 条」（总条数）；注册用户维持既有故事月额度。
    if (isAnonymous) {
      const total = await countCorpusForUserServer(userId)
      if (total >= ANON_CORPUS_LIMIT) {
        return NextResponse.json({ error: '试用已完成，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
      }
    } else {
      const used = await countCorpusThisMonthServer(userId)
      if (used >= STORY_MONTHLY_LIMIT) {
        return NextResponse.json({ error: '本月故事额度已用完', code: 'QUOTA_EXCEEDED' }, { status: 402 })
      }
    }

    const corpus = await createCorpusServer(userId, { source, rawText })
    // 埋点 flow.corpus_bound：这一刻 story_id（corpus.id）诞生 = 一个真实故事诞生，是「真实故事数」这个
    // 分母的定义点；同时把此前只有 flow_id 的 ASR/整理环节与 story_id 接上（全链路 join 的桥）。
    // logEvent 内部已吞异常，不阻断创建返回。
    await logEvent({
      event: 'flow.corpus_bound',
      flowId: req.headers.get('x-flow-id'),
      storyId: corpus.id,
      userId,
      props: { source },
    })
    return NextResponse.json({ corpus })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[corpus API]', e)
    return NextResponse.json({ error: '保存语料失败' }, { status: 500 })
  }
}
