/**
 * @module   anki/cards-client
 * @desc     【客户端】Anki 题卡读写的 fetch 帮手：列表 / SRS 复习 / 逐点编辑。经 apiFetch 自动带鉴权头，
 *           只负责调接口 + 收敛错误为抛异常，供 review 宿主页与题卡组件调用（不含 UI 状态）。
 * @author   LingoBridge
 * @created  2026-07-24
 */
'use client'
import { apiFetch } from '@/lib/api-client'
import type { AnkiCard, AnkiListScope } from '@/lib/anki/list'
import type { QuestionAnalysis } from '@/lib/types'

/**
 * 携带 HTTP 状态码的题卡拉取错误。宿主页据 status 分流：401 → 注册引导态（登录后查看你的题卡）；
 * 其余（500 / 网络）→「加载失败 + 重试」。别只把 status 拼进 message 字符串，那样宿主无法可靠判别。
 */
export class AnkiFetchError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'AnkiFetchError'
    this.status = status
  }
}

/**
 * 拉当季某 part 的题卡列表。
 * @param  part   1 或 2（part3 随 part2 成组）
 * @param  scope  'all' 全部 / 'answered' 仅已回答
 * @returns       卡列表
 * @throws        AnkiFetchError —— 非 2xx（带 status）；网络失败 status 记 0
 */
export async function fetchAnkiCards(part: 1 | 2, scope: AnkiListScope): Promise<AnkiCard[]> {
  let res: Response
  try {
    res = await apiFetch(`/api/anki/cards?part=${part}&scope=${scope}`, { method: 'GET' })
  } catch (e) {
    // 网络层失败（离线/超时）：status 记 0，宿主按「非 401」走加载失败 + 重试。
    throw new AnkiFetchError(e instanceof Error ? e.message : '网络异常', 0)
  }
  if (!res.ok) throw new AnkiFetchError(`读取题卡失败（${res.status}）`, res.status)
  const data = (await res.json()) as { cards?: AnkiCard[] }
  return data.cards ?? []
}

/**
 * 批量懒加载题目分析（列表不再随行下发 analysis，见 anki/list.ts mapRow ⚠️）。牌堆页按滑动窗口预取当前
 * 及邻近几张，翻面前数据已就位、感知为零。返回 { questionId: analysis }，无分析的题不在映射里。
 * @param  questionIds  要拉的题 id（空则不打接口、直接回 {}）
 * @returns             命中题的 analysis 映射；网络/非 2xx 时抛 AnkiFetchError
 */
export async function fetchCardAnalyses(questionIds: string[]): Promise<Record<string, QuestionAnalysis>> {
  if (questionIds.length === 0) return {}
  let res: Response
  try {
    res = await apiFetch(`/api/anki/analysis?questionIds=${encodeURIComponent(questionIds.join(','))}`, { method: 'GET' })
  } catch (e) {
    throw new AnkiFetchError(e instanceof Error ? e.message : '网络异常', 0)
  }
  if (!res.ok) throw new AnkiFetchError(`读取题目分析失败（${res.status}）`, res.status)
  const data = (await res.json()) as { analyses?: Record<string, QuestionAnalysis> }
  return data.analyses ?? {}
}

/** 题库速览 Hero 概况（服务端算好的几个计数 + 一句样本，替代「拉全部卡再前端派生」）。 */
export interface AnkiSummary {
  /** 当季全部可刷卡片总数（含 part3 子卡）= review「全部」牌堆张数 */
  seasonCount: number
  /** 已答主卡里到期张数（口径同 Hero「待复习」） */
  dueCount: number
  /** 当季已绑语料且已答的对子数（供语料匹配 tab 徽标基数） */
  pairCount: number
  /** 样本题面（已答首题优先，否则当季首题）；当季真 0 题为 null */
  sample: { part: 1 | 2 | 3; text: string } | null
}

/**
 * 拉题库速览 Hero 概况。服务端一次算好 4 个数只回 ~200 字节，替代旧「fetchAnkiCards(1)+fetchAnkiCards(2)
 * 拉全部 ~1.3MB 再前端 .length/.filter」的浪费（见 GET /api/anki/summary）。
 * @returns  概况；非 2xx / 网络失败抛 AnkiFetchError
 */
export async function fetchAnkiSummary(): Promise<AnkiSummary> {
  let res: Response
  try {
    res = await apiFetch('/api/anki/summary', { method: 'GET' })
  } catch (e) {
    throw new AnkiFetchError(e instanceof Error ? e.message : '网络异常', 0)
  }
  if (!res.ok) throw new AnkiFetchError(`读取题卡概况失败（${res.status}）`, res.status)
  return (await res.json()) as AnkiSummary
}

/** 换语料弹窗对比用的语料摘要（当前已绑语料）。 */
export interface CorpusBrief {
  id: string
  summary: string | null
}

/**
 * 存对子（POST /api/anki/cards）的分流结果——把状态码差异收敛成判别联合，
 * 让匹配页 / 整理页调用点按 kind 分支（弹注册引导 / 换语料弹窗 / 熔断提示 / 通用失败），不各自重解析。
 */
export type SavePairResult =
  | { ok: true }
  | { ok: false; kind: 'anon' }                       // 401：匿名点存 → 注册引导
  | { ok: false; kind: 'bound'; currentCorpus: CorpusBrief } // 409：该题已绑别的语料 → 换语料弹窗
  | { ok: false; kind: 'limit' }                      // 429：当日存对子次数上限
  | { ok: false; kind: 'error' }                      // 其余（500 / 网络 / 解析失败）

/**
 * 【雅思流自动存对子】把 saveAnkiPair 的结果翻译成"页面该怎么办"。
 *
 *   🔴 这个函数存在的唯一理由：**自动流程与手动流程对失败的处置必须相反**。
 *     - 手动（用户自己点书签存对子）：失败要告诉他 —— 匿名弹注册引导、超额弹 toast、出错弹 toast。
 *       他主动要了这件事，没成必须让他知道。
 *     - 自动（雅思流点「开始分析」顺带存）：**失败一律不许出声、更不许阻断跳转**。
 *       他点的是「开始分析」，存对子是我们替他做的副作用；因为一个他没要求的东西
 *       把他卡在整理页、或者弹一个他看不懂的注册框，是拿我们的便利去打断他的正事。
 *
 *   ⚠️ 唯一的例外是 'bound'（同一道题已有别的语料当答案）：Anki 卡是 (user_id, question_id) 唯一，
 *     一道题只能有一个背面。近 60 天 317 组配对里 22 组撞这个 —— 静默选哪边都会一半时候错：
 *     覆盖是丢数据，保留是无视用户刚写的新答案。**只有这一种要问人。**
 *
 * @param pair saveAnkiPair 的结果；null = 调用本身抛了异常（网络等）
 * @returns    'conflict' = 弹换语料对比框、暂不跳转；'saved' = 存上了；'skip' = 静默略过，照常跳转
 */
export function autoPairOutcome(pair: SavePairResult | null): 'conflict' | 'saved' | 'skip' {
  if (!pair) return 'skip'
  if (pair.ok) return 'saved'
  return pair.kind === 'bound' ? 'conflict' : 'skip'
}

/**
 * 存对子：把 (questionId, corpusId) 绑成题卡并入队生成。
 * @param  questionId  题目 id
 * @param  corpusId    语料 id
 * @returns            判别联合结果（见 SavePairResult）
 */
export async function saveAnkiPair(questionId: string, corpusId: string): Promise<SavePairResult> {
  let res: Response
  try {
    res = await apiFetch('/api/anki/cards', { method: 'POST', json: { questionId, corpusId } })
  } catch {
    return { ok: false, kind: 'error' }
  }
  if (res.ok) return { ok: true }
  if (res.status === 401) return { ok: false, kind: 'anon' }
  if (res.status === 429) return { ok: false, kind: 'limit' }
  if (res.status === 409) {
    try {
      const body = (await res.json()) as { currentCorpus?: { id?: unknown; summary?: unknown } }
      const c = body.currentCorpus
      const id = typeof c?.id === 'string' ? c.id : ''
      const summary = typeof c?.summary === 'string' ? c.summary : null
      if (id) return { ok: false, kind: 'bound', currentCorpus: { id, summary } }
    } catch {
      /* 落到通用失败 */
    }
    return { ok: false, kind: 'error' }
  }
  return { ok: false, kind: 'error' }
}

/**
 * 换语料【客户端】：把某题的题卡改绑新语料（PUT /api/anki/cards/corpus，清旧答案 + 重排队生成）。
 * 命名带 Client 后缀，与服务端同名原子操作 `@/lib/db/anki-cards-server` 的 `swapAnkiCorpus`（返 cardId）区分，
 * 避免两处同名混淆——本函数只发请求、收敛为 boolean 供调用方 toast。
 * @param  questionId  题目 id
 * @param  corpusId    新语料 id
 * @returns            是否成功（失败交调用方 toast 通用文案）
 */
export async function swapAnkiCorpusClient(questionId: string, corpusId: string): Promise<boolean> {
  try {
    const res = await apiFetch('/api/anki/cards/corpus', { method: 'PUT', json: { questionId, corpusId } })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 提交一次 SRS 复习评级。
 * @param  questionId  题目 id
 * @param  remembered  是否记住（右滑/熟知=true）
 * @throws             Error —— 非 2xx 或网络失败
 */
export async function gradeAnkiCard(questionId: string, remembered: boolean): Promise<void> {
  const res = await apiFetch('/api/anki/cards/review', { method: 'POST', json: { questionId, remembered } })
  if (!res.ok) throw new Error(`复习更新失败（${res.status}）`)
}

/**
 * 逐点保存卡背英文编辑（en 空串 = 清该点覆盖、回退到生成/示范）。
 * @param  questionId  题目 id
 * @param  idx         点序号（对齐 focusPoints）
 * @param  en          覆盖英文（空串 = 清除）
 * @throws             Error —— 非 2xx 或网络失败
 */
export async function patchAnkiPoint(questionId: string, idx: number, en: string): Promise<void> {
  const res = await apiFetch('/api/anki/cards', { method: 'PATCH', json: { questionId, idx, en } })
  if (!res.ok) throw new Error(`保存编辑失败（${res.status}）`)
}
