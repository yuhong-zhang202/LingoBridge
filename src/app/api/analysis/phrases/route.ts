/**
 * @module   api/analysis/phrases
 * @desc     POST { questionId, storyId?, story?, level? } → 只按目标雅思水平重出「可用词组」
 *
 *           为什么是 POST 而不是 GET：本接口有副作用——扣每日额度 + 真实调用付费 AI。
 *           GET 在 HTTP 语义上被视为安全/可缓存，浏览器预取、爬虫、链接预览、代理预热都会
 *           自行发起 GET，那些无意的请求会直接烧掉 AI 调用费。与 /api/analysis 同口径。
 *
 *           缓存（2026-08-04 补）：与 /api/analysis 共用 corpus_question_analyses 同一张表、同一套
 *           三重命中口径（键(corpus_id,question_id) + season + content_hash，level 折进 hash）。
 *           动机是客户端换档重试：服务端已生成但响应在网上丢了的那次已把结果写进缓存，重试即读档秒回、
 *           不再重花一次 AI 费（生产实证 2026-08-02 用户反馈）。
 * @author   LingoBridge
 * @created  2026-06-07
 */
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getQuestionById } from '@/lib/db/questions'
import { getPersonalAnalysis, upsertPersonalAnalysis } from '@/lib/db/question-analyses'
import { getCorpusByIdServer, bumpDailyUsageServer } from '@/lib/db/corpus-server'
import { generatePhrases } from '@/services/analysis'
import { logApiUsage, qwenPlusCostCny } from '@/lib/api-logger'
import { errorLogMeta, errorKindMeta } from '@/types/errors'
import type { LLMUsage } from '@/lib/llm'
import type { AnalysisPhraseGroup, QuestionAnalysis } from '@/lib/types'
import { requireUserAllowAnon, assertCorpusOwner, authErrorResponse } from '@/lib/api-auth'
import { requireConsent } from '@/lib/consent-server'
import { runWithRawLogContext } from '@/lib/raw-log-context'
import { ANON_PHRASES_LIMIT, REG_PHRASES_DAILY_LIMIT } from '@/lib/constants'
// 缓存口径与 /api/analysis 共用一份（同表同哈希，差一字节就互相永不命中且静默）。详见 analysis-cache 顶注。
import { sanitizeLevel, contentHashOf, hashMatchesStoryAnyLevel } from '@/lib/analysis-cache'

/** 请求体形状：字段来源同旧版 query string，仅传输位置从 URL 改为 body。 */
interface PhrasesRequestBody {
  questionId?: unknown
  storyId?: unknown
  /** 故事正文兜底：DB 读不到 storyId 对应语料时用它（历史上由 URL 携带，现随 body 走） */
  story?: unknown
  level?: unknown
}

/** 取 body 里的字符串字段；非字符串/缺省一律回退空串（与旧版 searchParams.get() ?? '' 同语义）。 */
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * 缓存回填：本路由只产 phrases，凑不出整份 analysis，故【绝不整行覆盖】——覆盖会把 /api/analysis 的缓存
 * 写成半份（无 structureLabel/focusPoints），下次分析页命中就渲染出一个没有「答题侧重点」的页面。
 * 改为【合并写】：沿用已存行的骨架（structureLabel/focusPoints）+ 本次新档词组。
 * 两道硬门缺一不可，任一不满足就直接不写（宁可不缓存，不可写脏）：
 *   1) 已存行 season 与题目当前 season 一致 —— 换季后的旧骨架不再沿用（对齐 0049 三重失效）；
 *   2) 已存行的 content_hash 确由【当前语料正文】生成（档位不限，见 hashMatchesStoryAnyLevel）——
 *      骨架与 level 无关但与故事强相关，用户改过故事后骨架已过期，配上新词组写回会让 /api/analysis
 *      命中一份「旧故事的侧重点」，正是 0049 迁移头点名的正确性红线。
 * 写失败吞掉、只 logErr，绝不因回填失败把已成功的请求变 500（与 /api/analysis 的 writeAnalysisCache 同口径）。
 * @param  corpusId   语料 id（storyId，真实 corpus）
 * @param  questionId 题 id
 * @param  season     题目当前季度
 * @param  storyHash  本次（当前正文 + 本次档位）的 content_hash
 * @param  existing   已存缓存行（null=无行，直接不写）
 * @param  story      当前喂给 AI 的语料正文
 * @param  phrases    本次新生成的词组
 * @sideEffect        满足两道门时 upsert 一行 corpus_question_analyses
 */
async function mergeWritePhrasesCache(a: {
  corpusId: string; questionId: string; season: string; storyHash: string
  existing: { analysis: QuestionAnalysis; season: string; contentHash: string } | null
  story: string; phrases: AnalysisPhraseGroup[]
}): Promise<void> {
  const row = a.existing
  if (!row) return
  if (row.season !== a.season) return
  if (!hashMatchesStoryAnyLevel(row.contentHash, a.story)) return
  const merged: QuestionAnalysis = {
    structureLabel: row.analysis.structureLabel,
    focusPoints: row.analysis.focusPoints,
    phrases: a.phrases,
  }
  try {
    await upsertPersonalAnalysis(a.corpusId, a.questionId, a.season, a.storyHash, merged)
  } catch (e) {
    logErr('[phrases API] 个性化缓存写失败，忽略', e)
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now()
  try {
    const { userId, isAnonymous } = await requireUserAllowAnon(req)
    // 同意闸硬前置：换词组会把用户故事全文发往千问。未捕获当前版本同意 → 403，绝不外发。
    const consentDenied = await requireConsent(userId)
    if (consentDenied) return consentDenied
    // body 解析容错：非法/空 JSON 视作空对象，交由下面的 questionId 校验统一回 400
    // （而不是让 req.json() 抛进 catch、白记一条 error 账）。
    const body = await req.json().catch(() => ({})) as PhrasesRequestBody
    const questionId = str(body.questionId)
    const storyId    = str(body.storyId)
    const storyUrl   = str(body.story) || undefined
    // 收敛到档位枚举（与 /api/analysis 同口径）：level 既直插 prompt 又折进缓存 hash，放任自由字符串
    // 既能顶满单次 token 成本，又会把缓存键打成一人一花色、与分析页写的行永不互通。
    const level      = sanitizeLevel(body.level)
    if (!questionId) {
      return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
    }
    // 越权防护：storyId 属他人语料则 403（storyId 缺省时走通用词组，无需校验）
    if (storyId) await assertCorpusOwner(userId, storyId)

    // 服务端硬防线：计次在任何 AI 调用之前——超额时不产生任何 AI 费用。
    // 与 /api/analysis 同理（可反复调），位置同样选在入参校验后、读故事/取题之前。
    // 匿名超上限 → 402(QUOTA_EXCEEDED)；注册超熔断上限 → 429（不带 code，不触发配额弹层）。与 practice 同范式。
    const dailyCount = await bumpDailyUsageServer(userId, 'phrases')
    if (isAnonymous ? dailyCount > ANON_PHRASES_LIMIT : dailyCount > REG_PHRASES_DAILY_LIMIT) {
      return isAnonymous
        ? NextResponse.json({ error: '试用次数已用完，请注册后继续', code: 'QUOTA_EXCEEDED' }, { status: 402 })
        : NextResponse.json({ error: '今日使用次数已达上限，请明天再试' }, { status: 429 })
    }

    let story: string | undefined
    try {
      const dbStory = storyId ? await getCorpusByIdServer(storyId) : null
      story = dbStory ?? storyUrl
    } catch {
      story = storyUrl
    }

    const q = await getQuestionById(questionId)
    if (!q) {
      return NextResponse.json({ error: '题目不存在' }, { status: 404 })
    }

    // ── 个性化词组缓存（与 /api/analysis 同表 corpus_question_analyses、同三重命中口径）──
    // 可缓存判定逐条照搬分析路由：story 非空 + storyId 真实 corpus + part1/2。通用（无语料）路径不缓存。
    const canCachePersonal = !!story && !!storyId && (q.part === 1 || q.part === 2)
    const storyHash = canCachePersonal && story ? contentHashOf(story, level) : ''

    // 读命中：键(corpus_id,question_id) + season 一致 + content_hash 一致（level 已折进 hash → 换档必不命中，
    // 绝不串档返回别的档位词组）。读彻底降级：任何查询错一律静默当未命中、走真实 AI，绝不 500。
    let existing: { analysis: QuestionAnalysis; season: string; contentHash: string } | null = null
    let cachedPhrases: AnalysisPhraseGroup[] | null = null
    if (canCachePersonal) {
      try {
        existing = await getPersonalAnalysis(storyId, q.id)
        if (existing && existing.season === q.season && existing.contentHash === storyHash) {
          // 空词组不算命中：宁可重算一次，也不把一份空板块当结果返回（缓存里理论上不该有，防御性判）
          const p = existing.analysis?.phrases
          if (Array.isArray(p) && p.length > 0) cachedPhrases = p
        }
      } catch (e) {
        logErr('[phrases API] 个性化缓存读失败，降级为未命中', e)
        existing = null
      }
    }
    if (cachedPhrases) {
      // 命中：不调 AI → 不写 api_usage_logs（写了会往成本看板里灌一条没花钱的账，与 /api/analysis 命中分支同口径）。
      // bumpDailyUsageServer 已在前面无条件扣过次：与 /api/analysis 命中也照扣一致，且它是防刷闸不是计费闸。
      return NextResponse.json({ phrases: cachedPhrases })
    }

    const enForAI = q.question_text
    // corpusId 取 storyId（有则带、无则 null）：留证可回溯到具体语料。
    // 优先记模型真实 usage；模型没吐 usage 才回退到按题目长度的估算。
    // onUsage 在服务内部同步触发（callLLMJson 返回前回调），await 结束后 realUsage 已落值。
    let realUsage: LLMUsage | null = null
    const phrases = await runWithRawLogContext({ userId, corpusId: storyId || null }, () =>
      generatePhrases({ part: q.part, en: enForAI, zh: q.question_text_zh, story, level }, (u) => { realUsage = u }),
    )
    const usage: LLMUsage = realUsage ?? { promptTokens: Math.round(enForAI.length * 0.3 + 500), completionTokens: 300 }
    // is_anonymous 自 2026-08-07 起补写（此前漏传、落库为 NULL，让看板「匿名 vs 登录成本占比」两侧都漏算）。
    // 只修【将来】的数据：历史行仍是 NULL、不追溯改写；看板对历史 NULL 行的处理见 aggregateUserCosts 顶注
    //（有 user_id 就按该用户【当前】身份归类，NULL 不参与判断）。该字段只是「调用那一刻的身份」快照，
    // 不能拿来判「这个人现在是谁」——转化用户 user_id 不变 + 绑邮箱后 stale JWT。
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: usage.promptTokens + usage.completionTokens, usage_unit: 'tokens', estimated_cost_cny: qwenPlusCostCny(usage.promptTokens, usage.completionTokens), latency_ms: Date.now() - t0, status: 'success', user_id: userId, is_anonymous: isAnonymous, corpus_id: storyId || undefined, metadata: { phase: 'phrases', level, prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, cost_source: realUsage ? 'actual' : 'estimate' } })
    // 回填（合并写，两道硬门见 mergeWritePhrasesCache）：这一步正是「响应丢了、重试秒回」成立的前提——
    // 响应即使在网上丢了，结果也已落库，用户重试读档即得。
    if (canCachePersonal && story) {
      await mergeWritePhrasesCache({ corpusId: storyId, questionId: q.id, season: q.season, storyHash, existing, story, phrases })
    }
    return NextResponse.json({ phrases })
  } catch (e) {
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    // 失败行补 phase（与成功分支同值 'phrases'），避免空 metadata 掉进看板 other 桶、辨不出环节。
    // 此处只接 AI/系统故障（缺 questionId、题目不存在在前面已 400/404 早退），故不补 error_kind。
    await logApiUsage({ service: 'qwen_plus', endpoint: 'dashscope/v1/chat/completions', usage_amount: 0, usage_unit: 'tokens', estimated_cost_cny: 0, latency_ms: Date.now() - t0, status: 'error', metadata: { phase: 'phrases', ...errorLogMeta(e), ...errorKindMeta(e) } })
    logErr('[phrases API]', e)
    return NextResponse.json({ error: '生成词组失败' }, { status: 500 })
  }
}
