/**
 * @module   anki/answer-points
 * @desc     分点式卡背的「点数组」纯逻辑单一真源 —— 客户端渲染与服务端 PATCH 共用，杜绝两处各写一份解析/合并。
 *
 *   三层数据来源，逐点按 focusPoints 顺序（idx）对齐、合并出「每点最终英文例句」，优先级：
 *     ① editedAnswer 覆盖（用户逐点行内编辑）——最高；
 *     ② generatedAnswer 点数组（part1/2 基于用户语料生成，drain 存 JSON.stringify(AnkiAnswerPoint[])）；
 *     ③ focusPoints[idx].example（part3 静态示范例句；part1/2 恒空，见 types AnalysisFocusPoint 注）。
 *   三者皆无（含 noMaterial 留空）→ en=null = 空点态（前端渲染虚线框「这点还没讲到」）。
 *
 *   为什么 editedAnswer 用「稀疏覆盖数组」而非「整段」或「写回 generatedAnswer」（方案取舍，本模块头记账）：
 *     - 写回 generatedAnswer（改第 idx 项存回）会污染 AI 生成真源（无法区分哪句是 AI、哪句用户改过，
 *       且 part3 无 generatedAnswer 无处可写）；
 *     - editedAnswer 整段快照要求 PATCH 端把「基线数组」load 全（part3 还得取 analysis），端点变重；
 *     - 稀疏覆盖 [{idx,en}] 只存「用户改过的那几点」：generatedAnswer 保持纯 AI 真源、可逐点回退（清覆盖
 *       即回落生成/示范）、PATCH 只需 read-modify-write 自身 editedAnswer（无需取 analysis）、part1/2/3 统一。
 *     - 与 list.ts backKind 契约不冲突：editedAnswer 非空 → backKind='edited'（语义仍是「用户有编辑」），
 *       渲染层不看 backKind、一律三层合并，故稀疏覆盖不破坏既有判定。
 *
 *   ⚠️ 已知边界（非本模块引入、pre-existing）：换语料（swap_anki_corpus）清 generatedAnswer 但不清
 *      editedAnswer，故旧覆盖会盖住新语料的新生成 —— 与「整段 editedAnswer 时代」同样行为，交后端/red-team
 *      评估是否随换语料一并清覆盖，不在本前端批次内解决。
 * @author   LingoBridge
 * @created  2026-07-24
 */

/** focusPoints 里渲染卡背所需的最小字段（对齐 types AnalysisFocusPoint）。 */
export interface FocusPointLike {
  title: string
  desc: string
  /** part3 静态示范例句；part1/2 恒空。 */
  example?: string
}

/** 用户逐点行内编辑的稀疏覆盖项（只存改过的点；en 为覆盖后的英文例句）。 */
export interface AnkiEditOverride {
  idx: number
  en: string
}

/** 合并出的「最终可渲染点」，逐点对齐 focusPoints 顺序。 */
export interface EffectivePoint {
  idx: number
  title: string
  desc: string
  /** 最终英文例句；null = 空点态（该点无素材/未生成/被清空）。 */
  en: string | null
  /** true = 空点态（en 为 null），前端渲染虚线框补料钩子。 */
  noMaterial: boolean
  /** 该点当前 en 是否来自用户编辑覆盖（供前端标「已编辑」/编辑态回填）。 */
  edited: boolean
}

/** generatedAnswer 解析后的单点（与 AnkiAnswerPoint 同形，本模块不 import ai 层避免层次倒挂）。 */
interface GeneratedPoint {
  idx: number
  en: string | null
  noMaterial: boolean
}

/**
 * 把点数组 JSON 字符串解析成 idx→非空英文 的 Map。
 * 非法 JSON / 非数组 / 旧整段纯文本 → 空 Map（保守回落，与 list.ts hasGeneratedContent 同口径）。
 * 只收 en 是非空字符串的点（noMaterial 留空点、null/空串一律不入 Map）。
 * @param  raw  generatedAnswer 原始值（JSON 串或 null）
 * @returns     idx → 该点英文例句 的 Map
 */
export function parseGeneratedPoints(raw: string | null): Map<number, string> {
  const map = new Map<number, string>()
  if (raw === null || raw === '') return map
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return map
  }
  if (!Array.isArray(parsed)) return map
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const p = item as Partial<GeneratedPoint>
    if (typeof p.idx !== 'number') continue
    if (typeof p.en === 'string' && p.en.trim() !== '') map.set(p.idx, p.en.trim())
  }
  return map
}

/**
 * 解析 editedAnswer 稀疏覆盖数组。非法/空 → 空数组。只收 idx 是数字、en 是字符串的项。
 * @param  raw  editedAnswer 原始值（JSON 串或 null）
 * @returns     覆盖项数组（去重后调用方自行处理；本函数原样返回合法项）
 */
export function parseEditOverrides(raw: string | null): AnkiEditOverride[] {
  if (raw === null || raw === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: AnkiEditOverride[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const p = item as Partial<AnkiEditOverride>
    if (typeof p.idx === 'number' && typeof p.en === 'string') out.push({ idx: p.idx, en: p.en })
  }
  return out
}

/**
 * 在现有覆盖数组上「置/改/清」某一点：
 *   - en 去空白后非空 → 新增或替换该 idx 的覆盖；
 *   - en 去空白后为空 → 移除该 idx 的覆盖（= 回退到 generated/示范/空点态）。
 * 返回新数组（不改入参），按 idx 升序，供 PATCH 端序列化存回。
 * @param  list  现有覆盖项
 * @param  idx   目标点序号
 * @param  en    覆盖英文（空串 = 清除该点覆盖）
 * @returns      更新后的覆盖数组
 */
export function applyEditOverride(list: AnkiEditOverride[], idx: number, en: string): AnkiEditOverride[] {
  const trimmed = en.trim()
  const rest = list.filter((o) => o.idx !== idx)
  if (trimmed !== '') rest.push({ idx, en: trimmed })
  return rest.sort((a, b) => a.idx - b.idx)
}

/**
 * 覆盖数组 → 存库字符串。空数组回空串（令 list.ts backKind 回落 generated/analysis，不再判 'edited'）。
 * @param  list  覆盖项数组
 * @returns      JSON 串或空串
 */
export function serializeEditOverrides(list: AnkiEditOverride[]): string {
  return list.length === 0 ? '' : JSON.stringify(list)
}

/**
 * 合并三层来源，产出逐点对齐 focusPoints 的最终渲染点数组（前端 A/B 布局共用）。
 * 优先级 editedAnswer 覆盖 > generatedAnswer 生成 > focusPoints[idx].example 示范；皆无 → 空点态。
 * @param  focusPoints      题目 analysis 的侧重点（点数 = part1:2 / part2/3:3，驱动「脊柱」标题）
 * @param  generatedAnswer  生成点数组 JSON（part1/2；part3 恒 null）
 * @param  editedAnswer     用户逐点编辑覆盖 JSON（可空）
 * @returns                 最终可渲染点数组
 */
export function deriveEffectivePoints(
  focusPoints: FocusPointLike[],
  generatedAnswer: string | null,
  editedAnswer: string | null,
): EffectivePoint[] {
  const genMap = parseGeneratedPoints(generatedAnswer)
  const editMap = new Map<number, string>()
  for (const o of parseEditOverrides(editedAnswer)) {
    if (o.en.trim() !== '') editMap.set(o.idx, o.en.trim())
  }
  return focusPoints.map((fp, idx) => {
    const editedEn = editMap.get(idx)
    const example = typeof fp.example === 'string' && fp.example.trim() !== '' ? fp.example.trim() : null
    const en = editedEn ?? genMap.get(idx) ?? example ?? null
    return {
      idx,
      title: fp.title,
      desc: fp.desc,
      en,
      noMaterial: en === null,
      edited: editedEn !== undefined,
    }
  })
}

/**
 * 拆分 part2 cue card 题面为「引导句 + You should say 提示」。仅按可靠的单一分隔符 "You should say:" 切，
 * 【不】再把提示体拆成 bullet —— 现库 question_text 是无分隔平铺文本（"...who he/she is how you knew..."），
 * 实测启发式拆分缺陷率约 28%（前置介词/And how/To whom 歧义会错切、篡改题面），故正面以整块呈现提示体，
 * 不伪造 <ul>。若日后要真 bullet，须在 seed/import 落结构化 bullet 字段（数据层改动，非前端范围）。
 * @param  questionText  part2 完整 cue 题面（question_text）
 * @returns              { intro: 引导句, cue: "You should say" 之后的提示体（无该标记则 cue 为空） }
 */
export function splitCueCard(questionText: string): { intro: string; cue: string } {
  const parts = questionText.split(/You should say:?/i)
  if (parts.length < 2) return { intro: questionText.trim(), cue: '' }
  return {
    intro: parts[0].trim().replace(/[.,;\s]+$/, ''),
    cue: parts.slice(1).join(' ').replace(/\s+/g, ' ').trim(),
  }
}
