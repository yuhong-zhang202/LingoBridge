/**
 * @module   set-topic-only
 * @desc     声明式对账 questions.topic_only —— 读 scripts/data/question-observation-remap.v2.json，
 *           把所有 part2_cards 中 topic_only===true 的卡在 DB 中确保 topic_only=true。
 *           这是 remap:links 管不到的字段（remap-links 明确"绝不修改 questions 表"），故单独一支。
 *           默认 --dry-run 仅输出差异报告不写库；--apply 才写入，且写入前自动全量备份受影响行到
 *           scripts/data/backup/topic-only-<stamp>.json（含 id / cue_card_title / 旧 topic_only）。
 *           幂等：已是 true 的卡视为 no-op 并报告；重复 --apply 不产生副作用。
 *           只改 topic_only 一列，不碰题面、不碰 links。
 *           运行：npx tsx --conditions=react-server --env-file=.env.local scripts/set-topic-only.ts [-- --apply]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getSupabaseServer } from '@/lib/supabase-server'

interface Part2Card { title: string; topic_only?: boolean; multi_match?: number }
interface RemapDoc { version: string; part2_cards: Part2Card[] }
interface DBQuestionRow { id: string; part: 1 | 2 | 3; cue_card_title: string | null; topic_only: boolean }

const __dirname = dirname(fileURLToPath(import.meta.url))
const REMAP_PATH = join(__dirname, 'data', 'question-observation-remap.v2.json')
const BACKUP_DIR = join(__dirname, 'data', 'backup')

function norm(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase().replace(/\s+/g, ' ').trim()
}
function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
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
    console.error(`✗ 缺少环境变量：${missing.join(', ')}。请用带 --env-file=.env.local 的方式运行。`)
    process.exit(1)
  }

  const doc = JSON.parse(readFileSync(REMAP_PATH, 'utf-8')) as RemapDoc
  const targets = doc.part2_cards.filter((c) => c.topic_only === true)

  const sb = getSupabaseServer()
  const { data: qData, error: qErr } = await sb
    .from('questions')
    .select('id, part, cue_card_title, topic_only')
  if (qErr) throw new Error(`读取 questions 失败：${qErr.message}`)
  const p2 = (qData ?? []).filter((q: DBQuestionRow) => q.part === 2) as DBQuestionRow[]

  const toFlip: DBQuestionRow[] = []   // 现 false → 需置 true
  const already: DBQuestionRow[] = []  // 现已 true → no-op
  const problems: string[] = []

  for (const card of targets) {
    const matched = p2.filter((q) => q.cue_card_title !== null && norm(q.cue_card_title) === norm(card.title))
    if (matched.length === 0) { problems.push(`未匹配：Part2 卡「${card.title}」在 DB 中无对应题目`); continue }
    if (card.multi_match !== undefined) {
      if (matched.length !== card.multi_match) { problems.push(`数量不符：「${card.title}」声明 multi_match=${card.multi_match}，实际 ${matched.length}`); continue }
    } else if (matched.length > 1) { problems.push(`歧义：「${card.title}」匹配到 ${matched.length} 条但未标 multi_match —— 不处理`); continue }
    for (const q of matched) (q.topic_only ? already : toFlip).push(q)
  }

  console.log('# questions.topic_only 声明式对账报告（来源 remap.v2.json）\n')
  console.log(`## 将置 true（现为 false，${toFlip.length} 条）`)
  for (const q of toFlip) console.log(`  ↑ ${q.cue_card_title}  [${q.id}]`)
  console.log(`\n## 已是 true（no-op，${already.length} 条）`)
  for (const q of already) console.log(`  = ${q.cue_card_title}`)
  if (problems.length) { console.log(`\n## 问题项（${problems.length}）`); for (const p of problems) console.log(`  ! ${p}`) }

  if (!apply) {
    console.log('\n———')
    console.log(`本次为 dry-run，未写库。将置 true ${toFlip.length} 条 / 已 true ${already.length} 条${problems.length ? ` / 问题 ${problems.length} 项` : ''}。`)
    console.log('确认无误后加 --apply 执行（apply 前会自动备份受影响行到 scripts/data/backup/）。')
    return
  }

  if (toFlip.length === 0) { console.log('\n无需写库（全部已 true）。'); return }

  mkdirSync(BACKUP_DIR, { recursive: true })
  const backupPath = join(BACKUP_DIR, `topic-only-${fileStamp()}.json`)
  writeFileSync(backupPath, JSON.stringify(toFlip.map((q) => ({ id: q.id, cue_card_title: q.cue_card_title, topic_only: q.topic_only })), null, 2), 'utf-8')
  console.log(`\n已备份 ${toFlip.length} 条受影响行（旧值）→ ${backupPath}`)

  const { error } = await sb.from('questions').update({ topic_only: true }).in('id', toFlip.map((q) => q.id))
  if (error) throw new Error(`写库失败：${error.message}`)
  console.log(`✓ 已置 topic_only=true：${toFlip.length} 条。`)
}

main().catch((e) => { console.error(e); process.exit(1) })
