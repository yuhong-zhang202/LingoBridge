-- -----------------------------------------------------------------------------
-- Migration : 0056_feedback_reply
-- Desc      : feedback 表加 reply（管理员回复正文）+ notified_at（已告知用户的时间）
--             用于「反馈闭环通知」：修好之后弹窗告诉提反馈的那个人，弹窗内带上他自己的原话。
-- Created   : 2026-08-04
-- -----------------------------------------------------------------------------
-- ⚠️ 本文件刻意不带 begin/commit：db:push 会自动把整份迁移包进事务，自带事务会嵌套出错。

alter table public.feedback add column if not exists reply text;
alter table public.feedback add column if not exists notified_at timestamptz;

-- 客户端每次进首页要查「我有没有已回复但还没告诉过我的反馈」，命中集恒小（一人至多几条），
-- 用部分索引覆盖该查询：已处理 + 有回复 + 未通知。
create index if not exists feedback_pending_notify_idx
  on public.feedback (user_id, handled_at desc)
  where handled_at is not null and reply is not null and notified_at is null;

-- 【为什么这份迁移同样不建任何 policy / 函数 / 视图】延续 0055 的判断（教训见 0052 / 0054）：
-- Postgres 对新建函数默认 GRANT EXECUTE TO PUBLIC，Supabase 的 default privileges 又让新函数 / 视图
-- 自动对 anon 开放，且视图无 RLS 还能绕过底表策略 —— 新对象一律「默认裸奔、必须自带 revoke」。
--
-- 这两列的读写路径：
--   · reply       只由管理员在 /api/feedback-handled 写（requireAdmin + service_role）；
--   · notified_at 只由 /api/feedback-notified 写（登录用户，但服务端按 JWT 的 user_id 过滤、
--                 只允许把自己的行从 null 置成 now()，不接受客户端传任何时间值）。
-- feedback 既有 RLS（仅本人 insert / 本人 select，见 0005）不变：用户能读到自己那行的 reply
-- 是本来就该的（弹窗要显示它），而 anon 与其他登录用户读不到别人的行。**刻意不加 update policy**：
-- 加了就等于给客户端开了改 message / 伪造 handled_at 的口子，标记已通知走服务端就够了。
