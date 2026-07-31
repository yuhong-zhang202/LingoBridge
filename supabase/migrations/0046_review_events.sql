-- -----------------------------------------------------------------------------
-- Migration : 0046_review_events
-- Desc      : 闪卡复习流水表 review_events —— 按「次」追加、只往前记不回补。
--             动机：现有 phrase_cards.last_reviewed_at 和 anki_cards.last_reviewed_at 都只保存
--             【最后一次】复习时间、会被下一次复习覆盖，无法还原「某人过去某一天是否复习过」，
--             导致经营看板的留存与每日活跃趋势算不准（历史被抹平）。本表每复习一次追加一行、
--             不覆盖不回补，为核心活跃/留存提供权威的逐次复习信号。
--             隐私：本表【不存任何内容字段】——不存卡面、不存题目 id、不存词组文本，
--             只记「谁(user_id) 在什么时候(created_at) 复习了哪类卡(kind)」，最小化留痕。
--             幂等：create table / index 均 if not exists，可安全重跑。
--             ⚠️ 数据库改动，需部署方在 Supabase 控制台 SQL Editor 手动跑（形态同 0018-0023、0043-0045）：
--                本文件【不要】尝试自动跑。跑之前核心活跃/留存靠 last_reviewed_at 历史近似兜底（见 0047），
--                跑之后逐次复习信号自动成为权威源。
-- Created   : 2026-07-31
-- -----------------------------------------------------------------------------

-- kind：'anki' = 题库速览整题卡（anki_cards）；'phrase' = 词组闪卡（phrase_cards）。
-- id / created_at 为 DB 生成（服务端 insert 不带 id）；created_at 是离线/看板统计时间过滤的唯一依据。
create table if not exists public.review_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  kind       text not null check (kind in ('anki', 'phrase')),
  created_at timestamptz not null default now()
);

-- 看板按时间范围/倒序聚合查（趋势图）、按人+时间查（首活日/留存）。
create index if not exists review_events_created_idx      on public.review_events (created_at desc);
create index if not exists review_events_user_created_idx on public.review_events (user_id, created_at desc);

-- 启用 RLS（启用本身幂等）
alter table public.review_events enable row level security;

-- RLS 处理【完全照抄 0018_flow_events】：启用 RLS 且【故意不建任何 insert/select 策略】。
-- 启用 RLS 后无策略即默认拒绝——客户端持 anon key 直连一律【写不进也读不到】，
-- 杜绝客户端灌水污染复习统计。写入唯一走服务端 service_role（service_role 绕过 RLS）；
-- 读取只由离线/看板的 service_role 进行。
-- ⚠️ 此处【无策略】是刻意设计、非遗漏——后人切勿误以为漏建策略而补上，补了反而开了灌水口子。
