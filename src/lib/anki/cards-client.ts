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
 * 拉当季某 part 的题卡列表。
 * @param  part   1 或 2（part3 随 part2 成组）
 * @param  scope  'all' 全部 / 'answered' 仅已回答
 * @returns       卡列表
 * @throws        Error —— 非 2xx 或网络失败
 */
export async function fetchAnkiCards(part: 1 | 2, scope: AnkiListScope): Promise<AnkiCard[]> {
  const res = await apiFetch(`/api/anki/cards?part=${part}&scope=${scope}`, { method: 'GET' })
  if (!res.ok) throw new Error(`读取题卡失败（${res.status}）`)
  const data = (await res.json()) as { cards?: AnkiCard[] }
  return data.cards ?? []
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
