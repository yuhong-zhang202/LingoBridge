/**
 * @module   page-route
 * @desc     pathname → page.view 的 route 枚举【唯一映射】。全仓库只有这一个文件接触 pathname，
 *           埋点链路上的其它任何地方都只见枚举 code、见不到路径原文。
 *
 *   🔴【隐私红线：这个文件存在的全部理由】埋点绝不能带 pathname 原文与 query。
 *     本项目 URL 上出现过的 query：`?qid=` / `?corpusId=` / `?h=`（handoff key）——
 *     最后那个**可反查到用户故事原文**。所以：
 *       · 本模块只接受 pathname，且进函数第一件事就是**显式剥掉 `?` 与 `#` 之后的一切**。
 *         `usePathname()` 本就不含 query，这一步是【物理闸】：防后人把 `useSearchParams()`
 *         的结果拼进来（那时不剥就直接把 handoff key 写进埋点库了）。
 *       · 白名单外一律返回 'other'，**永远不许兜底把路径本身塞进返回值**。
 *       · 返回类型是 PageRoute 联合类型，编译期就堵死「返回一个任意串」。
 *
 *   【与 PAGE_ROUTE 的关系】枚举真源在 lib/event-schema.ts；本文件只负责「哪个路径算哪个 code」。
 *     两份清单靠 lib/__tests__/page-route.test.ts 互相钉住：枚举里除 'other' 外的每个值都必须
 *     在映射表里出现，且 src/app 下每个 page.tsx 的路由都必须在映射表里（新加页面忘了登记会红）。
 *
 *   纯函数 + 纯常量，无运行时依赖：本模块被 'use client' 组件直接引用，禁止 import 任何 server 模块。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 */
import type { PageRoute } from '@/lib/event-schema'

/**
 * 路径 → route 枚举的白名单表（key = 不带尾斜杠的 pathname）。
 * ⚠️ 这是白名单不是「翻译表」：表里没有的路径一律 'other'，不做任何前缀匹配、不做任何拼接兜底。
 * 加页面时这里与 PAGE_ROUTE 各加一行（漏了会被 page-route.test.ts 红掉）。
 */
export const PATH_TO_ROUTE: Readonly<Record<string, PageRoute>> = {
  '/':                  'home',
  '/write':             'write',
  '/recording':         'recording',
  '/restructure':       'restructure',
  '/matching':          'matching',
  '/practice-question': 'practice_question',
  '/analysis':          'analysis',
  '/practice':          'practice',
  '/question-bank':     'question_bank',
  '/library':           'library',
  '/review':            'review',
  '/anki/review':       'anki_review',
  '/profile':           'profile',
  '/settings':          'settings',
  '/login':             'login',
  '/reset-password':    'reset_password',
  '/about':             'about',
  '/privacy':           'privacy',
  '/privacy/beta':      'privacy_beta',
  '/feedback':          'feedback',
  '/dashboard':         'dashboard',
}

/**
 * 把一个 pathname 映射成 route 枚举 code。
 * 只做三件事：剥 query/hash → 去尾斜杠 → 查白名单；查不到返回 'other'。
 * 刻意不做前缀匹配（`/foo/bar` 不会被算成 `/foo`）：那会让未来某个带 id 的子路由被静默归到父页，
 * 也会给「把路径片段带进枚举」开口子。
 * @param  pathname  当前路径（一律来自 usePathname()，不含 query；null/空串按 'other' 处理）
 * @returns          PAGE_ROUTE 里的枚举值；白名单外一律 'other'（绝不返回路径原文的任何片段）
 */
export function toPageRoute(pathname: string | null | undefined): PageRoute {
  if (typeof pathname !== 'string' || pathname === '') return 'other'
  // 显式剥 query 与 hash（见文件顶注的物理闸）：即便被喂进一个带 ?h=<handoff key> 的完整 URL，
  // 也只可能命中白名单或落 'other'，绝无路径/参数原文流出的路径。
  const bare = pathname.split('?')[0].split('#')[0]
  // 去掉尾斜杠（'/write/' 与 '/write' 同页），但根路径 '/' 保留原样
  const normalized = bare.length > 1 && bare.endsWith('/') ? bare.slice(0, -1) : bare
  return PATH_TO_ROUTE[normalized] ?? 'other'
}
