/**
 * @module   import-season
 * @desc     换季导入器 —— 把 scripts/seed/ielts_questions_2026_05_enriched.json（2026年5-8月题库）
 *           导入 questions 表。真源是该 JSON；本脚本只做「把 JSON 落到 DB」这一件事，
 *           不建任何 question_observation_links（链接统一交给 remap:links v3 重建）。
 *
 *           严格沿用 apply-0017.ts / remap-links.ts 惯例：
 *             · service-role REST 通道（getSupabaseServer），本仓库无 supabase CLI；
 *             · 默认 --dry-run 只读只报告，加 --apply 才写库；
 *             · --apply 前把受影响的 questions 行 + 相关 links 备份到 scripts/data/backup/（带时间戳）；
 *             · 幂等可重跑。
 *
 *           三类处理（NEW_SEASON = '2026-05'）：
 *             一、保留 Part2 卡（carried_over=true）：按 match_title 定位现有卡，原地 UPDATE
 *                （不删行不换 ID，卡上的观察点链接因此自动保留），再刷新其 Part3 子题。
 *             二、保留 Part1 话题组（carried_over=true）：按 match_topic（旧名）整组 DELETE 再
 *                按新 topic 名逐条 INSERT。链接随行级联删除属预期，由 remap:links v3 重建。
 *             三、新增题（carried_over=false）：Part1 话题组 / Part2 卡（含 Part3）直接 INSERT，is_new=true。
 *             四、消失题：任何未被上述规则触及的行一律不动（自然停留在旧季度 = 已过季）。
 *
 *           【幂等设计——守卫前置】：对每个条目，先判断「新季度目标行是否已存在」，是则整条 no-op，
 *           在任何 DELETE 之前短路。这既实现了各类的「幂等分支」，又保护了 remap:links v3 事后
 *           重建的链接——若不前置守卫、重复 --apply 会把 Part1 保留组连同新建链接再次级联删掉。
 *
 *           【待产品方确认】Part3 子题一律 is_new=false（含新建卡下的 Part3）——沿用「保留卡刷新
 *           Part3」的字段模板并统一应用；Part3 从不单独打「新题」角标，故不随父卡 is_new=true。
 *
 *           【--seed-all 空库全量模式】：迁库/新建空库首次种入时用。此模式下不做「保留卡按旧名
 *           原地 UPDATE」——空库没有旧行可匹配，保留 Part2 卡会被误判为「查无对应 → 跳过」而丢失。
 *           故 --seed-all 把保留项（Part1 题 / Part2 卡）一律当新行 INSERT，仅 is_new 仍按 carried_over
 *           取值（保留=false / 新题=true），角标语义不变。空库全量导入的期望 newSeasonTotal = total_rows。
 *           非空库请勿用 --seed-all（会绕过旧行匹配、可能产生重复）。
 *
 *           【Part2 题面完整性守卫（2026-08-12 追加）】计划算完、任何备份/写库动作之前，校验
 *           「即将写入的 Part2 行」的题面还含不含约束段；不合格直接 exit(1)，一个字节都不写。
 *           守的是 questionFace 那场事故的【数据入口】：约束（You should say 后面的 bullet）只存在于
 *           question_text ← c.cue_text；一旦上游 cue_text 退化成裸标题、或与 title 映射反了，
 *           代码侧一行没改、questionFace 的 11 条断言全绿，而模型看到的题面照样丢约束 → Part2 静默虚高
 *           一整季（线上判据与盲标表题面同源、两边一起偏，金标分数看不出异常）。
 *           判据与处置说明见 scripts/lib/season-cue-guard.ts（含查存量退化数据的只读 SQL）。
 *
 *           运行：npm run import:season [-- --apply] [-- --seed-all]
 *           底层：npx tsx --conditions=react-server --env-file=.env.local scripts/import-season.ts
 * @author   LingoBridge
 * @created  2026-07-21
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getSupabaseServer } from '@/lib/supabase-server'
import {
  findPart2FaceViolations,
  formatPart2FaceViolations,
  type Part2Face,
  type Part2FaceViolation,
} from './lib/season-cue-guard'

// ── 常量 ──────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const SEED_PATH = join(__dirname, 'seed', 'ielts_questions_2026_05_enriched.json')
const BACKUP_DIR = join(__dirname, 'data', 'backup')
const QUESTIONS_TABLE = 'questions'
const LINKS_TABLE = 'question_observation_links'
const NEW_SEASON = '2026-05'

// ── 类型（JSON 侧）────────────────────────────────────────────────────────────

interface SeedMeta {
  season: string
  part1_topics: number
  part1_questions: number
  part2_cards: number
  part3_questions: number
  total_rows: number
}
interface Part1Topic {
  topic: string
  is_new: boolean
  topic_only: boolean
  questions_with_zh: { en: string; zh: string | null }[]
  season: string
  carried_over: boolean
  match_topic: string
}
interface Part2Card {
  title: string
  title_zh: string | null
  is_new: boolean
  cue_text: string
  part3_questions: string[]
  topic_only: boolean
  season: string
  carried_over: boolean
  match_title: string
}
interface SeedDoc {
  metadata: SeedMeta
  part1: Part1Topic[]
  part2: Part2Card[]
}

// ── 类型（DB 侧）──────────────────────────────────────────────────────────────

interface QRow {
  id: string
  part: 1 | 2 | 3
  topic: string | null
  question_text: string
  question_text_zh: string | null
  cue_card_title: string | null
  cue_card_title_zh: string | null
  is_new: boolean
  topic_only: boolean
  parent_card_id: string | null
  season: string | null
}
interface LinkRow {
  id: string
  question_id: string
  observation_point_id: string
  is_primary: boolean
}

/** 待 INSERT 的题目行（不含 id / created_at，交 DB 默认） */
interface NewQ {
  part: 1 | 2 | 3
  topic: string
  question_text: string
  question_text_zh: string | null
  cue_card_title: string | null
  cue_card_title_zh: string | null
  is_new: boolean
  topic_only: boolean
  parent_card_id: string | null
  season: string
}

// ── 计划容器 ──────────────────────────────────────────────────────────────────

interface CardUpdate {
  cardId: string
  title: string
  set: Pick<NewQ, 'topic' | 'cue_card_title' | 'cue_card_title_zh' | 'question_text' | 'is_new' | 'topic_only' | 'season'>
}
interface Part3Refresh {
  cardId: string
  title: string
  deleteIds: string[]
  insertRows: NewQ[]
}
interface P1Delete {
  newTopic: string
  matchTopic: string
  ids: string[]
}
interface NewCard {
  title: string
  cardRow: NewQ
  part3: string[]
}
/** 保留项「旧名命中核对」——误匹配敏感点（DB 侧唯一无法离线验证的盲区，显式暴露在报告里） */
interface RenameCheck {
  kind: 'P1' | 'P2'
  from: string // 旧名（match_topic / match_title）
  to: string // 新名（topic / title）
  hits: number // 旧名在当前 DB 命中的行数
  renamed: boolean // 旧名 ≠ 新名（改名项最需人工确认命中对不对）
  note: string
}

interface Plan {
  // 类一 保留 Part2
  cardUpdates: CardUpdate[]
  part3Refreshes: Part3Refresh[]
  // 类二 保留 Part1
  p1Deletes: P1Delete[]
  p1CarriedInserts: NewQ[]
  // 类三 新增
  p1NewInserts: NewQ[]
  newCards: NewCard[]
  // 报告用
  renameChecks: RenameCheck[]
  unmatched: string[]
  idemSkips: string[]
  notes: string[]
}

// ── 工具 ──────────────────────────────────────────────────────────────────────

/** 规范化文本：弯引号转直引号、小写、压缩空白、去首尾空格（同 remap-links） */
function norm(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** 组装 Part1 题目行 */
function p1Row(topic: string, en: string, zh: string | null, isNew: boolean): NewQ {
  return {
    part: 1,
    topic,
    question_text: en,
    question_text_zh: zh,
    cue_card_title: null,
    cue_card_title_zh: null,
    is_new: isNew,
    topic_only: false, // Part1 一律 false（本季 JSON 全部 topic_only=false，与此一致）
    parent_card_id: null,
    season: NEW_SEASON,
  }
}

/** 组装 Part2 卡行 */
function cardRow(c: Part2Card, isNew: boolean): NewQ {
  return {
    part: 2,
    topic: c.title,
    question_text: c.cue_text,
    question_text_zh: null,
    cue_card_title: c.title,
    cue_card_title_zh: c.title_zh,
    is_new: isNew,
    topic_only: c.topic_only, // Part2 取 JSON 值
    parent_card_id: null,
    season: NEW_SEASON,
  }
}

/** 组装 Part3 子题行（parent_card_id 由调用方补齐；is_new 恒 false） */
function p3Row(title: string, questionText: string, parentCardId: string | null): NewQ {
  return {
    part: 3,
    topic: title,
    question_text: questionText,
    question_text_zh: null,
    cue_card_title: null,
    cue_card_title_zh: null,
    is_new: false,
    topic_only: false,
    parent_card_id: parentCardId,
    season: NEW_SEASON,
  }
}

// ── 计划核心（不写库，只算 Plan）──────────────────────────────────────────────

function buildPlan(doc: SeedDoc, questions: QRow[], seedAll = false): Plan {
  const plan: Plan = {
    cardUpdates: [],
    part3Refreshes: [],
    p1Deletes: [],
    p1CarriedInserts: [],
    p1NewInserts: [],
    newCards: [],
    renameChecks: [],
    unmatched: [],
    idemSkips: [],
    notes: [],
  }

  const p1Rows = questions.filter((q) => q.part === 1)
  const p2Rows = questions.filter((q) => q.part === 2)
  const p3ByParent = new Map<string, QRow[]>()
  for (const q of questions) {
    if (q.part === 3 && q.parent_card_id) {
      const arr = p3ByParent.get(q.parent_card_id) ?? []
      arr.push(q)
      p3ByParent.set(q.parent_card_id, arr)
    }
  }

  /** 新季度目标 Part1 话题是否已导入（守卫前置的幂等判据） */
  const p1AlreadyImported = (topic: string): boolean =>
    p1Rows.some((q) => q.topic !== null && norm(q.topic) === norm(topic) && q.season === NEW_SEASON)
  /** 新季度目标 Part2 卡是否已导入 */
  const p2AlreadyImported = (title: string): boolean =>
    p2Rows.some((q) => q.cue_card_title !== null && norm(q.cue_card_title) === norm(title) && q.season === NEW_SEASON)

  // ── Part1（保留 + 新增）──────────────────────────────────────────────────
  for (const t of doc.part1) {
    if (p1AlreadyImported(t.topic)) {
      plan.idemSkips.push(`Part1 话题「${t.topic}」已存在 season=${NEW_SEASON} 行 → no-op`)
      continue
    }
    if (t.carried_over) {
      if (seedAll) {
        // 空库全量：无旧行可删/可匹配，保留话题直接按新数据 INSERT（is_new=false 保留「非新题」语义）
        for (const q of t.questions_with_zh) {
          plan.p1CarriedInserts.push(p1Row(t.topic, q.en, q.zh, false))
        }
        continue
      }
      const oldRows = p1Rows.filter((q) => q.topic !== null && norm(q.topic) === norm(t.match_topic))
      const renamed = norm(t.topic) !== norm(t.match_topic)
      plan.renameChecks.push({
        kind: 'P1',
        from: t.match_topic,
        to: t.topic,
        hits: oldRows.length,
        renamed,
        note: oldRows.length === 0 ? '⚠ 旧名命中 0 条 → 走 notes 只插不删' : `命中 ${oldRows.length} 条 → 整组删除后按新名重插`,
      })
      if (oldRows.length === 0) {
        plan.notes.push(`Part1 保留话题「${t.topic}」旧名「${t.match_topic}」在 DB 无对应行（carried_over 却查无旧行，异常）——仍按新数据 INSERT`)
      } else {
        plan.p1Deletes.push({ newTopic: t.topic, matchTopic: t.match_topic, ids: oldRows.map((r) => r.id) })
      }
      for (const q of t.questions_with_zh) {
        plan.p1CarriedInserts.push(p1Row(t.topic, q.en, q.zh, false))
      }
    } else {
      for (const q of t.questions_with_zh) {
        plan.p1NewInserts.push(p1Row(t.topic, q.en, q.zh, true))
      }
    }
  }

  // ── Part2（保留 + 新增）──────────────────────────────────────────────────
  for (const c of doc.part2) {
    if (p2AlreadyImported(c.title)) {
      plan.idemSkips.push(`Part2 卡「${c.title}」已存在 season=${NEW_SEASON} 行 → no-op`)
      continue
    }
    if (c.carried_over) {
      if (seedAll) {
        // 空库全量：无「现有卡」可原地更新，保留卡当新行 INSERT（is_new=false 保留「非新题」语义）
        plan.newCards.push({ title: c.title, cardRow: cardRow(c, false), part3: c.part3_questions })
        continue
      }
      const matched = p2Rows.filter((q) => q.cue_card_title !== null && norm(q.cue_card_title) === norm(c.match_title))
      const renamed = norm(c.title) !== norm(c.match_title)
      plan.renameChecks.push({
        kind: 'P2',
        from: c.match_title,
        to: c.title,
        hits: matched.length,
        renamed,
        note: matched.length === 1 ? '命中 1 条 → 原地更新' : `⚠ 命中 ${matched.length} 条（期望恰好 1）→ 跳过`,
      })
      if (matched.length === 0) {
        plan.unmatched.push(`Part2 保留卡「${c.title}」按 match_title「${c.match_title}」查无对应卡，且未见已导入痕迹 → 跳过（禁止猜测）`)
        continue
      }
      if (matched.length > 1) {
        plan.unmatched.push(`Part2 保留卡「${c.title}」按 match_title「${c.match_title}」匹配到 ${matched.length} 条（期望恰好 1）→ 跳过（禁止猜测）`)
        continue
      }
      const card = matched[0]
      plan.cardUpdates.push({
        cardId: card.id,
        title: c.title,
        set: {
          topic: c.title,
          cue_card_title: c.title,
          cue_card_title_zh: c.title_zh,
          question_text: c.cue_text,
          is_new: false,
          topic_only: c.topic_only,
          season: NEW_SEASON,
        },
      })
      const oldP3 = p3ByParent.get(card.id) ?? []
      plan.part3Refreshes.push({
        cardId: card.id,
        title: c.title,
        deleteIds: oldP3.map((r) => r.id),
        insertRows: c.part3_questions.map((qt) => p3Row(c.title, qt, card.id)),
      })
    } else {
      plan.newCards.push({ title: c.title, cardRow: cardRow(c, true), part3: c.part3_questions })
    }
  }

  return plan
}

// ── 报告 ──────────────────────────────────────────────────────────────────────

function planCounts(plan: Plan): {
  p1Delete: number; p1Insert: number
  p2Update: number; p2NewCard: number; p3Delete: number; p3Insert: number
  newSeasonTotal: number
} {
  const p1Delete = plan.p1Deletes.reduce((n, d) => n + d.ids.length, 0)
  const p1Insert = plan.p1CarriedInserts.length + plan.p1NewInserts.length
  const p2Update = plan.cardUpdates.length
  const p2NewCard = plan.newCards.length
  const p3Delete = plan.part3Refreshes.reduce((n, r) => n + r.deleteIds.length, 0)
  const p3Insert =
    plan.part3Refreshes.reduce((n, r) => n + r.insertRows.length, 0) +
    plan.newCards.reduce((n, c) => n + c.part3.length, 0)
  // 计划落地后「本次新增/刷新」贡献的 season=NEW_SEASON 行数（保留卡为原地更新，也计入）
  const newSeasonTotal = p1Insert + p2Update + p2NewCard + p3Insert
  return { p1Delete, p1Insert, p2Update, p2NewCard, p3Delete, p3Insert, newSeasonTotal }
}

/**
 * 取出【本次真正会写进 DB 的】Part2 题面，交题面完整性守卫校验。
 *
 * 刻意取计划里映射【之后】的字段（set / cardRow），而不是原始 JSON 的 c.cue_text：
 * 只有这样才抓得住「question_text 与 cue_card_title 被映射反了」——那种错只发生在 cardRow 那一步，
 * 拿原始 JSON 校验永远看不出来。两条写入路径都要覆盖：保留卡原地 UPDATE + 新建卡 INSERT。
 * （幂等跳过 / 未匹配跳过的卡本次不写库，不在校验范围内，免得为不写的数据误拦导入。）
 *
 * @param  plan  buildPlan 的产物
 * @returns      待写入 Part2 题面清单（顺序：先保留卡更新，后新建卡）
 */
function collectPart2Faces(plan: Plan): Part2Face[] {
  const faces: Part2Face[] = []
  for (const u of plan.cardUpdates) {
    faces.push({ title: u.set.cue_card_title ?? '', cueText: u.set.question_text })
  }
  for (const nc of plan.newCards) {
    faces.push({ title: nc.cardRow.cue_card_title ?? '', cueText: nc.cardRow.question_text })
  }
  return faces
}

function printReport(
  doc: SeedDoc,
  plan: Plan,
  faces: readonly Part2Face[],
  faceViolations: readonly Part2FaceViolation[],
): void {
  const c = planCounts(plan)
  const m = doc.metadata

  console.log('# import-season 导入计划报告\n')
  console.log(`目标季度 NEW_SEASON = ${NEW_SEASON}（JSON metadata.season = ${m.season}）\n`)

  console.log('## 一、保留 Part2 卡（原地 UPDATE，链接自动保留）')
  console.log(`  卡更新：${c.p2Update} 条`)
  for (const u of plan.cardUpdates) console.log(`    ~ 「${u.title}」(id=${u.cardId})`)
  console.log(`  Part3 刷新：删除 ${c.p3Delete} 条 → 重插（见下方 Part3 合计）`)

  console.log('\n## 二、保留 Part1 话题组（整组 DELETE 旧名 → INSERT 新名）')
  console.log(`  删除旧行：${c.p1Delete} 条`)
  for (const d of plan.p1Deletes) {
    const renamed = norm(d.newTopic) !== norm(d.matchTopic) ? `（旧名「${d.matchTopic}」→ 新名「${d.newTopic}」）` : ''
    console.log(`    - topic「${d.matchTopic}」×${d.ids.length}${renamed}`)
  }
  console.log(`  新插保留题：${plan.p1CarriedInserts.length} 条`)

  console.log('\n## 三、新增题（INSERT，is_new=true）')
  console.log(`  Part1 新话题题目：${plan.p1NewInserts.length} 条`)
  console.log(`  Part2 新卡：${c.p2NewCard} 张`)
  for (const nc of plan.newCards) console.log(`    + 「${nc.title}」(+${nc.part3.length} 条 Part3)`)

  console.log('\n## Part3 合计（保留卡刷新 + 新卡子题，is_new=false）')
  console.log(`  删除：${c.p3Delete} 条 ／ 插入：${c.p3Insert} 条`)

  console.log(`\n## 幂等跳过（已存在 season=${NEW_SEASON}，本次不动）（${plan.idemSkips.length} 项）`)
  for (const s of plan.idemSkips) console.log(`  = ${s}`)

  console.log(`\n## 未匹配 / 需人工确认（${plan.unmatched.length} 项，已跳过）`)
  for (const u of plan.unmatched) console.log(`  ! ${u}`)

  if (plan.notes.length > 0) {
    console.log(`\n## 备注（${plan.notes.length} 项）`)
    for (const n of plan.notes) console.log(`  · ${n}`)
  }

  // 误匹配敏感点：改名项 + 命中数异常项，显式暴露（DB 侧唯一无法离线验证的盲区）
  const renamed = plan.renameChecks.filter((r) => r.renamed)
  const abnormal = plan.renameChecks.filter((r) => (r.kind === 'P2' && r.hits !== 1) || (r.kind === 'P1' && r.hits === 0))
  console.log(`\n## 保留项 旧名命中核对（误匹配敏感，共 ${plan.renameChecks.length} 项）`)
  console.log(`  ── 改名项（旧名≠新名，${renamed.length} 项，最需人工确认命中的是对的旧卡/旧组）`)
  if (renamed.length === 0) console.log('    （无改名项）')
  for (const r of renamed) console.log(`    [${r.kind}] 「${r.from}」→「${r.to}」：${r.note}`)
  console.log(`  ── 命中数异常（${abnormal.length} 项，P2 期望恰好 1 / P1 期望≥1）`)
  if (abnormal.length === 0) console.log('    ✓ 全部保留项命中数正常')
  for (const r of abnormal) console.log(`    ⚠ [${r.kind}] 「${r.from}」→「${r.to}」：命中 ${r.hits}`)

  console.log('\n## 校验（Part2 题面完整性 —— 约束丢了就不许写库）')
  console.log(`  受检题面：${faces.length} 张（保留卡更新 ${c.p2Update} + 新建卡 ${c.p2NewCard}）`)
  if (faces.length === 0) {
    console.log('  · 本次无 Part2 待写入，跳过')
  } else if (faceViolations.length === 0) {
    console.log('  ✓ 题面均含约束段（You should say …），未见退化成裸标题')
  } else {
    console.log(`  ✗ ${faceViolations.length} 张题面丢了约束 → 本次导入将被拒绝（详情见末尾拦截信息）`)
    for (const v of faceViolations) console.log(`    ✗ 「${v.title}」[${v.kind}]`)
  }

  console.log('\n## 校验（对照 JSON metadata）')
  console.log(`  本次将写入 season=${NEW_SEASON} 行合计：${c.newSeasonTotal}`)
  console.log(`    = Part1 ${c.p1Insert} + Part2卡(更新${c.p2Update}+新建${c.p2NewCard})=${c.p2Update + c.p2NewCard} + Part3 ${c.p3Insert}`)
  console.log(`  metadata.total_rows = ${m.total_rows}（Part1 ${m.part1_questions} + Part2 ${m.part2_cards} + Part3 ${m.part3_questions}）`)
  if (c.newSeasonTotal === m.total_rows) {
    console.log('  ✓ 与 total_rows 一致（全量首次导入的期望值）')
  } else {
    const skipped = plan.idemSkips.length
    console.log(`  △ 与 total_rows 不等：差 ${m.total_rows - c.newSeasonTotal} 行。`)
    console.log(`     若因幂等跳过（${skipped} 项已在库）或存在未匹配（${plan.unmatched.length} 项），属预期；否则请核查。`)
  }
}

// ── 备份（仅 --apply 前）──────────────────────────────────────────────────────

function collectAffected(plan: Plan, questions: QRow[]): { affectedRows: QRow[]; affectedLinks: string[] } {
  const byId = new Map(questions.map((q) => [q.id, q]))
  const touchedIds = new Set<string>()
  for (const u of plan.cardUpdates) touchedIds.add(u.cardId) // UPDATE
  for (const r of plan.part3Refreshes) for (const id of r.deleteIds) touchedIds.add(id) // DELETE
  for (const d of plan.p1Deletes) for (const id of d.ids) touchedIds.add(id) // DELETE
  const affectedRows: QRow[] = []
  for (const id of touchedIds) {
    const row = byId.get(id)
    if (row) affectedRows.push(row)
  }
  return { affectedRows, affectedLinks: [...touchedIds] }
}

// ── 写库执行（apply）──────────────────────────────────────────────────────────

async function apply(
  sb: ReturnType<typeof getSupabaseServer>,
  plan: Plan,
): Promise<void> {
  const c = planCounts(plan)

  // 一、保留 Part2 卡：原地 UPDATE + 刷新 Part3
  for (const u of plan.cardUpdates) {
    const { error } = await sb.from(QUESTIONS_TABLE).update(u.set).eq('id', u.cardId)
    if (error) throw new Error(`更新保留卡「${u.title}」失败：${error.message}`)
  }
  for (const r of plan.part3Refreshes) {
    if (r.deleteIds.length > 0) {
      const { error } = await sb.from(QUESTIONS_TABLE).delete().in('id', r.deleteIds)
      if (error) throw new Error(`删除卡「${r.title}」旧 Part3 失败：${error.message}`)
    }
    if (r.insertRows.length > 0) {
      const { error } = await sb.from(QUESTIONS_TABLE).insert(r.insertRows)
      if (error) throw new Error(`插入卡「${r.title}」新 Part3 失败：${error.message}`)
    }
  }

  // 二、保留 Part1：整组 DELETE 旧名 → INSERT 新名
  for (const d of plan.p1Deletes) {
    if (d.ids.length > 0) {
      const { error } = await sb.from(QUESTIONS_TABLE).delete().in('id', d.ids)
      if (error) throw new Error(`删除保留话题「${d.matchTopic}」旧行失败：${error.message}`)
    }
  }
  if (plan.p1CarriedInserts.length > 0) {
    const { error } = await sb.from(QUESTIONS_TABLE).insert(plan.p1CarriedInserts)
    if (error) throw new Error(`插入保留 Part1 题失败：${error.message}`)
  }

  // 三、新增 Part1
  if (plan.p1NewInserts.length > 0) {
    const { error } = await sb.from(QUESTIONS_TABLE).insert(plan.p1NewInserts)
    if (error) throw new Error(`插入新增 Part1 题失败：${error.message}`)
  }

  // 三、新增 Part2 卡（先插卡取 id，再插 Part3 子题）
  for (const nc of plan.newCards) {
    const { data, error } = await sb.from(QUESTIONS_TABLE).insert(nc.cardRow).select('id').single()
    if (error) throw new Error(`插入新卡「${nc.title}」失败：${error.message}`)
    const cardId = (data as { id: string }).id
    if (nc.part3.length > 0) {
      const rows = nc.part3.map((qt) => p3Row(nc.title, qt, cardId))
      const { error: e3 } = await sb.from(QUESTIONS_TABLE).insert(rows)
      if (e3) throw new Error(`插入新卡「${nc.title}」Part3 失败：${e3.message}`)
    }
  }

  console.log(
    `\n✓ 已写入：Part1 删 ${c.p1Delete} / 插 ${c.p1Insert}；` +
      `Part2 卡更新 ${c.p2Update} / 新建 ${c.p2NewCard}；` +
      `Part3 删 ${c.p3Delete} / 插 ${c.p3Insert}。`,
  )
  console.log('（再次运行 --apply 应全部落入「幂等跳过」，验证幂等。）')
  console.log('下一步：跑 remap:links v3 按话题重建 question_observation_links。')
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const applyMode = args.includes('--apply')
  const seedAll = args.includes('--seed-all')
  const unknown = args.filter((a) => a !== '--apply' && a !== '--dry-run' && a !== '--seed-all')
  if (unknown.length > 0) {
    console.error(`未知参数：${unknown.join(', ')}（仅支持 --dry-run(默认) / --apply / --seed-all）`)
    process.exit(1)
  }
  if (seedAll) {
    console.log('⚙ --seed-all 空库全量模式：保留项一律当新行 INSERT（仅 is_new 按 carried_over 取值），不做旧行匹配/UPDATE。\n')
  }

  const missingEnv = (['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const).filter((k) => !process.env[k])
  if (missingEnv.length > 0) {
    console.error(`✗ 缺少环境变量：${missingEnv.join(', ')}。请用 npm run import:season（底层带 --env-file=.env.local）。`)
    process.exit(1)
  }

  const doc = JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as SeedDoc
  const sb = getSupabaseServer()

  // 运行前预检：questions 必须有 season 列（0027 已执行）
  const { error: seasonErr } = await sb.from(QUESTIONS_TABLE).select('season').limit(1)
  if (seasonErr) {
    console.error(`✗ 预检失败：questions 表疑似缺少 season 列（${seasonErr.message}）。`)
    console.error('  请先在 Supabase SQL Editor 手动执行 supabase/migrations/0027_questions_season.sql 再重跑。')
    process.exit(1)
  }

  const { data: qData, error: qErr } = await sb
    .from(QUESTIONS_TABLE)
    .select('id, part, topic, question_text, question_text_zh, cue_card_title, cue_card_title_zh, is_new, topic_only, parent_card_id, season')
  if (qErr) throw new Error(`读取 questions 失败：${qErr.message}`)
  const questions = (qData ?? []) as QRow[]

  // --seed-all 运行时防呆：它只该用于空库/迁库首次种入。库中若已有本季行，误用会绕过「保留卡原地
  // 更新」语义、留下语义错乱（幂等守卫虽能跳过同季重复，但挡不住「本该走差量却用了 seed-all」的误用）。
  if (seedAll && applyMode && questions.some((q) => q.season === NEW_SEASON)) {
    console.error(`✗ --seed-all 仅供空库首次种入：库中已存在 season=${NEW_SEASON} 的行，拒绝 --apply。`)
    console.error('  · 增量换季 → 去掉 --seed-all 走正常差量模式；· 确需重灌 → 先清空本季数据再跑。')
    console.error('  （去掉 --apply 可用 dry-run 只读预览，不受此拦截。）')
    process.exit(1)
  }

  const plan = buildPlan(doc, questions, seedAll)

  // Part2 题面完整性守卫：先把完整报告打出来（dry-run 时人要看得到全貌），再硬拦截。
  // 拦截点在备份与任何写库动作【之前】——失败时一个字节都不会落库、也不会留下半截备份文件。
  // dry-run 同样 exit(1)：换季的正常流程是先 dry-run 再 --apply，问题就该在 dry-run 这一步炸出来。
  const part2Faces = collectPart2Faces(plan)
  const faceViolations = findPart2FaceViolations(part2Faces)

  printReport(doc, plan, part2Faces, faceViolations)

  if (faceViolations.length > 0) {
    console.error(`\n✗ ${formatPart2FaceViolations(faceViolations)}`)
    process.exit(1)
  }

  if (!applyMode) {
    const c = planCounts(plan)
    console.log('\n———')
    console.log(
      `本次为 dry-run，未写库。计划：Part1 删 ${c.p1Delete}/插 ${c.p1Insert}，` +
        `Part2 卡更新 ${c.p2Update}/新建 ${c.p2NewCard}，Part3 删 ${c.p3Delete}/插 ${c.p3Insert}` +
        `${plan.unmatched.length ? `，未匹配 ${plan.unmatched.length} 项` : ''}。`,
    )
    console.log('确认无误后加 --apply 执行（apply 前会自动备份受影响 questions 行 + 相关 links 到 scripts/data/backup/）。')
    return
  }

  // ── 写入前备份 ──
  const { affectedRows, affectedLinks } = collectAffected(plan, questions)
  mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = fileStamp()

  const qBackupPath = join(BACKUP_DIR, `import-season-questions-${stamp}.json`)
  writeFileSync(qBackupPath, JSON.stringify(affectedRows, null, 2), 'utf-8')
  console.log(`\n已备份将被 UPDATE/DELETE 的 ${affectedRows.length} 条 questions 行 → ${qBackupPath}`)

  let links: LinkRow[] = []
  if (affectedLinks.length > 0) {
    const { data: lData, error: lErr } = await sb
      .from(LINKS_TABLE)
      .select('id, question_id, observation_point_id, is_primary')
      .in('question_id', affectedLinks)
    if (lErr) throw new Error(`读取受影响 ${LINKS_TABLE} 失败：${lErr.message}`)
    links = (lData ?? []) as LinkRow[]
  }
  const lBackupPath = join(BACKUP_DIR, `import-season-links-${stamp}.json`)
  writeFileSync(lBackupPath, JSON.stringify(links, null, 2), 'utf-8')
  console.log(`已备份受影响行的 ${links.length} 条 ${LINKS_TABLE}（含保留 Part1 话题现有链接）→ ${lBackupPath}`)

  await apply(sb, plan)
}

main().then(() => process.exit(0)).catch((e: unknown) => {
  console.error('\n✗ 脚本异常：', e instanceof Error ? e.message : e)
  process.exit(1)
})
