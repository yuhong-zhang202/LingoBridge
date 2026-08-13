/**
 * dump-season-facekeys —— 当季题库 faceKey 全量快照 dumper。
 *
 * 背景：ranking 金标锚正从 questionId 改为 faceKey（归一化英文全 face），以根治「迁库/UUID 重生成打断金标」
 *       （产品方 2026-08-02 拍板，本步为加性第一步）。本脚本连当前在季题库，把每题的
 *       { questionId(新库 UUID), part, faceKey } dump 成快照，作为后续两项工作的依据：
 *         · 「锚失效 vs 真漏召回」两分（旧金标 questionId 在新库找不到时，用 faceKey 判断是同题换 UUID 还是真没这题）；
 *         · 旧金标 → 新库重映射（按 faceKey join 回填新 questionId）。
 *
 * 命根：faceKey 口径必须与 scripts/eval/run-ranking.ts 导出侧【字节一致】——
 *       同 questionFace（Part2 = cue_card_title + " — " + question_text，含 bullet 约束）+ 同 normalizeFace。
 *       本文件的 questionFaceEn / normalizeFace 逐字符复刻 src/lib/question-face.ts 与 src/services/ranking.ts:270。
 *       任一处漂移 → 快照与导出对不上 → 重映射全错。改动本文件务必同步核对两侧。
 *
 * 安全：连接串取自 $SUPABASE_DB_URL，【绝不打印连接串 / host / 任何凭据】。
 *
 * 用法：node --env-file=.env.local scripts/eval/dump-season-facekeys.mjs   （或 npm run eval:dump-facekeys）
 */
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = join(__dirname, 'results')
const OUT_PATH = join(RESULTS_DIR, 'season-facekeys-2026-05.json')
const SEASON = '2026-05'

// ── faceKey 口径（字节复刻，勿改）─────────────────────────────────────────────
// SEP：空格 + EM DASH(U+2014) + 空格，与 src/lib/question-face.ts:21 完全一致。
const SEP = ' — '

/**
 * 复刻 src/lib/question-face.ts 的 questionFace(...).en：
 * 有 cue_card_title（Part2 cue card）→ 标题 + 完整题面（question_text 含 bullet 约束）；
 * 无 → 直接 question_text。cue_card_title 的真值判断（null/'' 均为假）与 TS 侧一致。
 */
function questionFaceEn(cueCardTitle, questionText) {
  return cueCardTitle ? `${cueCardTitle}${SEP}${questionText}` : questionText
}

/** 复刻 src/services/ranking.ts:270 的 normalizeFace：压平空白 + trim + 转小写。 */
function normalizeFace(s) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

async function main() {
  const url = process.env.SUPABASE_DB_URL
  if (!url) { console.error('✗ 缺少 SUPABASE_DB_URL（请用 node --env-file=.env.local ...）'); process.exit(1) }

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  let rows
  try {
    // 当前在季全部题；part 排序仅为快照可读，不影响内容
    const res = await client.query(
      `SELECT id, part, question_text, cue_card_title
         FROM questions
        WHERE season = $1
        ORDER BY part, id`,
      [SEASON],
    )
    rows = res.rows
  } finally {
    await client.end()
  }

  const items = rows.map((r) => ({
    questionId: r.id,
    part: r.part,
    faceKey: normalizeFace(questionFaceEn(r.cue_card_title, r.question_text)),
  }))

  // faceKey 唯一性体检：同 faceKey 多题 = 重题（题库数据质量问题），必须暴露、不静默去重
  const byKey = new Map()
  for (const it of items) {
    if (!byKey.has(it.faceKey)) byKey.set(it.faceKey, [])
    byKey.get(it.faceKey).push(it.questionId)
  }
  const dupGroups = [...byKey.entries()].filter(([, ids]) => ids.length > 1)
  const emptyKeys = items.filter((it) => it.faceKey === '')

  const snapshot = {
    season: SEASON,
    generatedAt: new Date().toISOString(),
    faceKeyRecipe: 'normalizeFace(questionFace(q).en)：Part2=cue_card_title+" — "(U+2014)+question_text；normalize=压平空白+trim+lowercase。字节须与 scripts/eval/run-ranking.ts 导出侧一致。',
    total: items.length,
    uniqueFaceKeys: byKey.size,
    duplicateGroupCount: dupGroups.length,
    emptyFaceKeyCount: emptyKeys.length,
    // 重题清单：同 faceKey 对应的多个 questionId，供人工核（换季合并常见成因，需暴露非隐藏）
    duplicates: dupGroups.map(([faceKey, ids]) => ({ faceKey, questionIds: ids })),
    items,
  }

  mkdirSync(RESULTS_DIR, { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8')

  console.log(`✓ 当季(${SEASON}) faceKey 快照已写：${OUT_PATH}`)
  console.log(`  题数 total=${items.length}｜唯一 faceKey=${byKey.size}｜重题组=${dupGroups.length}｜空 faceKey=${emptyKeys.length}`)
  if (dupGroups.length > 0) {
    console.log('  ⚠ 存在同 faceKey 多题（重题/数据质量问题），前若干组：')
    for (const [faceKey, ids] of dupGroups.slice(0, 10)) {
      console.log(`    · [${ids.length} 题] ${faceKey.slice(0, 60)}${faceKey.length > 60 ? '…' : ''}  → ${ids.join(', ')}`)
    }
  }
  if (emptyKeys.length > 0) console.log(`  ⚠ 有 ${emptyKeys.length} 题 faceKey 为空（question_text 空/纯空白），需人工核`)
}

main().catch((e) => { console.error('✗ dump-season-facekeys 异常：', e instanceof Error ? e.message : e); process.exit(1) })
