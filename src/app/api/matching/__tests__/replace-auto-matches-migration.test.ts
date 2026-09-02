/**
 * @module   replace-auto-matches-migration.test
 * @desc     0067 原子替换 RPC、chosen 保留、输入闭集与 RLS 收权的静态发布守卫。
 * @author   LingoBridge
 * @created  2026-09-02
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/0067_replace_auto_corpus_question_matches.sql'),
  'utf8',
).toLowerCase()

describe('0067 自动匹配原子替换迁移', () => {
  test('父行加锁并派生user_id，空集合也会删除全部非chosen后再插入', () => {
    expect(migration).toContain('from public.corpus c')
    expect(migration).toContain('for update')
    expect(migration).toContain('select v_user_id,')
    expect(migration).toContain("and match_level <> 'chosen'")
    expect(migration).toContain('on conflict (corpus_id, question_id) do nothing')
  })

  test('输入严格限制为最多349个唯一UUID及high/mid，并拒绝额外字段', () => {
    expect(migration).toContain('jsonb_array_length(p_matches) > 349')
    expect(migration).toContain('jsonb_object_keys(item.value)')
    expect(migration).not.toContain('jsonb_object_length')
    expect(migration).toContain("not in ('high', 'mid')")
    expect(migration).toContain("count(distinct (item.value ->> 'question_id')::uuid)")
  })

  test('RPC仅service_role可执行，客户端RLS只能读本人并最终写chosen', () => {
    expect(migration).toContain('security invoker')
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
    expect(migration).toContain('using ((select auth.uid()) = corpus_question_matches.user_id)')
    expect(migration).toContain("and match_level = 'chosen'")
    expect(migration).toContain('c.user_id = (select auth.uid())')
    expect(migration).toContain("has_function_privilege(\n       'anon'")
    expect(migration).toContain("has_function_privilege(\n       'authenticated'")
  })

  test('迁移一次性清除历史非chosen，保留用户主动选择', () => {
    const cleanup = migration.indexOf('delete from public.corpus_question_matches')
    const functionStart = migration.indexOf('create or replace function')
    expect(cleanup).toBeGreaterThanOrEqual(0)
    expect(cleanup).toBeLessThan(functionStart)
    expect(migration.slice(cleanup, functionStart)).toContain("where match_level <> 'chosen'")
  })
})
