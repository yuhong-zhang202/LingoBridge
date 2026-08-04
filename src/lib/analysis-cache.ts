/**
 * @module   analysis-cache
 * @desc     【仅服务端】个性化分析缓存（corpus_question_analyses）的共享口径 —— level 收敛 + content_hash 构造。
 *           原本内联在 /api/analysis/route.ts，2026-08-04 因 /api/analysis/phrases 也要读写同一张表而抽出：
 *           两条路由的哈希必须【逐字节同口径】，否则 phrases 写的行 analysis 永远命不中（反之亦然），
 *           而这种失效是静默的、线上只表现为「缓存好像没用」。抽成单一真源即杜绝分叉（同 0049 迁移头的红线）。
 * @author   LingoBridge
 * @created  2026-08-04
 */
import 'server-only'
import { createHash } from 'crypto'

/** 个性化缓存的内容哈希底座：对喂给 AI 的语料正文取 sha256 hex。正文改了→哈希变→命中失效重算。 */
function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** 合法目标水平档位（与前端 LEVELS 一致）。服务端收敛：非枚举值（含超长/注入串）一律回落 '6.0'。 */
export const VALID_LEVELS: readonly string[] = ['5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0']
const VALID_LEVEL_SET: ReadonlySet<string> = new Set(VALID_LEVELS)

/**
 * 把 body.level 收敛到已知档位枚举 —— level 会直插 LLM prompt 且折进缓存 hash，不收敛则可被绕过客户端
 * 传超长串顶满单次 token 成本（在自身日额度内烧平台 AI 费），也会把缓存键打成一人一花色。
 * @param  raw  请求体里的 level 原值
 * @returns     合法档位；非字符串/非枚举一律 '6.0'（与缺省同）
 */
export function sanitizeLevel(raw: unknown): string {
  return typeof raw === 'string' && VALID_LEVEL_SET.has(raw) ? raw : '6.0'
}

/**
 * 缓存 content_hash：把 level 折进语料正文一起哈希——目标分不同则词组不同（analysis / phrases 都按 level 出词组），
 * 换目标分必须【未命中重算】、绝不返回旧档词组。读命中判定与写回填必须【同口径】调用此函数（否则 level 静默失效）。
 * @param  story  喂给 AI 的语料正文
 * @param  level  目标雅思水平（调用方须先过 sanitizeLevel）
 * @returns       折进 level 的内容哈希
 */
export function contentHashOf(story: string, level: string): string {
  return sha256(`${story}\nlevel=${level}`)
}

/**
 * 判断某个已存行的 content_hash 是否由【当前这份语料正文】生成（档位不限）。
 * 用途只有一个：phrases 路由做合并回填时，要确认已存行里的 structureLabel/focusPoints 骨架确实来自当前故事
 * ——骨架与 level 无关（level 只调词组难度），但与故事强相关；用户改过故事后骨架就过期了，
 * 若把过期骨架配上新词组写回并盖上「当前故事」的哈希，/api/analysis 下次就会命中一份【旧故事的侧重点】，
 * 正是 0049 迁移头点名的正确性红线。档位是 7 个值的小枚举，穷举比对即可判定，代价可忽略。
 * @param  contentHash  已存行的 content_hash
 * @param  story        当前喂给 AI 的语料正文
 * @returns             true=该行由当前正文生成（某个档位）；false=来自别的正文或别的哈希口径
 */
export function hashMatchesStoryAnyLevel(contentHash: string, story: string): boolean {
  return VALID_LEVELS.some((lv) => contentHashOf(story, lv) === contentHash)
}
