/**
 * @module   db/anki-cards-server
 * @desc     【仅服务端】Anki 题卡写路径的 DB 帮手 —— 存对子冲突判定、换/删语料（清 generated_answer + 处理
 *           在途生成任务）、SRS 复习懒物化 upsert、存编辑。均经 service_role 直连（绕 RLS），故调用方须先
 *           requireUser 反查 userId 并以之为 (user_id) 过滤，越权防护落在应用层（与 corpus-server 同范式）。
 *
 *   为什么换/删语料要显式动 anki_generation_jobs（方案 §11 正确性红线）：
 *     - anki_generation_jobs 在【入队时快照 corpus_id】（drain 按 job.corpus_id 取语料生成），且
 *       0031 的部分唯一索引 anki_gen_jobs_active_uidx 令「同题已有 pending/processing 任务时」再入队
 *       do-nothing。故换语料若只调 enqueue，旧任务仍指向旧语料、新语料永不生效；删语料若不清任务，
 *       在途任务会把旧语料答案回填、令「已清空的 generated_answer」复活。
 *     - 因此换语料 = 清空卡背 + 改指新语料 + 把在途任务改指新语料 + 兜底入队；删语料 = 清空卡背 +
 *       撤掉在途任务。这几步【必须在一个事务里原子完成】：多条独立 app 层 DML 中间失败会留下
 *       「卡背已清空、任务却指向旧语料/未撤」的半成品，正是 §11 要防的旧答案复活 / 卡背永久空白。
 *       故收敛为 0035 的 plpgsql RPC（swap_anki_corpus / unbind_anki_corpus，单事务），本层只做薄封装。
 *     - ⚠️ 残留窗口：任务已被 drain 领取（status='processing'、语料快照已在 worker 内存里）时，RPC 对
 *       DB 的改动拦不住那一次在途生成 —— 属极窄竞态（换/删恰好撞上生成的秒级窗口），交由 red-team /
 *       drain 侧（任务版本号 / 取消令牌）后续收口，不在本轮端点内解决。
 * @author   LingoBridge
 * @created  2026-07-23
 */
import 'server-only'
import { getSupabaseServer } from '@/lib/supabase-server'
import { nextBox, nextDue } from '@/lib/srs'
import { parseEditOverrides, applyEditOverride, serializeEditOverrides } from '@/lib/anki/answer-points'

/** 存对子冲突判定所需的当前绑定态。 */
export interface CardCorpusBinding {
  /** 卡行是否已存在（懒物化下可能从未落库）。 */
  exists: boolean
  /** 已绑定的语料 id；null = 卡行不存在或未绑语料（真相源/分析卡态）。 */
  corpusId: string | null
}

/**
 * 读某用户某题当前的卡行绑定态，供存对子端点判 409（已绑非空语料 = 重复存对子）。
 * @param  userId      requireUser 反查出的当前用户 id
 * @param  questionId  目标题目 id
 * @returns            { exists, corpusId }
 * @throws             Error —— 查询出错
 * @sideEffect         service_role 读 anki_cards（绕 RLS，须显式按 user_id 过滤）
 */
export async function getCardCorpusBinding(userId: string, questionId: string): Promise<CardCorpusBinding> {
  const { data, error } = await getSupabaseServer()
    .from('anki_cards')
    .select('corpus_id')
    .eq('user_id', userId)
    .eq('question_id', questionId)
    .maybeSingle()
  if (error) throw new Error(`读取卡行绑定失败：${error.message}`)
  if (data === null) return { exists: false, corpusId: null }
  return { exists: true, corpusId: (data as { corpus_id: string | null }).corpus_id }
}

/**
 * 换语料（方案 §11 自动重生成红线）——【单事务原子】：清空卡背 + 卡行改指新语料（懒物化下卡行不存在则
 * 物化插入）+ 在途任务改指新语料 + 兜底入队（同题已有 active 任务则 do-nothing）。这四步全部收敛进 0035
 * 的 swap_anki_corpus RPC，故本函数不再分多条 app 层 DML（旧实现 rebind + 单独 enqueue 非原子，中间失败
 * 会留下「卡背已清空、任务却指旧语料」的半成品）。RPC 内含入队，调用方【无需】再调 enqueueAnkiGeneration。
 * @param  userId       当前用户 id
 * @param  questionId   目标题目 id
 * @param  newCorpusId  新语料 id
 * @returns             卡行 id（供调用方回填/展示）
 * @throws              Error —— RPC 出错（part3 卡设非空 corpus_id 会被 0030 触发器拒绝，整事务回滚）
 * @sideEffect          service_role 调 swap_anki_corpus：原子 upsert anki_cards + 改/插 anki_generation_jobs（绕 RLS）
 */
export async function swapAnkiCorpus(userId: string, questionId: string, newCorpusId: string): Promise<string> {
  const { data, error } = await getSupabaseServer().rpc('swap_anki_corpus', {
    p_user_id: userId,
    p_question_id: questionId,
    p_corpus_id: newCorpusId,
  })
  if (error) throw new Error(`换语料失败：${error.message}`)
  return data as string
}

/**
 * 删对子 / unbind（方案 §6 回退分析 / §11 清 generated_answer）——【单事务原子】：卡行 corpus_id 置 null +
 * 清空 generated_answer（卡退化为「分析卡」/真相源，保留 SRS 进度）+ 撤掉在途生成任务（防旧语料答案回填令
 * 已清空的背面复活）。两步收敛进 0035 的 unbind_anki_corpus RPC，杜绝「卡背已清空、任务未撤」的半成品。
 * @param  userId      当前用户 id
 * @param  questionId  目标题目 id
 * @throws             Error —— RPC 出错
 * @sideEffect         service_role 调 unbind_anki_corpus：原子更新 anki_cards + 删 anki_generation_jobs 在途行（绕 RLS）
 */
export async function unbindCorpus(userId: string, questionId: string): Promise<void> {
  const { error } = await getSupabaseServer().rpc('unbind_anki_corpus', {
    p_user_id: userId,
    p_question_id: questionId,
  })
  if (error) throw new Error(`删语料失败：${error.message}`)
}

/** SRS 复习后的新状态（回给端点做响应/前端更新卡叠）。 */
export interface ReviewResult {
  box: number
  dueAt: string
}

/**
 * SRS 复习懒物化（方案 §11）：卡行可能从未落库（默认卡）→ 走 upsert on conflict (user_id, question_id)。
 * 新行按默认卡初值（box 1、corpus_id null）建、再套本次 review 结果；已有行只更新 SRS 字段
 * （box/due_at/last_reviewed_at），不碰 corpus_id/generated_answer/edited_answer。
 *
 * 【读后写非原子】先读当前 box 再算 nextBox：单用户点自己的卡、并发极低，可接受；不记住时 nextBox 恒回
 * box1（与当前值无关），记住时才依赖当前 box +1 封顶。
 * @param  userId      当前用户 id
 * @param  questionId  目标题目 id
 * @param  remembered  是否记住（右滑=true 升一格 / 左滑=false 回 box1）
 * @returns            { box, dueAt } 复习后的新盒子与下次到期
 * @throws             Error —— 读或 upsert 出错
 * @sideEffect         service_role upsert anki_cards（绕 RLS）
 */
export async function upsertReview(userId: string, questionId: string, remembered: boolean): Promise<ReviewResult> {
  const supabase = getSupabaseServer()
  const { data: existing, error: readErr } = await supabase
    .from('anki_cards')
    .select('box')
    .eq('user_id', userId)
    .eq('question_id', questionId)
    .maybeSingle()
  if (readErr) throw new Error(`读取卡行盒子失败：${readErr.message}`)
  const currentBox = (existing as { box: number } | null)?.box ?? 1
  const newBox = nextBox(currentBox, remembered)
  const now = new Date()
  const due = nextDue(newBox, now)
  // upsert 负载只含 SRS 字段：insert 时 corpus_id/generated_answer/edited_answer 取表默认（null），
  // 部分冲突时只更新这几列 —— 不覆盖已绑语料/已生成/已编辑内容。
  const { error: upErr } = await supabase
    .from('anki_cards')
    .upsert(
      {
        user_id: userId,
        question_id: questionId,
        box: newBox,
        due_at: due.toISOString(),
        last_reviewed_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: 'user_id,question_id' },
    )
  if (upErr) throw new Error(`复习更新失败：${upErr.message}`)
  return { box: newBox, dueAt: due.toISOString() }
}

/**
 * 逐点存编辑（方案 §1 · 分点式 v0.3）：把用户对第 idx 点行内改写的英文例句写进 edited_answer 的「稀疏覆盖数组」
 * [{idx,en}]（answer-points 定义、渲染层同源合并；不写回 generated_answer，保 AI 生成为纯真源、可逐点回退）。
 *   - en 去空白后非空 → 置/改该点覆盖；空串 → 清该点覆盖（回退到生成/示范/空点态）；
 *   - 全部覆盖被清空 → edited_answer 存空串（令 list.ts backKind 回落 generated/analysis，不再判 'edited'）。
 * part1/2/3 统一走本路径：part3 无 generated_answer，覆盖直接叠在静态示范例句上；edited_answer 不受 0030
 * part3 触发器约束。卡行可能尚未落库（懒物化）→ 走 read-modify-write + upsert on conflict。
 *
 * 【读后写非原子】先读当前 edited_answer 再合并覆盖：单用户改自己的卡、并发极低，可接受（与 upsertReview
 * 同口径记账）；极端并发下后写覆盖前写，属可容忍的编辑丢失，非数据损坏。
 * @param  userId      当前用户 id
 * @param  questionId  目标题目 id
 * @param  idx         被编辑的点序号（对齐 focusPoints 顺序，≥0）
 * @param  en          该点覆盖英文（空串 = 清除该点覆盖）
 * @throws             Error —— 读或 upsert 出错
 * @sideEffect         service_role 读+upsert anki_cards（绕 RLS）
 */
export async function patchEditedPoint(userId: string, questionId: string, idx: number, en: string): Promise<void> {
  const supabase = getSupabaseServer()
  const { data: existing, error: readErr } = await supabase
    .from('anki_cards')
    .select('edited_answer')
    .eq('user_id', userId)
    .eq('question_id', questionId)
    .maybeSingle()
  if (readErr) throw new Error(`读取卡背编辑失败：${readErr.message}`)
  const current = (existing as { edited_answer: string | null } | null)?.edited_answer ?? null
  const merged = applyEditOverride(parseEditOverrides(current), idx, en)
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('anki_cards')
    .upsert(
      { user_id: userId, question_id: questionId, edited_answer: serializeEditOverrides(merged), updated_at: now },
      { onConflict: 'user_id,question_id' },
    )
  if (error) throw new Error(`存编辑失败：${error.message}`)
}
