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
