-- -----------------------------------------------------------------------------
-- Migration : 0055_feedback_handled
-- Desc      : feedback 表加 handled_at（管理员「已处理」标记）+ 未处理查询部分索引
-- Created   : 2026-08-03
-- -----------------------------------------------------------------------------
-- ⚠️ 本文件刻意不带 begin/commit：db:push 会自动把整份迁移包进事务，自带事务会嵌套出错。

alter table public.feedback add column if not exists handled_at timestamptz;

-- 看板每次拉「handled_at is null 全量」：未处理集合恒小，部分索引最省（已处理行不进索引）。
create index if not exists feedback_unhandled_created_idx
  on public.feedback (created_at desc)
  where handled_at is null;

-- 【为什么这份迁移不建任何 policy / 函数 / 视图】本项目实测教训（2026-08-03 安全 hotfix 0052 / 0054）：
-- Postgres 对新建函数默认 GRANT EXECUTE TO PUBLIC，Supabase 的 default privileges 又会让新函数 / 视图
-- 自动对 anon 开放，且视图本身无 RLS、还能绕过底表策略——新对象一律「默认裸奔、必须自带 revoke」。
-- handled_at 的读写全部走服务端 service_role（/api/dashboard 读、/api/feedback-handled 写，均 requireAdmin
-- 鉴权），客户端角色不需要、也绝不该拿到任何新入口。只加列不改变 feedback 既有 RLS（仅本人 insert/select，
-- 见 0005_feedback.sql），anon / authenticated 依旧读不到别人的 handled_at。
