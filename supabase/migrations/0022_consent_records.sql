-- -----------------------------------------------------------------------------
-- Migration : 0022_consent_records
-- Desc      : 「真捕获同意」落库 —— 首次使用同意闸点击「同意并开始」时，服务端 service_role
--             往本表插一条不可变同意记录（谁、同意的哪一版披露、当时展示的范围原文快照、时间戳）。
--             此前同意只写 localStorage（可清、无凭据、跨端不通），无法证明「用户确实看过并同意过」；
--             本表把同意变成服务端可查证的记录。
--             ⚠️ 数据库改动，需部署方手动跑（形态同 0020/0021）：Supabase 控制台 SQL Editor 或 CI 迁移流程执行。
--             幂等：create table / policy / index 均 if not exists（policy 用 DO 块判存在），可安全重跑（对齐 0020/0021）。
--             数据最小化：故意【不记 ip / user_agent】（产品方 2026-07-18 决策3）。
--             不可变：只插不改（无 update/delete 策略、无触发器改写）；撤回=删号（决策5），删号时硬删本表（决策4，走 account/delete）。
-- Created   : 2026-07-18
-- -----------------------------------------------------------------------------

-- consent_type：本轮只用 'beta_general'（内测总体同意）；'benchmark'（金标入选二次同意）仅预留列，本轮不建流程。
-- corpus_id：仅 benchmark 型同意才关联具体语料，beta_general 恒为 null（预留，本轮不写）。
-- user_id 不建外键（不随 auth.users 删除级联）——删号时走 account/delete 的显式硬删（决策4），与 0020/0021 同款「不信 FK cascade」纪律。
-- scope_snapshot：同意当刻弹窗展示的披露范围原文快照（jsonb），来源 src/lib/privacy-copy.ts 的 CONSENT_SCOPE_SNAPSHOT；
--                 冻结「用户当时到底看到、同意了什么」，日后披露改版也不篡改历史记录。
create table if not exists public.consent_records (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,                                   -- 同意人；匿名会话也记（决策2 允许匿名同意）
  consent_version int,                                             -- 同意的披露版本（= BETA_PRIVACY_VERSION，措辞实质变更即 bump→重签）
  consent_type    text not null default 'beta_general'
                    check (consent_type in ('beta_general', 'benchmark')),
  corpus_id       uuid,                                            -- 仅 benchmark 型关联语料；beta_general 为 null（本轮不写）
  scope_snapshot  jsonb,                                           -- 同意时展示的范围原文快照（冻结「看到了什么」）
  agreed_at       timestamptz not null default now(),
  is_anonymous    boolean                                          -- 同意时会话是否匿名（未注册）
);

-- 检索索引：按用户查全部同意记录；按 (用户, 版本) 判「当前版本是否已同意」（同意闸读路径的主查询）；
-- corpus_id 部分索引仅覆盖 benchmark 型（beta_general 恒 null，不占索引）。
create index if not exists consent_records_user_idx         on public.consent_records (user_id);
create index if not exists consent_records_user_version_idx on public.consent_records (user_id, consent_version);
create index if not exists consent_records_corpus_idx       on public.consent_records (corpus_id) where corpus_id is not null;

-- ── RLS：只读己、写入唯一走 service_role ─────────────────────────────
-- 启用 RLS（幂等）。只建【SELECT-own】策略——用户能读自己的同意记录（同意闸读路径查库据此判是否已签）；
-- 故意【不建 insert / update / delete 策略】：写入唯一入口是 /api/consent 的 service_role（绕 RLS），
-- 客户端持 anon key 一律无法自行插改删同意记录 → 记录不可被伪造/篡改（对齐 0009 own_all，但此处收紧为只读）。
alter table public.consent_records enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'consent_records' and policyname = 'own_consent_records_select'
  ) then
    create policy "own_consent_records_select" on public.consent_records for select to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;
