/**
 * @module   scheme3-manifest.test
 * @desc     方案三 Manifest 与资产双 SHA-256 加载测试；仅写系统临时目录。
 * @author   LingoBridge
 * @created  2026-09-02
 */
jest.mock('server-only', () => ({}))

import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadScheme3ProductionAssets,
  SCHEME3_PRODUCTION_MANIFEST_SHA256,
} from '@/lib/scheme3-manifest'
import { SCHEME3_QUESTION_COUNT, type Scheme3AssetBundle } from '@/lib/scheme3-assets'

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function assetFixture(): Scheme3AssetBundle {
  return {
    schema: 'lingobridge.scheme3.production-assets.v1',
    algorithm_version: 'fixture-v1',
    embedding_model: 'text-embedding-v3',
    embedding_dimensions: 2,
    question_representation_version: 'question-text-plus-retrieval-description-v1',
    story_representation_version: 'raw-cleaned-text-query-v1',
    ranking_model: 'qwen-plus',
    ranking_system_prompt: '冻结Prompt',
    questions: Array.from({ length: SCHEME3_QUESTION_COUNT }, (_, index) => ({
      id: `q-${index}`,
      part: 2 as const,
      question_text: `Question ${index}`,
      question_text_zh: null,
      cue_card_title: null,
      cue_card_title_zh: null,
      is_new: false,
      topic_only: index === 0,
      embedding: [1, 0],
      contract: {
        requirements: [{ requirement_id: 'r1', hardness: 'HARD' as const, statement_zh: '事实' }],
        or_groups: [], allowed_medium_gaps: [], disallowed_inferences: [],
      },
    })),
  }
}

describe('方案三 Manifest loader', () => {
  test('Git内冻结生产资产可由固定Manifest SHA加载', async () => {
    const assets = await loadScheme3ProductionAssets({
      manifestPath: join(process.cwd(), 'src/assets/scheme3/manifest.json'),
      expectedManifestSha256: SCHEME3_PRODUCTION_MANIFEST_SHA256,
    })
    expect(assets.algorithm_version).toBe('scheme3-enhanced-key-r3-2026-09-02')
    expect(assets.questions).toHaveLength(349)
    expect(assets.embedding_dimensions).toBe(1024)
    expect(assets.questions.filter((question) => question.topic_only)).toHaveLength(18)
  })

  test('Manifest SHA、资产 SHA 与算法版本全部一致才加载', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scheme3-manifest-'))
    try {
      const assetRaw = `${JSON.stringify(assetFixture())}\n`
      const assetPath = join(directory, 'bundle.json')
      await writeFile(assetPath, assetRaw)
      const manifestRaw = `${JSON.stringify({
        schema: 'lingobridge.scheme3.production-manifest.v1',
        algorithm_version: 'fixture-v1',
        asset_file: 'bundle.json',
        asset_sha256: sha256(assetRaw),
      })}\n`
      const manifestPath = join(directory, 'manifest.json')
      await writeFile(manifestPath, manifestRaw)

      await expect(loadScheme3ProductionAssets({
        manifestPath,
        expectedManifestSha256: sha256(manifestRaw),
      })).resolves.toEqual(expect.objectContaining({ algorithm_version: 'fixture-v1' }))
      await expect(loadScheme3ProductionAssets({
        manifestPath,
        expectedManifestSha256: '0'.repeat(64),
      })).rejects.toThrow('Manifest SHA-256 不匹配')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
