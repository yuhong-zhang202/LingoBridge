/**
 * @module   api/corpus
 * @desc     POST 创建一段新语料 —— 服务端强制故事月额度并落库（客户端直连 insert 可绕过额度，故搬服务端）。
 *           鉴权 + 配额照 /api/practice 模式：requireUser → 超额 402(QUOTA_EXCEEDED) → createCorpusServer。
 *           仅创建这一步服务端化；后续 updateCorpusCleaned / upsertMatch / 跳转仍走客户端 RLS。
 *
 *   【cleanedText / summary 为什么能一起传（2026-08-27）】文字路径跳过 `/restructure` 整理确认页后，
 *   整理结果在客户端手里却没有页面去写它。拆成「先建语料、跳转、再补写」会在慢网下让匹配页
 *   先挂载并撞 400（只在慢网出现、本地测不出），故建语料这一次请求里原子写完。详见 createCorpusServer 顶注。
 * @author   LingoBridge
 * @created  2026-07-12
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { requireUserAllowAnon, authErrorResponse } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { logEvent } from '@/lib/events'
import { isQaRequest } from '@/lib/qa-traffic'
import { countCorpusThisMonthServer, countCorpusForUserServer, createCorpusServer } from '@/lib/db/corpus-server'
import { isInternalAccount } from '@/lib/internal-accounts'
import { STORY_MONTHLY_LIMIT } from '@/lib/db/corpus'
import { ANON_CORPUS_LIMIT, MIN_CORPUS_CHARS } from '@/lib/constants'
import { isTooShortForCorpus } from '@/lib/utils'
import type { CorpusSource } from '@/lib/types'

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    // 同意闸硬前置：故事落库是「原文进系统、后续各 AI 出口取用」的咽喉。未捕获当前版本同意 → 403，
    // 从纵深封死「脚本绕过前端弹窗直灌语料、再走下游 AI 外发」的路径。
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied
    const body = (await req.json()) as { source?: unknown; rawText?: unknown; cleanedText?: unknown; summary?: unknown }
    const source: CorpusSource = body.source === 'text' ? 'text' : 'voice'
    const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : ''
    // 整理结果为可选：非字符串一律当没传（语音路径不传，由整理页照旧走 updateCorpusCleaned）。
    // 这里不做长度/内容校验 —— 它是 /api/restructure 刚产出的东西，服务端再判一次「像不像整理结果」
    // 只会引入第二把尺；真正的入库门槛是下面对 rawText 的薄素材拦截。
    const cleanedText = typeof body.cleanedText === 'string' ? body.cleanedText : undefined
    const summary = typeof body.summary === 'string' ? body.summary : undefined
    if (!rawText) {
      return NextResponse.json({ error: 'rawText 不能为空' }, { status: 400 })
    }
    // 源头门槛兜底（唯一入库收口）：POST 只用于【新建】，故此处拦下薄素材不会误伤旧短语料
    // （编辑 / 重匹配走 updateCorpusCleaned、天然跳过本端点）。防一切绕过客户端预检与 restructure 的直灌。
    if (isTooShortForCorpus(rawText)) {
      return NextResponse.json({ error: `内容太少，请至少写满 ${MIN_CORPUS_CHARS} 字`, code: 'CORPUS_TOO_SHORT' }, { status: 400 })
    }

    // 额度服务端强制：超额返回 402 + code=QUOTA_EXCEEDED，客户端据此弹配额提示。
    // reason 透传「拦的是哪道闸」，供前端确定性选 QuotaReached 变体（不再靠前端异步推 isAnon 竞态）：
    //   匿名总条数闸 → reason:'trial'（引导注册）；注册月额度闸 → reason:'story'（月额度用完）。
    // reason 值即 QuotaReached variant，1:1 对应；message 保持两条不同文案不变。
    if (isAnonymous) {
      const total = await countCorpusForUserServer(userId)
      if (total >= ANON_CORPUS_LIMIT) {
        return NextResponse.json({ error: '试用已完成，请注册后继续', code: 'QUOTA_EXCEEDED', reason: 'trial' }, { status: 402 })
      }
    } else {
      const used = await countCorpusThisMonthServer(userId)
      // 内部账户豁免故事月额度（仅对 INTERNAL_ACCOUNT_IDS 生效，普通用户口径不变）。
      if (!isInternalAccount(userId) && used >= STORY_MONTHLY_LIMIT) {
        return NextResponse.json({ error: '本月故事额度已用完', code: 'QUOTA_EXCEEDED', reason: 'story' }, { status: 402 })
      }
    }

    const corpus = await createCorpusServer(userId, { source, rawText, cleanedText, summary })
    // 埋点 flow.corpus_bound：这一刻 story_id（corpus.id）诞生 = 一个真实故事诞生，是「真实故事数」这个
    // 分母的定义点；同时把此前只有 flow_id 的 ASR/整理环节与 story_id 接上（全链路 join 的桥）。
    // logEvent 内部已吞异常，不阻断创建返回。
    await logEvent({
      event: 'flow.corpus_bound',
      flowId: req.headers.get('x-flow-id'),
      storyId: corpus.id,
      userId,
      props: { source },
      // 漏斗末级 D5 就靠这条：漏了 is_qa，产品方自测建的故事会算进真实转化率里，末级整段作废
      isQa: isQaRequest(req, userId),
    })
    return NextResponse.json({ corpus })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[corpus API]', e)
    return NextResponse.json({ error: '保存语料失败' }, { status: 500 })
  }
}
