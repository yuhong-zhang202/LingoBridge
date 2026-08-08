/**
 * @module   api-auth-corpus-owner.test
 * @desc     事故守卫②：assertCorpusOwner —— 跨用户越权的唯一一道防线。
 *
 *           为什么是「唯一」：服务端一律用 service_role client 读写，它【完全绕过 RLS】，
 *           数据库层不会替我们挡任何东西；语料（用户的私密日记原文）的归属校验只发生在这一个函数里。
 *           调用它的路由见文件末尾清单 —— 拿着自己的合法 token、把 corpusId 换成别人的，
 *           这个函数一旦失效，就是直接读到别人的日记 / 拿别人的语料去跑 AI。
 *
 *           为什么要专门写：2026-08-06 架构审计把本函数改成空实现（直接 return），跑全量 790 条
 *           测试【一条不红】。原因是全站每个路由测试都 `jest.mock('@/lib/api-auth')` 把它整个换成
 *           jest.fn()，于是「路由调了它」被测了很多遍，「它自己拦不拦得住」一次都没被测过。
 *           本文件不 mock api-auth，跑真实实现，只 stub 它下面的 Supabase client。
 *
 *           【行为】=1~4，【结构】=5（钉住「它必须真的去查库」，专治空实现变异）。
 * @author   LingoBridge
 * @created  2026-08-08
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/env-server', () => ({ env: { adminEmails: '' } }))
// api-auth 模块级 import 了 jwt-verify（内部依赖纯 ESM 的 jose，ts-jest 转 CommonJS 解析不了会整套件崩）。
// 本套件不走验签路径，mock 掉即可；assertCorpusOwner 本身与验签无关。
jest.mock('@/lib/jwt-verify', () => ({ verifyAccessToken: jest.fn() }))

/** 持有当前 supabase mock（jest 工厂只允许引用 mock* 前缀的外部变量） */
const mockSupabaseHolder: { current: unknown } = { current: null }
jest.mock('@/lib/supabase-server', () => ({ getSupabaseServer: () => mockSupabaseHolder.current }))

import { assertCorpusOwner } from '@/lib/api-auth'

/** 一次 corpus 归属查询被怎么调的（探针，供【结构】用例断言「真的查了库」） */
interface QuerySpy {
  tables: string[]
  selects: string[]
  eqs: Array<[string, string]>
  maybeSingleCalls: number
}

let spy: QuerySpy

/**
 * 装配 Supabase stub：corpus 表的归属查询返回指定结果。
 * @param row 查询命中的行（null = corpus 不存在）；传 'error' 表示查询报错
 */
function setupCorpus(row: { user_id: string } | null | 'error'): void {
  spy = { tables: [], selects: [], eqs: [], maybeSingleCalls: 0 }
  mockSupabaseHolder.current = {
    from: (table: string) => {
      spy.tables.push(table)
      return {
        select: (cols: string) => {
          spy.selects.push(cols)
          return {
            eq: (col: string, val: string) => {
              spy.eqs.push([col, val])
              return {
                maybeSingle: () => {
                  spy.maybeSingleCalls += 1
                  return Promise.resolve(
                    row === 'error'
                      ? { data: null, error: { message: 'boom' } }
                      : { data: row, error: null },
                  )
                },
              }
            },
          }
        },
      }
    },
  }
}

describe('assertCorpusOwner【行为】别人的语料一律拒', () => {
  test('1. corpus 属于别人 → 抛 403 FORBIDDEN（这就是「拿自己的 token 读别人日记」那条路）', async () => {
    setupCorpus({ user_id: 'owner-别人' })

    await expect(assertCorpusOwner('attacker-我', 'c1')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })
  })

  test('2. corpus 不存在（查无此行）→ 抛 403，不是静默放行', async () => {
    // 归属不明 = 拒。若这里放行，攻击者可以用不存在的 id 骗过归属闸、进到下游按 id 去写/去跑 AI 的分支。
    setupCorpus(null)

    await expect(assertCorpusOwner('u1', '不存在的-id')).rejects.toMatchObject({ status: 403 })
  })

  test('3. 查询报错 → 抛 403（fail-closed）。刻意与白名单闸的 fail-open 相反：那是内测便利，这是越权防线', async () => {
    setupCorpus('error')

    await expect(assertCorpusOwner('u1', 'c1')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  test('4. user_id 只认全等，不认「前缀相同」这类近似（防将来把比较写松）', async () => {
    setupCorpus({ user_id: 'u1-extra' })

    await expect(assertCorpusOwner('u1', 'c1')).rejects.toMatchObject({ status: 403 })
  })
})

describe('assertCorpusOwner【行为】自己的语料放行', () => {
  test('5. corpus.user_id === 调用者 → resolve，不抛', async () => {
    setupCorpus({ user_id: 'u1' })

    await expect(assertCorpusOwner('u1', 'c1')).resolves.toBeUndefined()
  })
})

describe('assertCorpusOwner【结构】它必须真的去查库 —— 专治「改成空实现」', () => {
  test('6. 放行的那一次，确实查了 corpus 表、且是按传入的 corpusId 过滤的', async () => {
    // 上面的拒绝用例已经能杀死「直接 return」的空实现，但杀不死「只查一次固定行 / 忘了带 eq(id)」这类
    // 半空实现：那种改法下所有人拿任意 id 都会读到同一行，测试仍可能碰巧全绿。这里把「查了什么」钉死。
    setupCorpus({ user_id: 'u1' })

    await assertCorpusOwner('u1', 'c-归属校验的那个id')

    expect(spy.tables).toEqual(['corpus'])
    expect(spy.selects).toEqual(['user_id'])
    expect(spy.eqs).toEqual([['id', 'c-归属校验的那个id']])
    expect(spy.maybeSingleCalls).toBe(1)
  })
})

/**
 * 依赖这一个函数守越权的调用点（2026-08-08 grep 全仓核对，共 8 处 await、落在 6 个路由文件）：
 *   1. src/app/api/matching/route.ts:117        POST 阻塞路（?stream=0）—— 无条件调
 *   2. src/app/api/matching/route.ts:344        POST 流式路（默认）—— 无条件调
 *   3. src/app/api/analysis/route.ts:99         POST 阻塞路 —— `if (storyId)` 有条件调
 *   4. src/app/api/analysis/route.ts:309        POST 流式路 —— `if (storyId)` 有条件调
 *   5. src/app/api/analysis/phrases/route.ts:112  —— `if (storyId)` 有条件调
 *   6. src/app/api/practice/route.ts:86           —— `if (body.storyId)` 有条件调
 *   7. src/app/api/anki/cards/route.ts:87         —— 无条件调
 *   8. src/app/api/anki/cards/corpus/route.ts:47  —— 无条件调
 *
 * 「有条件调」的那几处不是漏洞：不传 storyId 时那些路由根本不按 id 取语料（正文由请求体直接带），
 * 没有可越权的对象。但这也意味着——本文件守得住「函数本身失效」，守不住「某个路由忘了调它」。
 * 后者要另立一条静态扫描守卫（本次未做，属范围外）。
 */
