-- -----------------------------------------------------------------------------
-- Migration : 0049_corpus_question_analyses
-- Desc      : 个性化分析（题目 + 语料）缓存表 —— 让复练秒开。
--
--   动机：/api/analysis 带 storyId 时走【个性化分析】路径，prompt 会把用户语料正文
--         （corpus.cleaned_text）拼进「用户的真实故事」喂给 AI，因语料而异、跨用户不可共享，
--         故不能进题目级共享表 question_analyses。本表按 (corpus_id, question_id) 缓存这份
--         个性化分析：同一用户对同一(题,语料)复练时直接读档、不再实时调 AI，复练秒开、省 AI 费。
--
--   失效【三重】：命中要求 键(corpus_id,question_id) 命中 且 season 一致 且 content_hash 一致。
--     - season：对齐 0027 换题季 + 0032/0019 快照失效范式。换题季题面原地更新（questions 行
--       id 不变、season 变）后旧分析过季 → season 不一致则重算。
--     - content_hash：生成所依【语料正文 cleaned_text】的哈希。用户「返回整理」改故事时，corpus 无
--       updated_at 触发器、patch 也不带该字段，无法靠时间戳判失效；改用内容哈希——正文改了→哈希变
--       →命中失败→重算，保证复练读到的分析始终对应当前语料正文。这是本表正确性的核心。
--
--   隐私（随语料删除）：corpus_id 外键 on delete cascade —— 删语料时，其派生的个性化分析同步删除，
--     不留孤儿隐私衍生物。个性化分析是【用户私有语料的衍生物】，与 question_analyses（题目级公开
--     参考数据）性质相反。
--
--   ── RLS：启用 + 【故意不建任何策略】（照抄 0018_flow_events / 0046_review_events）──
--     启用 RLS 后无策略即默认拒绝：客户端持 anon key 直连一律读不到也写不进。读写【唯一】走服务端
--     service_role（绕 RLS）。此处【绝不能】照 0032 question_analyses 建 anon 公开读策略——那张表
--     存的是全站共享的题目级分析，公开读无碍；本表存的是【某用户私有语料的个性化分析】，一旦公开读
--     即等于把一个用户的隐私衍生物泄漏给所有人（含匿名）。此处【无策略】是刻意的隐私红线、非遗漏，
--     后人切勿误以为漏建策略而补上。
--
--   幂等：create table if not exists，可安全重跑。
--   索引：主键 (corpus_id, question_id) 已覆盖唯一的查询形态（按语料+题命中），无需额外索引。
-- Created   : 2026-08-01
-- -----------------------------------------------------------------------------

create table if not exists public.corpus_question_analyses (
  corpus_id    uuid not null references public.corpus(id) on delete cascade,
  question_id  uuid not null,
  season       text not null,                              -- 生成所依题面季度（'YYYY-MM'，对齐 0027）
  content_hash text not null,                              -- 生成所依语料正文(cleaned_text)的哈希；命中要求一致（正文改了→哈希变→失效重算）
  analysis     jsonb not null,                             -- 整份个性化分析
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (corpus_id, question_id)
);

-- ── RLS：启用 + 故意不建任何策略（默认拒绝，仅 service_role 读写）。理由见文件头【隐私红线】。──
alter table public.corpus_question_analyses enable row level security;
