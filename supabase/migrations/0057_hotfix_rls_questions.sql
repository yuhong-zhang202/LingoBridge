-- -----------------------------------------------------------------------------
-- Migration : 0057_hotfix_rls_questions（安全 hotfix）
-- Desc      : questions / question_observation_links / _schema_migrations 三张表从未开过 RLS，
--             匿名（浏览器里就能拿到的 anon key）可以任意写。实测证据（2026-08-06）：
--               DELETE /rest/v1/questions?id=eq.<不存在的 id>          → HTTP 200（权限放行，0 行匹配）
--               PATCH  /rest/v1/questions?id=eq.<不存在的 id>          → HTTP 200
--               POST   /rest/v1/questions                             → 23502（非空约束，说明权限已过）
--             也就是说 `DELETE /rest/v1/questions?id=neq.<任意 uuid>` 能删光整个题库。
--             本迁移开 RLS 并按最小权限重建：题库可读不可写，迁移记账表对客户端完全不可见。
-- Created   : 2026-08-06
-- -----------------------------------------------------------------------------
-- ⚠️ 本文件刻意不带 begin/commit：db:push 会自动把整份迁移包进事务，自带事务会嵌套出错。

-- ── questions：客户端要读（题库页 / 写作页 / 练习选题经 lib/db/questions.ts 直查），只读不写 ──
alter table public.questions enable row level security;
drop policy if exists questions_public_read on public.questions;
create policy questions_public_read on public.questions
  for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.questions from anon, authenticated;

-- ── question_observation_links：同上，观察点匹配要读 ──
alter table public.question_observation_links enable row level security;
drop policy if exists qol_public_read on public.question_observation_links;
create policy qol_public_read on public.question_observation_links
  for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.question_observation_links from anon, authenticated;

-- ── _schema_migrations：迁移记账表，纯内部。不建任何策略 = 客户端角色一行都读不到 ──
-- （开了 RLS 又没有策略，对 anon/authenticated 就是全拒；service_role 与表属主 postgres 绕过 RLS，
--   所以 db:push 直连与服务端读写都不受影响。）
alter table public._schema_migrations enable row level security;
revoke all on public._schema_migrations from anon, authenticated;

-- 【为什么写权限用 revoke 而不是只靠「不建写策略」】两层都要：
-- RLS 无策略即拒绝，本已足够；但 revoke 把权限在 GRANT 层也摘掉，形成第二道闸 ——
-- 万一将来有人为了别的需求给这张表补了一条宽松策略（比如 `for all using (true)`），
-- GRANT 层仍然挡着写操作。0052 / 0054 的教训是「新对象默认裸奔」，这里的教训是
-- 「老对象可能从建表起就没穿」：0001_init_schema 建 questions 时没开 RLS，之后 56 个迁移
-- 没人回头补，直到 Supabase 安全顾问发邮件才发现。
--
-- 【复验方法】（改完必须实跑，别只看迁移成功）：
--   拿 anon key 对 questions 发一次 select（应 200 且有数据）、一次 delete（应 401/403），
--   对 _schema_migrations 发 select（应 401/403）。
