/**
 * @module   corpus-delete.test
 * @desc     守卫：删语料【真的会清空绑定题卡的卡背】，且这件事与删语料行在同一个事务里完成。
 *
 *   【为什么需要这条守卫】2026-08-07 确证的线上问题：UI 承诺「删除后，绑定的题卡会退回题目分析
 *   （卡背清空）」，而 deleteCorpus 实际只删 corpus_point_links + corpus 行，靠 0030 的外键
 *   `on delete set null` 收尾 —— 那个外键【只抹 corpus_id，generated_answer / edited_answer
 *   原封不动】。用户删掉了自己讲的故事，基于该故事生成的英文答案却仍留在题卡上，
 *   而系统告诉他删干净了（既骗了用户，也不合规）。修复见 0060 + deleteCorpus 改走 RPC。
 *
 *   【这个 bug 为什么能活这么久 → 决定了守卫要钉在哪】它是【静默】的：删除照常成功、Toast 照常
 *   报「已退回题目分析」、对子列表照常消失，只有回到题卡才看得见残留的卡背。没有任何一步会报错。
 *   所以不能指望「跑一跑就发现」，必须把行为钉死成机器检查。
 *
 *   【三层守卫，各守什么】
 *     ① lib 层（describe 一）：deleteCorpus 只经单条原子 RPC 派发，不退回多条独立 app 层 DML
 *        （那正是旧实现的原子性缺口），且 RPC 报错一律抛出、绝不静默。范式同 anki-cards-server.test.ts。
 *     ② 迁移 SQL 语义（describe 二）：真正清卡背的逻辑在 plpgsql 里，TS 侧一行都测不到 ——
 *        故直接对 0060 的 SQL 文本做结构化断言，钉死「两个答案字段都清」「不限 question_id 所以
 *        同源多卡全清」「update 在 delete 之前」「不收 user_id 参数 / 不提权」这几条正确性红线。
 *        ⚠️ 这【不是】真库验证：事务原子性、RLS 实际生效、cascade 行为仍须真实 PG 上跑一遍
 *        （本轮无就绪库，且本仓库红线禁止 agent 连生产库）。本层守的是「代码被改坏」，
 *        不是「代码在真库上跑对」。
 *     ③ 调用方（describe 三）：删除失败必须让用户看见，不许吞错。同样是源码守卫 ——
 *        本仓库无 jsdom / testing-library，且本轮禁止引入新依赖，做不了组件渲染测试。
 *
 *   【触发本守卫后怎么办】不要改测试来迁就实现。先回去看 0060 顶注确认口径
 *   （generated_answer 与 edited_answer 一起清，是产品方拍板的，别单方面改回去）。
 * @author   LingoBridge
 * @created  2026-08-07
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

jest.mock('@/lib/supabase', () => ({
  getSupabase: jest.fn(),
  ensureSession: jest.fn(() => Promise.resolve('u1')),
}))

import { deleteCorpus } from '@/lib/db/corpus'
import { getSupabase } from '@/lib/supabase'

const mockGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>

/** 装一个只暴露 rpc 的假 client；from() 若被调到即断言失败（证明未退回旧的多条独立 DML）。 */
function mockClient(rpc: jest.Mock): void {
  const from = jest.fn(() => {
    throw new Error('不应再走 .from() 多条 DML —— 删语料须收敛为单条原子 RPC（0060）')
  })
  mockGetSupabase.mockReturnValue({ rpc, from } as unknown as ReturnType<typeof getSupabase>)
}

// ── 一、lib 层：只经单条原子 RPC，失败必抛 ──────────────────────────────────────
describe('deleteCorpus · 只经 delete_corpus_and_clear_cards 原子 RPC', () => {
  beforeEach(() => jest.clearAllMocks())

  it('只传 p_corpus_id、不触碰 .from()（清卡背+删语料同事务，不再拆 DML）', async () => {
    const rpc = jest.fn(() => Promise.resolve({ data: null, error: null }))
    mockClient(rpc)
    await deleteCorpus('c-1')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('delete_corpus_and_clear_cards', { p_corpus_id: 'c-1' })
  })

  it('绝不把 user_id 当参数传 —— 客户端能传的 id 一律不可信，身份只能取自 JWT', async () => {
    // 这里的 rpc 替身刻意声明了形参类型：无参数的 jest.fn() 推不出 mock.calls 的元素类型，
    // 下面按 [1] 取实参会被 tsc 判成越界（strict 下报 TS2493），且用 any 绕过是本仓库禁止的。
    const rpc = jest.fn((_fn: string, _args: Record<string, unknown>) =>
      Promise.resolve({ data: null, error: null }))
    mockClient(rpc)
    await deleteCorpus('c-1')
    const args = rpc.mock.calls[0][1]
    expect(Object.keys(args)).toEqual(['p_corpus_id'])
  })

  it('没绑任何题的语料也照常删（RPC 对 update 命中 0 行不报错，lib 侧无特判）', async () => {
    // 语义边界：未绑题 = 没有卡背可清，RPC 的 update 命中 0 行、delete 照常执行。
    // lib 层不该对此有任何分支（有分支就说明它又开始自己判断 DB 状态了）。
    const rpc = jest.fn(() => Promise.resolve({ data: null, error: null }))
    mockClient(rpc)
    await expect(deleteCorpus('c-未绑题')).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('RPC 报错 → 抛出（含迁移未应用时的 PGRST202），绝不静默', async () => {
    const rpc = jest.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } }))
    mockClient(rpc)
    await expect(deleteCorpus('c-1')).rejects.toThrow('删除语料失败：boom')
  })

  it('函数不存在（迁移没跑）时同样抛出，不会退化成「删了语料但没清卡背」', async () => {
    const rpc = jest.fn(() => Promise.resolve({
      data: null,
      error: { message: 'Could not find the function public.delete_corpus_and_clear_cards' },
    }))
    mockClient(rpc)
    await expect(deleteCorpus('c-1')).rejects.toThrow(/删除语料失败：.*Could not find the function/)
  })
})

// ── 二、迁移 SQL 语义守卫 ──────────────────────────────────────────────────────
/** 读 0060 迁移原文。 */
function readMigration(): string {
  return readFileSync(
    join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0060_delete_corpus_clears_anki_back.sql'),
    'utf8',
  )
}

/**
 * 剥掉 SQL 里的行注释，只留可执行代码。
 * 必须剥：本迁移的注释里大量出现 generated_answer / edited_answer / user_id 等词（顶注在解释
 * 这个 bug 本身），不剥的话下面所有断言都会被注释「喂饱」，实现改坏了也照样绿 —— 那是最坏的假绿。
 */
function sqlCode(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--')
      return i === -1 ? line : line.slice(0, i)
    })
    .join('\n')
}

/**
 * 把已剥注释的 SQL 压平成「单空格 + 小写」一整行，便于稳定匹配。
 * 先压平再找 needle：SQL 里为对齐用了多空格（如 `grant  execute`），
 * 直接在原文上 indexOf 会因排版而漏匹配，进而让守卫变成脆弱的排版检查。
 */
function flatten(code: string): string {
  return code.replace(/\s+/g, ' ').toLowerCase()
}

/** 取从 needle 起到下一个分号为止的一整条语句（已剥注释、压平空白、转小写）。 */
function statementFrom(code: string, needle: string): string {
  const flat = flatten(code)
  const start = flat.indexOf(needle)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = flat.indexOf(';', start)
  expect(end).toBeGreaterThan(start)
  return flat.slice(start, end)
}

describe('0060 迁移 SQL · 删语料清卡背的正确性红线', () => {
  const raw = readMigration()
  const code = sqlCode(raw)
  const lower = flatten(code)

  it('幂等：create or replace，可安全重跑', () => {
    expect(lower).toContain('create or replace function public.delete_corpus_and_clear_cards')
  })

  it('签名只收 p_corpus_id —— 没有可被伪造的 user_id 入参（越权防线①）', () => {
    const sig = statementFrom(code, 'create or replace function public.delete_corpus_and_clear_cards')
    const params = sig.slice(sig.indexOf('('), sig.indexOf(')') + 1)
    expect(params).toContain('p_corpus_id uuid')
    expect(params).not.toContain('user_id')
  })

  it('不提权：绝不是 security definer（越权防线② —— 靠 RLS 逐行挡住别人的数据）', () => {
    expect(lower).not.toContain('security definer')
  })

  it('身份取自 auth.uid()，且为 null 时拒绝执行', () => {
    expect(lower).toContain('auth.uid()')
    expect(lower).toContain('if v_uid is null then')
    expect(lower).toContain('raise exception')
  })

  describe('清卡背的 update 语句', () => {
    const upd = statementFrom(code, 'update public.anki_cards')

    it('generated_answer 与 edited_answer【都】置空（口径见 0060，产品方拍板）', () => {
      // ⚠️ 变异守卫：删掉 edited_answer 那一行（退回 0035 unbind 的旧口径）→ 本条变红。
      expect(upd).toContain('generated_answer = null')
      expect(upd).toContain('edited_answer = null')
    })

    it('corpus_id 一并置空（题卡退回题目分析）', () => {
      expect(upd).toContain('corpus_id = null')
    })

    it('不限 question_id / 不限行数 —— 同一语料绑多题时全部题卡都被清', () => {
      // ⚠️ 变异守卫：为「只清第一张卡」而加 question_id 条件、limit 或 in (select ... limit 1) → 本条变红。
      expect(upd).not.toContain('question_id')
      expect(upd).not.toContain('limit')
      expect(upd).not.toContain('select')
    })

    it('where 只由 corpus_id + user_id 两个条件构成（RLS 之外的第二道防线）', () => {
      const where = upd.slice(upd.indexOf('where'))
      expect(where).toContain('corpus_id = p_corpus_id')
      expect(where).toContain('user_id = v_uid')
      // 「and」恰好一个 → 只有两个条件，没有被偷偷放宽或收窄
      expect((where.match(/\band\b/g) ?? []).length).toBe(1)
    })

    it('绝不动 SRS 进度（box / due_at / last_reviewed_at）', () => {
      expect(upd).not.toContain('box')
      expect(upd).not.toContain('due_at')
      expect(upd).not.toContain('last_reviewed_at')
    })
  })

  it('删语料行时同样按 auth.uid() 过滤', () => {
    const del = statementFrom(code, 'delete from public.corpus')
    expect(del).toContain('id = p_corpus_id')
    expect(del).toContain('user_id = v_uid')
  })

  it('先清卡背、后删语料 —— 顺序反了会被外键 set null 抹掉 corpus_id，导致卡背静默漏清', () => {
    // ⚠️ 这是本次修复里最容易被「顺手整理一下」改坏、且改坏后完全静默的一处。
    const iUpdate = lower.indexOf('update public.anki_cards')
    const iDelete = lower.indexOf('delete from public.corpus')
    expect(iUpdate).toBeGreaterThanOrEqual(0)
    expect(iDelete).toBeGreaterThan(iUpdate)
  })

  describe('授权（0052 的教训：新建函数默认对 PUBLIC/anon 敞开，必须自带 revoke）', () => {
    it('从 public 与 anon 收权', () => {
      const rev = statementFrom(code, 'revoke execute on function public.delete_corpus_and_clear_cards')
      expect(rev).toContain('from public, anon')
    })

    it('只授 authenticated（登录用户自己调；service_role 无调用点且 auth.uid() 为 null）', () => {
      const gr = statementFrom(code, 'grant execute on function public.delete_corpus_and_clear_cards')
      expect(gr).toContain('to authenticated')
      expect(gr).not.toContain('service_role')
      expect(gr).not.toContain('anon')
    })

    it('带 ACL 守卫（收错权的两个方向都是静默失败，须在迁移里当场炸掉）', () => {
      expect(lower).toContain("has_function_privilege('authenticated'")
      expect(lower).toContain("has_function_privilege('anon'")
    })
  })

  it('固定 search_path（防表名劫持，同 0035 范式）', () => {
    expect(lower).toContain('set search_path = public, pg_temp')
  })

  it('不自带 begin/commit（db:push 已按文件包事务，自带会嵌套出错）', () => {
    // 用未压平的 code：这条要看「独占一行的 begin;/commit;」，压平后行首锚点就没了。
    // plpgsql 函数体里的 begin 不带分号，不会被这个正则误伤。
    expect(code.toLowerCase()).not.toMatch(/^\s*begin\s*;/m)
    expect(code.toLowerCase()).not.toMatch(/^\s*commit\s*;/m)
  })
})

// ── 三、调用方：删除失败必须让用户看见 ─────────────────────────────────────────
// 2026-08-08 改版：调用方由「语料匹配」tab（CorpusMatchesTab，按对子铺卡）换成「我的语料」tab
// （MyCorpusTab，一条语料一张卡），确认文案抽到 my-corpus-model.ts。守的东西一条没变。
describe('MyCorpusTab · 删除失败不许静默', () => {
  const src = readFileSync(
    join(__dirname, '..', '..', '..', 'app', 'library', 'MyCorpusTab.tsx'),
    'utf8',
  )

  it('移动端确认删除：await deleteCorpus + catch 里报「删除失败」Toast', () => {
    // ⚠️ 变异守卫：去掉 await 改成 fire-and-forget、或 catch 里只 console.warn 不提示 → 本条变红。
    const start = src.indexOf('const handleConfirmDelete')
    expect(start).toBeGreaterThanOrEqual(0)
    const body = src.slice(start, src.indexOf('\n  }', start))
    expect(body).toContain('await deleteCorpus(target.id)')
    expect(body).toContain('catch')
    expect(body).toContain("setToast('删除失败，请重试')")
  })

  it('桌面批量删除：deleteCorpus 的 promise 带 .catch，不留未处理拒绝', () => {
    const start = src.indexOf('const removeFn')
    expect(start).toBeGreaterThanOrEqual(0)
    const body = src.slice(start, src.indexOf('\n  }, [])', start))
    expect(body).toContain('deleteCorpus(corpusId)')
    expect(body).toContain('.catch(')
  })

  it('确认框文案与新行为相符：点明卡背清空【含用户手动编辑过的内容】', () => {
    // 删语料同时清 generated_answer 与 edited_answer，后者是用户亲手写的、损失更重，
    // 不可逆操作的确认框必须让他知情后再点。文案改软 = 又回到「承诺与行为不符」。
    // 文案现在住在 model 层（两条路径共用一份），故守卫跟着挪过去。
    const model = readFileSync(
      join(__dirname, '..', '..', '..', 'app', 'library', 'my-corpus-model.ts'),
      'utf8',
    )
    expect(model).toContain('卡背清空（含你手动编辑过的内容）')
    // 「不可撤销」的措辞由 ux 改成「删除后没法找回」（同一件事，用户话），知情强度不降
    expect(model).toContain('删除后没法找回')
  })
})
