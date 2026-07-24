/**
 * @module   api/anki/cards
 * @desc     Anki 题卡读 + 写路径：
 *           - GET   ?scope=&part=            列表读取 → 当季该 part 的卡（无卡回默认卡、part2 带 part3 成组、
 *             已排序，见 0034 get_anki_cards）。无副作用、仅鉴权。
 *           - POST  { questionId, corpusId }  存对子/绑语料 → upsert 卡行(绑 corpus_id、generated_answer 先 null)
 *             + 入队生成；已绑非空语料 → 409（一题一语料，重复存对子）。
 *           - PATCH { questionId, idx, en }  逐点存编辑 → 把第 idx 点的英文例句改写并入 edited_answer 稀疏
 *             覆盖数组（分点式 v0.3；en 空串 = 清该点覆盖回退生成/示范；part3 亦可，用户自填）。
 *
 *           为什么 POST 而非 GET 存对子：有副作用（扣额度 + 入队付费 AI 生成），与 phrases/matching 同口径。
 *           鉴权：requireUser（注册专属：Anki 卡是跨天 SRS 资产、档位依赖用户目标分，匿名不适用）；同意闸 + 计次在入队【之前】
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
import { getCardCorpusBinding, patchEditedPoint } from '@/lib/db/anki-cards-server'
import { listAnkiCards, type AnkiListScope } from '@/lib/anki/list'
import { requireRegistered, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { REG_ANKI_DAILY_LIMIT } from '@/lib/constants'

/** 取 body 里的字符串字段并去空白；非字符串/缺省一律回退空串（下游按空串统一 400）。 */
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** GET：列出当季某 part 的 Anki 卡。scope 缺省 all、part 缺省 1；非法值 400。 */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireRegistered(req)
    const { searchParams } = new URL(req.url)

    // scope ∈ {all, answered}，缺省 all。
    const scopeRaw = searchParams.get('scope') ?? 'all'
    if (scopeRaw !== 'all' && scopeRaw !== 'answered') {
      return NextResponse.json({ error: 'scope 仅支持 all / answered' }, { status: 400 })
    }
    const scope: AnkiListScope = scopeRaw

    // part ∈ {1, 2}，缺省 1（part3 不作独立入口、随 part2 成组）。
    const partRaw = searchParams.get('part') ?? '1'
    if (partRaw !== '1' && partRaw !== '2') {
      return NextResponse.json({ error: 'part 仅支持 1 / 2' }, { status: 400 })
    }
    const part: 1 | 2 = partRaw === '2' ? 2 : 1

    const cards = await listAnkiCards(userId, part, scope)
    return NextResponse.json({ cards })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[anki cards GET]', e)
    return NextResponse.json({ error: '读取题卡失败' }, { status: 500 })
  }
}

/** POST：存对子/绑语料。 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireRegistered(req)
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

    // 服务端硬防线：计次在入队（→ 付费 AI）之前。注册专属功能，超熔断 → 429。
    const dailyCount = await bumpDailyUsageServer(userId, 'anki')
    if (dailyCount > REG_ANKI_DAILY_LIMIT) {
      return NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })
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

/** PATCH：逐点存编辑（改 edited_answer 稀疏覆盖；part3 亦可）。无 AI 副作用 → 仅鉴权，不走同意/计次。 */
export async function PATCH(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireRegistered(req)
    const body = (await req.json().catch(() => ({}))) as { questionId?: unknown; idx?: unknown; en?: unknown }
    const questionId = str(body.questionId)
    if (!questionId) return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
    // idx 须为非负整数（对齐 focusPoints 顺序）；越界的 idx 交由渲染层忽略（存了也不会被合并渲染）。
    if (typeof body.idx !== 'number' || !Number.isInteger(body.idx) || body.idx < 0) {
      return NextResponse.json({ error: 'idx 必须为非负整数' }, { status: 400 })
    }
    // en 允许为空串（清该点覆盖、回退到生成/示范/空点态）；仅要求是字符串。
    if (typeof body.en !== 'string') {
      return NextResponse.json({ error: '缺少 en' }, { status: 400 })
    }
    await patchEditedPoint(userId, questionId, body.idx, body.en)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[anki cards PATCH]', e)
    return NextResponse.json({ error: '存编辑失败' }, { status: 500 })
  }
}
