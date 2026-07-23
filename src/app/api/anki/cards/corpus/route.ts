/**
 * @module   api/anki/cards/corpus
 * @desc     Anki 题卡语料绑定的换 / 删（方案 §11 自动重生成红线）：
 *           - PUT    { questionId, corpusId }  换语料 → 改 corpus_id + 清空 generated_answer（旧答案必错配）
 *             + 重排队生成（改指在途任务 / 无则新入队）。
 *           - DELETE { questionId }            删对子/unbind → corpus_id 置 null + 清空 generated_answer
 *             （卡退化为「分析卡」/真相源），撤在途任务；不删卡行、保留 SRS 进度。
 *
 *           为什么换语料要清 generated_answer + 重排队：换语料 = 新语料源，旧 generated_answer 必错配。
 *           §11 拍板「换语料 = 自动重生成」（与「禁手动重生成按钮」不矛盾）。清空 + 重排队的 job 处理细节
 *           见 anki-cards-server.ts（在途任务快照 corpus_id、部分唯一索引令裸 enqueue 无法可靠重排队）。
 *           PUT 走同意闸 + 防脚本滥用限流（换语料不计【存对子】配额——产品方拍板；仍触发付费 AI 重生成，
 *           故保留同意闸，并加独立 kind='anki_swap' 的宽松熔断防机器滥用，见 REG_ANKI_SWAP_DAILY_LIMIT）；DELETE 仅鉴权。
 *           鉴权：requireRegistered（注册专属，显式拒匿名，与存对子/复习同口径）。
 * @author   LingoBridge
 * @created  2026-07-23
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getQuestionById } from '@/lib/db/questions'
import { bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { swapAnkiCorpus, unbindCorpus } from '@/lib/db/anki-cards-server'
import { requireRegistered, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { REG_ANKI_SWAP_DAILY_LIMIT } from '@/lib/constants'

/** 取 body 里的字符串字段并去空白；非字符串/缺省一律回退空串。 */
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** PUT：换语料（清 generated_answer + 重排队生成）。 */
export async function PUT(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireRegistered(req)
    // 同意闸硬前置：重生成会令 drain 把新语料发往千问。未捕获当前版本同意 → 403，绝不重排队。
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied

    const body = (await req.json().catch(() => ({}))) as { questionId?: unknown; corpusId?: unknown }
    const questionId = str(body.questionId)
    const corpusId = str(body.corpusId)
    if (!questionId) return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
    if (!corpusId) return NextResponse.json({ error: '缺少 corpusId' }, { status: 400 })

    // 越权防护：新语料须属本人。题目须存在（RPC 的 FK 也会拒，这里早退给干净 404）。
    await assertCorpusOwner(userId, corpusId)
    const q = await getQuestionById(questionId)
    if (!q) return NextResponse.json({ error: '题目不存在' }, { status: 404 })

    // 防脚本滥用限流（≠ 用户配额）：换语料不扣「存对子的 50 额度」（产品方拍板 2026-07-23），但每次仍触发
    // 付费 AI 重生成，零闸门时单账号可脚本无限烧钱。故走【独立 kind='anki_swap'、宽松高阈值 200/天】的熔断，
    // 与 'anki' 存对子额度互不相干；正常用户反复改稿换语料一天也碰不到，超限才 429（详见常量注释）。
    const swapCount = await bumpDailyUsageServer(userId, 'anki_swap')
    if (swapCount > REG_ANKI_SWAP_DAILY_LIMIT) {
      return NextResponse.json({ error: '今日换语料次数过多，请稍后再试' }, { status: 429 })
    }

    // §11 红线（单事务原子，见 swapAnkiCorpus / 0035）：清空旧 generated_answer + 改指新语料 +
    // 在途任务改指新语料 + 兜底入队。RPC 内含入队，此处不再单独调 enqueue。
    const cardId = await swapAnkiCorpus(userId, questionId, corpusId)
    return NextResponse.json({ cardId })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[anki cards corpus PUT]', e)
    return NextResponse.json({ error: '换语料失败' }, { status: 500 })
  }
}

/** DELETE：删对子/unbind（corpus_id 置 null + 清空 generated_answer，保留 SRS 进度）。仅鉴权。 */
export async function DELETE(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireRegistered(req)
    const body = (await req.json().catch(() => ({}))) as { questionId?: unknown }
    const questionId = str(body.questionId)
    if (!questionId) return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
    // §11 红线（单事务原子，见 unbindCorpus / 0035）：清空 generated_answer + 撤在途任务，防旧语料答案回填令已清空的背面复活。
    await unbindCorpus(userId, questionId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[anki cards corpus DELETE]', e)
    return NextResponse.json({ error: '删语料失败' }, { status: 500 })
  }
}
