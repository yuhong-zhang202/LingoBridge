-- -----------------------------------------------------------------------------
-- Migration : 0021_api_usage_logs_attribution
-- Desc      : 给 api_usage_logs 补三列归属字段 —— user_id / corpus_id / is_anonymous。
--             病根：每个发 AI 调用的路由手里都有 userId / corpusId / isAnonymous（已喂给留证），
--             但记费用那步把它们丢了，导致成本无法按用户/语料/匿名归因（不可逆的账，越早补越少缺口）。
--             ⚠️ 数据库改动，需部署方手动跑（形态同 0020）：Supabase 控制台 SQL Editor 或 CI 迁移流程执行。
--             幂等：add column if not exists / create index if not exists，可安全重跑（对齐 0018/0019/0020）。
--             RLS 不动：本表 0012 起即 service_role-only（启用 RLS 且不建 select/update 策略 = 默认拒绝），
--                       新增列不改变该访问模型，无需新策略。写入唯一入口仍是 api-logger（service_role 绕 RLS）。
-- Created   : 2026-07-18
-- -----------------------------------------------------------------------------

-- 三列均可空：老行没有归属信息（补字段前写入的行）保持 null；匿名/无语料的调用天然为 null。
-- user_id / corpus_id 不建外键（不随 auth.users / corpus 删除级联）——账号删除时走 account/delete 的
-- 「匿名化」而非硬删（费用日志是聚合成本、去标识化即可，不让离职用户成本从总额蒸发），故意不设 cascade。
alter table public.api_usage_logs add column if not exists user_id       uuid;
alter table public.api_usage_logs add column if not exists corpus_id     uuid;
alter table public.api_usage_logs add column if not exists is_anonymous  boolean;

-- 按用户/语料归因聚合的检索索引（成本按用户 Top-N、按语料回溯用）。
create index if not exists api_usage_logs_user_idx   on public.api_usage_logs (user_id)   where user_id   is not null;
create index if not exists api_usage_logs_corpus_idx on public.api_usage_logs (corpus_id) where corpus_id is not null;
