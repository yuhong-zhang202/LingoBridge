/**
 * @module   scheme3-manifest
 * @desc     方案三生产 Manifest 与资产文件的双 SHA-256 校验加载器；任一不一致即拒绝启动。
 * @author   LingoBridge
 * @created  2026-09-02
 */
import 'server-only'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { parseScheme3AssetBundle, type Scheme3AssetBundle } from '@/lib/scheme3-assets'

/** 与Git内生产Manifest逐字绑定；替换资产必须同时显式改此值与算法版本。 */
export const SCHEME3_PRODUCTION_MANIFEST_SHA256 = 'a336743a409607be1ea8445603ced4b559f1c72d200316b22cf0e94d5724271e'

export interface Scheme3ProductionManifest {
  schema: 'lingobridge.scheme3.production-manifest.v1'
  algorithm_version: string
  asset_file: string
  asset_sha256: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function parseManifest(value: unknown): Scheme3ProductionManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('方案三 Manifest 根必须是对象')
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== 'algorithm_version,asset_file,asset_sha256,schema'
    || record.schema !== 'lingobridge.scheme3.production-manifest.v1'
    || typeof record.algorithm_version !== 'string'
    || record.algorithm_version.trim().length === 0
    || typeof record.asset_file !== 'string'
    || basename(record.asset_file) !== record.asset_file
    || !record.asset_file.endsWith('.json')
    || !isSha256(record.asset_sha256)) {
    throw new Error('方案三 Manifest 字段不合法')
  }
  return record as unknown as Scheme3ProductionManifest
}

/**
 * 读取并双重校验生产 Manifest 与相邻资产文件。
 * @param  options.manifestPath            Manifest 绝对路径
 * @param  options.expectedManifestSha256  发布配置预先钉死的 Manifest SHA-256
 * @returns                                已严格校验的资产包
 * @sideEffect                             只读两个本地静态文件，不访问网络或数据库
 */
export async function loadScheme3ProductionAssets(options: {
  manifestPath: string
  expectedManifestSha256: string
}): Promise<Scheme3AssetBundle> {
  if (!options.manifestPath.startsWith('/') || !isSha256(options.expectedManifestSha256)) {
    throw new Error('方案三 Manifest 路径或预期 SHA-256 未配置')
  }
  const manifestRaw = await readFile(options.manifestPath, 'utf8')
  if (sha256(manifestRaw) !== options.expectedManifestSha256) {
    throw new Error('方案三 Manifest SHA-256 不匹配')
  }
  const manifest = parseManifest(JSON.parse(manifestRaw) as unknown)
  const assetRaw = await readFile(join(dirname(options.manifestPath), manifest.asset_file), 'utf8')
  if (sha256(assetRaw) !== manifest.asset_sha256) throw new Error('方案三资产 SHA-256 不匹配')
  const assets = parseScheme3AssetBundle(JSON.parse(assetRaw) as unknown)
  if (assets.algorithm_version !== manifest.algorithm_version) {
    throw new Error('方案三 Manifest 与资产算法版本不一致')
  }
  return assets
}
