-- -----------------------------------------------------------------------------
-- Migration : 0014_tighten_rls
-- Desc      : 收窄两处数据库层旁路（服务端 API 已防，DB 层仍开着后门）：
--             A. corpus 原策略 own_corpus_all 是 FOR ALL（含 INSERT），客户端可直连 insert 绕过
--                /api/corpus 的服务端配额。收窄为 select/update/delete 三条，不建 INSERT 策略
--                → RLS 默认拒绝客户端插入；语料创建唯一入口是 /api/corpus（service_role 绕 RLS + 配额）。
--             B. api_usage_logs 的 insert 策略 with check(true)，任何 authenticated（含匿名）会话都能
--                往成本表灌水。删掉该策略，写入改由 service_role 承担（见 api-logger.ts）。
--             幂等：每条 create 前先 drop policy if exists，enable RLS 本身幂等，可安全重跑。
-- Created   : 2026-07-12
-- -----------------------------------------------------------------------------

-- ── A. 收窄 corpus：own_corpus_all(FOR ALL) → select/update/delete，INSERT 收归服务端 ──
alter table public.corpus enable row level security;

drop policy if exists "own_corpus_all"    on public.corpus;

drop policy if exists "own_corpus_select" on public.corpus;
create policy "own_corpus_select" on public.corpus
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own_corpus_update" on public.corpus;
create policy "own_corpus_update" on public.corpus
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_corpus_delete" on public.corpus;
create policy "own_corpus_delete" on public.corpus
  for delete to authenticated using (auth.uid() = user_id);
-- 故意不建 INSERT 策略：RLS 启用后无 INSERT 策略即默认拒绝客户端插入；
-- 语料创建唯一入口是 /api/corpus，其 createCorpusServer 用 service_role 绕过 RLS，不受影响。

-- ── B. 关闭 api_usage_logs 客户端灌水：删除宽松 insert 策略 ──
alter table public.api_usage_logs enable row level security;

drop policy if exists "api_usage_logs_insert" on public.api_usage_logs;
-- 不重建 insert 策略：日志写入改由 service_role 承担（api-logger.ts，绕 RLS），客户端无 insert 权限；
-- RLS 保持启用，读取仍仅 service_role（0012 未建 select 策略，默认拒绝）。
