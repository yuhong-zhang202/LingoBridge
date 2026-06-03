-- -----------------------------------------------------------------------------
-- Migration : 0001_init_schema
-- Desc      : 初始化核心表结构、索引、RLS 策略及新用户触发器
-- Created   : 2026-06-02
-- -----------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 维度（参考/种子数据，6 行）
-- ---------------------------------------------------------------------------
create table dimensions (
  id          text primary key,   -- emotion / relationship / space / spirit / growth / value
  name        text not null,
  sort_order  int  not null
);

-- ---------------------------------------------------------------------------
-- 观察点（参考/种子数据，43 行）
-- ---------------------------------------------------------------------------
create table observation_points (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique not null,
  dimension_id          text not null references dimensions(id),
  name                  text not null,
  layer                 text not null check (layer in ('state','rhythm','fluctuation','mixed','non_event')),
  mapped_question_count int  not null default 0,
  rich_threshold        int  not null,
  sort_order            int  not null
);

-- ---------------------------------------------------------------------------
-- 用户 Profile（挂在 Supabase auth.users 上）
-- ---------------------------------------------------------------------------
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  plan         text not null default 'free' check (plan in ('free','pro')),
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 语料（用户每一段输入）
-- ---------------------------------------------------------------------------
create table corpus (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  source       text not null check (source in ('voice','text')),
  raw_text     text not null,
  cleaned_text text,
  audio_url    text,
  status       text not null default 'draft'
               check (status in ('draft','restructured','extracted')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index corpus_user_created_idx on corpus (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 萃取结果：语料 ↔ 观察点关联
-- ---------------------------------------------------------------------------
create table corpus_point_links (
  id         uuid primary key default gen_random_uuid(),
  corpus_id  uuid not null references corpus(id) on delete cascade,
  point_id   uuid not null references observation_points(id),
  role       text not null check (role in ('primary','secondary')),
  created_at timestamptz not null default now(),
  unique (corpus_id, role)   -- 每段语料最多 1 主 + 1 副
);
create index corpus_point_links_point_idx on corpus_point_links (point_id, role);

-- ---------------------------------------------------------------------------
-- RLS：参考数据只读
-- ---------------------------------------------------------------------------
alter table dimensions          enable row level security;
alter table observation_points  enable row level security;
create policy "ref_read_dimensions" on dimensions          for select to authenticated using (true);
create policy "ref_read_points"     on observation_points  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- RLS：profiles 只能读写自己
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
create policy "own_profile_select" on profiles for select to authenticated using (auth.uid() = id);
create policy "own_profile_update" on profiles for update to authenticated using (auth.uid() = id);
create policy "own_profile_insert" on profiles for insert to authenticated with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- RLS：corpus 只能读写自己的语料
-- ---------------------------------------------------------------------------
alter table corpus enable row level security;
create policy "own_corpus_all" on corpus for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RLS：corpus_point_links 通过所属 corpus 判定归属
-- ---------------------------------------------------------------------------
alter table corpus_point_links enable row level security;
create policy "own_links_all" on corpus_point_links for all to authenticated
  using      (exists (select 1 from corpus c where c.id = corpus_id and c.user_id = auth.uid()))
  with check (exists (select 1 from corpus c where c.id = corpus_id and c.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 触发器：新用户注册时自动创建 profile
-- ---------------------------------------------------------------------------
create function handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();
