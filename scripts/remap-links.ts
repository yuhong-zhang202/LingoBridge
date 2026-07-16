/**
 * @module   remap-links
 * @desc     声明式对账 question_observation_links —— 读 scripts/data/question-observation-remap.v1.json，
 *           按 matching_rule 匹配 DB 题目（Part1 按 topic 名 / overrides 按题干片段，Part2 按 cue_card_title），
 *           按 reconcile_policy 确保 primary/secondary 链接存在、删除 remove_links、保留未声明链接。
 *           默认 --dry-run 仅输出差异报告不写库；--apply 才写入，且写入前自动全量备份到 scripts/data/backup/。
 *           绝不修改 questions 表任何字段（含 topic_only）。幂等：重复 --apply 不产生重复链接/重复删除。
 *           运行：npm run remap:links [-- --apply]
 *           底层：npx tsx --conditions=react-server --env-file=.env.local scripts/remap-links.ts
 * @author   LingoBridge
 * @created  2026-07-13
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getSupabaseServer } from '@/lib/supabase-server'

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface Override { match: string; add_secondary: string[] }
interface Part1Topic {
  topic: string
  primary: string | null
  secondary: string[]
  overrides?: Override[]
  remove_links?: string[]
  note?: string
}
interface Part2Card {
  title: string
  primary: string | null
  secondary: string[]
  multi_match?: number
  remove_links?: string[]
  topic_only?: boolean
  note?: string
}
interface RemapDoc {
  version: string
  part1_topics: Part1Topic[]
  part2_cards: Part2Card[]
}

interface DBQuestionRow {
  id: string
  part: 1 | 2 | 3
  topic: string | null
  question_text: string
  cue_card_title: string | null
}
interface DBLinkRow {
  id: string
  question_id: string
  observation_point_id: string
  is_primary: boolean
}

/** 一条计划动作（对 question_observation_links 的单行操作） */
interface InsertAction { questionId: string; label: string; code: string; isPrimary: boolean; source: string }
interface UpdateAction { rowId: string; questionId: string; label: string; code: string; from: boolean; to: boolean; source: string }
interface DeleteAction { rowId: string; questionId: string; label: string; code: string; source: string }
interface KeepAction { questionId: string; label: string; code: string; isPrimary: boolean; source: string }

// ── 常量 ──────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const REMAP_PATH = join(__dirname, 'data', 'question-observation-remap.v2.json')
const BACKUP_DIR = join(__dirname, 'data', 'backup')
const LINKS_TABLE = 'question_observation_links'

// ── 工具 ──────────────────────────────────────────────────────────────────────

/** 规范化文本：弯引号转直引号、小写、压缩空白、去首尾空格 */
function norm(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** 题目短标签（供报告可读） */
function labelOf(q: DBQuestionRow): string {
  const t = q.part === 2 ? (q.cue_card_title ?? q.question_text) : q.question_text
  return `P${q.part}｜${t}`
}

function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

// ── 对账核心 ──────────────────────────────────────────────────────────────────

interface Plan {
  inserts: InsertAction[]
  updates: UpdateAction[]
  deletes: DeleteAction[]
  keeps: KeepAction[]
  problems: string[]
}

/**
 * 针对单题计算所需的链接对账动作（不写库，只产出 Plan 片段）
 * @param q               匹配到的 DB 题目
 * @param primary         声明的主观察点 code（null=不设主）
 * @param secondaries     声明的副观察点 code 集合（含 override 追加）
 * @param removeCodes     remove_links 中要删除的 code 集合
 * @param existing        该题当前所有链接行
 * @param source          声明来源标识（供报告）
 * @param plan            累加动作的 Plan
 */
function reconcileQuestion(
  q: DBQuestionRow,
  primary: string | null,
  secondaries: Set<string>,
  removeCodes: Set<string>,
  existing: DBLinkRow[],
  source: string,
  plan: Plan,
): void {
  const byCode = new Map(existing.map((r) => [r.observation_point_id, r]))
  const label = labelOf(q)
  const declared = new Set<string>()
  if (primary) declared.add(primary)
  for (const s of secondaries) declared.add(s)

  // 主链接：确保存在且 is_primary=true
  if (primary) {
    const row = byCode.get(primary)
    if (!row) plan.inserts.push({ questionId: q.id, label, code: primary, isPrimary: true, source })
    else if (!row.is_primary) plan.updates.push({ rowId: row.id, questionId: q.id, label, code: primary, from: false, to: true, source })
  }

  // 副链接：确保每个存在且 is_primary=false
  for (const sc of secondaries) {
    if (sc === primary) continue
    const row = byCode.get(sc)
    if (!row) plan.inserts.push({ questionId: q.id, label, code: sc, isPrimary: false, source })
    else if (row.is_primary) plan.updates.push({ rowId: row.id, questionId: q.id, label, code: sc, from: true, to: false, source })
  }

  // 显式删除
  for (const rc of removeCodes) {
    const row = byCode.get(rc)
    if (row) plan.deletes.push({ rowId: row.id, questionId: q.id, label, code: rc, source })
  }

  // 未声明且未列入删除的现存链接：一律保留并报告
  for (const row of existing) {
    if (declared.has(row.observation_point_id)) continue
    if (removeCodes.has(row.observation_point_id)) continue
    plan.keeps.push({ questionId: q.id, label, code: row.observation_point_id, isPrimary: row.is_primary, source })
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const unknown = args.filter((a) => a !== '--apply' && a !== '--dry-run')
  if (unknown.length > 0) {
    console.error(`未知参数：${unknown.join(', ')}（仅支持 --dry-run(默认) / --apply）`)
    process.exit(1)
  }

  const missing = (['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const).filter((k) => !process.env[k])
  if (missing.length > 0) {
    console.error(`✗ 缺少环境变量：${missing.join(', ')}。请用 npm run remap:links（底层带 --env-file=.env.local）。`)
    process.exit(1)
  }

  const doc = JSON.parse(readFileSync(REMAP_PATH, 'utf-8')) as RemapDoc
  const sb = getSupabaseServer()

  const { data: qData, error: qErr } = await sb
    .from('questions')
    .select('id, part, topic, question_text, cue_card_title')
  if (qErr) throw new Error(`读取 questions 失败：${qErr.message}`)
  const questions = (qData ?? []) as DBQuestionRow[]

  const { data: lData, error: lErr } = await sb
    .from(LINKS_TABLE)
    .select('id, question_id, observation_point_id, is_primary')
  if (lErr) throw new Error(`读取 ${LINKS_TABLE} 失败：${lErr.message}`)
  const links = (lData ?? []) as DBLinkRow[]

  const linksByQ = new Map<string, DBLinkRow[]>()
  for (const l of links) {
    const arr = linksByQ.get(l.question_id) ?? []
    arr.push(l)
    linksByQ.set(l.question_id, arr)
  }
  const existingOf = (qid: string): DBLinkRow[] => linksByQ.get(qid) ?? []

  const plan: Plan = { inserts: [], updates: [], deletes: [], keeps: [], problems: [] }

  // ── Part1：按 topic 名匹配整组；overrides 按题干片段匹配个别题 ──
  const p1 = questions.filter((q) => q.part === 1)
  for (const decl of doc.part1_topics) {
    const matched = p1.filter((q) => q.topic !== null && norm(q.topic) === norm(decl.topic))
    if (matched.length === 0) {
      plan.problems.push(`未匹配：Part1 topic「${decl.topic}」在 DB 中无对应题目`)
      continue
    }
    const removeCodes = new Set(decl.remove_links ?? [])
    for (const q of matched) {
      const secondaries = new Set(decl.secondary)
      for (const ov of decl.overrides ?? []) {
        if (norm(q.question_text).includes(norm(ov.match))) {
          for (const s of ov.add_secondary) secondaries.add(s)
        }
      }
      reconcileQuestion(q, decl.primary, secondaries, removeCodes, existingOf(q.id), `P1:${decl.topic}`, plan)
    }
  }

  // ── Part2：按 cue_card_title 匹配；multi_match=N 期望恰好 N 条 ──
  const p2 = questions.filter((q) => q.part === 2)
  for (const decl of doc.part2_cards) {
    const matched = p2.filter((q) => q.cue_card_title !== null && norm(q.cue_card_title) === norm(decl.title))
    if (matched.length === 0) {
      plan.problems.push(`未匹配：Part2 卡「${decl.title}」在 DB 中无对应题目`)
      continue
    }
    if (decl.multi_match !== undefined) {
      if (matched.length !== decl.multi_match) {
        plan.problems.push(`数量不符：Part2 卡「${decl.title}」声明 multi_match=${decl.multi_match}，实际匹配 ${matched.length} 条 —— 不处理`)
        continue
      }
    } else if (matched.length > 1) {
      plan.problems.push(`歧义：Part2 卡「${decl.title}」匹配到 ${matched.length} 条但未标 multi_match —— 不处理`)
      continue
    }
    const removeCodes = new Set(decl.remove_links ?? [])
    const secondaries = new Set(decl.secondary)
    for (const q of matched) {
      reconcileQuestion(q, decl.primary, secondaries, removeCodes, existingOf(q.id), `P2:${decl.title}`, plan)
    }
  }

  // ── 报告 ──
  printReport(plan)

  if (!apply) {
    console.log('\n———')
    console.log(`本次为 dry-run，未写库。将新增 ${plan.inserts.length} 条 / 更新 ${plan.updates.length} 条 / 删除 ${plan.deletes.length} 条 / 保留未声明 ${plan.keeps.length} 条${plan.problems.length ? ` / 问题 ${plan.problems.length} 项` : ''}。`)
    console.log('确认无误后加 --apply 执行（apply 前会自动全量备份到 scripts/data/backup/）。')
    return
  }

  // ── 写入前全量备份 ──
  mkdirSync(BACKUP_DIR, { recursive: true })
  const backupPath = join(BACKUP_DIR, `links-${fileStamp()}.json`)
  writeFileSync(backupPath, JSON.stringify(links, null, 2), 'utf-8')
  console.log(`\n已备份当前 ${links.length} 条链接 → ${backupPath}`)

  // ── 执行（幂等：仅动已算出差异的行）──
  if (plan.inserts.length > 0) {
    const rows = plan.inserts.map((a) => ({ question_id: a.questionId, observation_point_id: a.code, is_primary: a.isPrimary }))
    const { error } = await sb.from(LINKS_TABLE).insert(rows)
    if (error) throw new Error(`插入失败：${error.message}`)
  }
  for (const u of plan.updates) {
    const { error } = await sb.from(LINKS_TABLE).update({ is_primary: u.to }).eq('id', u.rowId)
    if (error) throw new Error(`更新失败（${u.label}｜${u.code}）：${error.message}`)
  }
  for (const d of plan.deletes) {
    const { error } = await sb.from(LINKS_TABLE).delete().eq('id', d.rowId)
    if (error) throw new Error(`删除失败（${d.label}｜${d.code}）：${error.message}`)
  }
  console.log(`\n✓ 已写入：新增 ${plan.inserts.length} / 更新 ${plan.updates.length} / 删除 ${plan.deletes.length}。保留未声明 ${plan.keeps.length} 条未动。`)
  console.log('（再次运行 --apply 应显示 0 新增 / 0 删除，验证幂等。）')
}

/** 打印差异报告（逐条列出题目 + 观察点 + 动作） */
function printReport(plan: Plan): void {
  console.log('# question_observation_links 声明式对账报告\n')

  console.log(`## 将新增（${plan.inserts.length} 条）`)
  for (const a of plan.inserts) console.log(`  + ${a.label}｜${a.code}（${a.isPrimary ? 'primary' : 'secondary'}）  [${a.source}]`)

  console.log(`\n## 将更新 is_primary（${plan.updates.length} 条）`)
  for (const a of plan.updates) console.log(`  ~ ${a.label}｜${a.code}：is_primary ${a.from} → ${a.to}  [${a.source}]`)

  console.log(`\n## 将删除（${plan.deletes.length} 条，remove_links 显式声明）`)
  for (const a of plan.deletes) console.log(`  - ${a.label}｜${a.code}  [${a.source}]`)

  console.log(`\n## 保留未声明的现存链接（${plan.keeps.length} 条，不动，仅报告）`)
  for (const a of plan.keeps) console.log(`  = ${a.label}｜${a.code}（${a.isPrimary ? 'primary' : 'secondary'}）  [匹配自 ${a.source}]`)

  console.log(`\n## 问题项（${plan.problems.length} 项，需人工确认，未处理）`)
  for (const p of plan.problems) console.log(`  ! ${p}`)
}

main().then(() => process.exit(0)).catch((e: unknown) => {
  console.error('\n✗ 脚本异常：', e instanceof Error ? e.message : e)
  process.exit(1)
})
