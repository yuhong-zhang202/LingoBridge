/**
 * @module   api/anki/cards
 * @desc     Anki 题卡写路径（对子/编辑）：
 *           - POST  { questionId, corpusId }  存对子/绑语料 → upsert 卡行(绑 corpus_id、generated_answer 先 null)
 *             + 入队生成；已绑非空语料 → 409（一题一语料，重复存对子）。
 *           - PATCH { questionId, editedAnswer }  存编辑 → 写 edited_answer（part3 亦可，用户自填）。
 *
 *           为什么 POST 而非 GET 存对子：有副作用（扣额度 + 入队付费 AI 生成），与 phrases/matching 同口径。
 *           鉴权：requireUserAllowAnon（匿名亦可试用，按 isAnonymous 区分额度）；同意闸 + 计次在入队【之前】
 *           硬前置（enqueue.ts 顶注：同意/计次归「用户发起请求」的端点，与 phrases「requireConsent +
 *           bumpDailyUsage 前置、再调 AI」同范式）。越权防护：assertCorpusOwner 校验语料归属。
 * @author   LingoBridge
 * @created  2026-07-23
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getQuestionById } from '@/lib/db/questions'
import { bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { enqueueAnkiGeneration } from '@/lib/anki/enqueue'
import { getCardCorpusBinding, upsertEditedAnswer } from '@/lib/db/anki-cards-server'
import { requireUser, requireUserAllowAnon, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { ANON_ANKI_LIMIT, REG_ANKI_DAILY_LIMIT } from '@/lib/constants'

/** 取 body 里的字符串字段并去空白；非字符串/缺省一律回退空串（下游按空串统一 400）。 */
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** POST：存对子/绑语料。 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    // 同意闸硬前置：存对子会令 drain 把用户中文语料发往千问生成卡背。未捕获当前版本同意 → 403，绝不入队。
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied

    const body = (await req.json().catch(() => ({}))) as { questionId?: unknown; corpusId?: unknown }
    const questionId = str(body.questionId)
    const corpusId = str(body.corpusId)
    if (!questionId) return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
    if (!corpusId) return NextResponse.json({ error: '缺少 corpusId' }, { status: 400 })

    // 越权防护：语料须属本人（storyId 属他人 → 403）。
    await assertCorpusOwner(userId, corpusId)
    // 题目须存在（enqueue 的 FK 也会拒，但这里早退给出干净 404）。
    const q = await getQuestionById(questionId)
    if (!q) return NextResponse.json({ error: '题目不存在' }, { status: 404 })

    // 冲突判定放在计次之前：重复存对子（已绑非空语料）→ 409，不白扣额度。
    // 判定用「先查后插」：卡行已存在且 corpus_id 非空 = 已存过对子 → 冲突；corpus_id 为 null（复习/编辑
    // 懒物化出的裸卡、或删语料后的退化卡）视为可绑，放行。换语料走 PUT /corpus，不走这里。
    const binding = await getCardCorpusBinding(userId, questionId)
    if (binding.exists && binding.corpusId !== null) {
      return NextResponse.json({ error: '该题已存过对子，换语料请用换语料入口', code: 'ANKI_ALREADY_BOUND' }, { status: 409 })
    }

    // 服务端硬防线：计次在入队（→ 付费 AI）之前。匿名超上限 → 402(QUOTA_EXCEEDED)；注册超熔断 → 429（不带 code）。
    const dailyCount = await bumpDailyUsageServer(userId, 'anki')
    if (isAnonymous ? dailyCount > ANON_ANKI_LIMIT : dailyCount > REG_ANKI_DAILY_LIMIT) {
      return isAnonymous
        ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
        : NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })
    }

    // 原子 upsert 卡行（绑 corpus_id、不动 SRS 进度）+ 入队生成任务（同题已有未完成任务则不重复入队）。
    const cardId = await enqueueAnkiGeneration({ userId, questionId, corpusId })
    return NextResponse.json({ cardId })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[anki cards POST]', e)
    return NextResponse.json({ error: '存对子失败' }, { status: 500 })
  }
}

/** PATCH：存编辑（写 edited_answer；part3 亦可）。无 AI 副作用 → 仅鉴权，不走同意/计次。 */
export async function PATCH(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as { questionId?: unknown; editedAnswer?: unknown }
    const questionId = str(body.questionId)
    // editedAnswer 允许为空串（清空用户编辑，回退到 generated_answer 展示）；仅要求是字符串。
    if (!questionId) return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
    if (typeof body.editedAnswer !== 'string') {
      return NextResponse.json({ error: '缺少 editedAnswer' }, { status: 400 })
    }
    await upsertEditedAnswer(userId, questionId, body.editedAnswer)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[anki cards PATCH]', e)
    return NextResponse.json({ error: '存编辑失败' }, { status: 500 })
  }
}
