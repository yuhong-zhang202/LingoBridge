/**
 * generate-questions-seed.mjs
 * 读取 ielts_questions_enriched.json，生成 supabase/seed_questions.sql
 * 运行: node scripts/seed/generate-questions-seed.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(
  readFileSync(join(__dirname, 'ielts_questions_enriched.json'), 'utf-8')
)

function esc(s) {
  if (s === null || s === undefined) return 'NULL'
  return `'${String(s).replace(/'/g, "''")}'`
}

const questionRows = []
const linkRows = []

// ── Part 1 ──
for (const topic of data.part1) {
  for (const q of topic.questions_with_zh) {
    const id = randomUUID()
    questionRows.push({
      id, part: 1, topic: topic.topic,
      qtext: q.en, qtextZh: q.zh,
      cueTitle: null, cueTitleZh: null,
      isNew: topic.is_new, topicOnly: false, parentId: null,
    })
    if (topic.observation_point) {
      linkRows.push({ questionId: id, obsCode: topic.observation_point })
    }
  }
}

// ── Part 2 + Part 3 ──
for (const card of data.part2) {
  const cardId = randomUUID()
  questionRows.push({
    id: cardId, part: 2, topic: card.title,
    qtext: card.cue_text, qtextZh: null,
    cueTitle: card.title, cueTitleZh: card.title_zh,
    isNew: card.is_new, topicOnly: card.topic_only, parentId: null,
  })
  if (card.observation_point && !card.topic_only) {
    linkRows.push({ questionId: cardId, obsCode: card.observation_point })
  }
  for (const p3 of card.part3_questions) {
    const id = randomUUID()
    questionRows.push({
      id, part: 3, topic: card.title,
      qtext: p3, qtextZh: null,
      cueTitle: null, cueTitleZh: null,
      isNew: card.is_new, topicOnly: false, parentId: cardId,
    })
  }
}

// ── 生成 SQL ──
let sql = `-- seed_questions.sql （自动生成，勿手改）
-- 题目: ${questionRows.length} 行 | 链接: ${linkRows.length} 行

BEGIN;

TRUNCATE TABLE question_observation_links CASCADE;
TRUNCATE TABLE questions CASCADE;

INSERT INTO questions
  (id, part, topic, question_text, question_text_zh, cue_card_title, cue_card_title_zh, is_new, topic_only, parent_card_id)
VALUES
`
sql += questionRows.map(r =>
  `  (${esc(r.id)}, ${r.part}, ${esc(r.topic)}, ${esc(r.qtext)}, ${esc(r.qtextZh)}, ${esc(r.cueTitle)}, ${esc(r.cueTitleZh)}, ${r.isNew}, ${r.topicOnly}, ${r.parentId ? esc(r.parentId) : 'NULL'})`
).join(',\n') + ';\n\n'

sql += `INSERT INTO question_observation_links (question_id, observation_point_id, is_primary)\nVALUES\n`
sql += linkRows.map(r =>
  `  (${esc(r.questionId)}, ${esc(r.obsCode)}, TRUE)`
).join(',\n') + ';\n\n'

sql += `COMMIT;\n`

writeFileSync(join(__dirname, '../../supabase/seed_questions.sql'), sql)

const byPart = { 1: 0, 2: 0, 3: 0 }
questionRows.forEach(r => byPart[r.part]++)
console.log(`生成完成: ${questionRows.length} 题 (P1=${byPart[1]} P2=${byPart[2]} P3=${byPart[3]}), ${linkRows.length} 链接`)
