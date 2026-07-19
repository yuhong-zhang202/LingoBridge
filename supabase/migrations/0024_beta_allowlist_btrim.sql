-- -----------------------------------------------------------------------------
-- Migration : 0024_beta_allowlist_btrim
-- Desc      : 【内测临时措施·随 0023 一起拆除】白名单比对两侧 btrim 根治「邮箱带空格被永久锁死」。
--             故障复盘（2026-07-19 生产实测）：beta_allowlist 有一行 email 带前导空格，
--             该内测者注册被永久拒绝。根因在 0023 的 enforce_beta_allowlist()：
--               where lower(email) = lower(target_email)
--             只对【传入值】做了 btrim（第 2 步的空值判断里），对【存储值】一次都没 btrim。
--             产品方已跑 `update public.beta_allowlist set email = btrim(email)` 止血，本迁移根治。
--             （注：src/lib/api-auth.ts 的兜底闸在 JS 侧已 .trim()，故未受影响，仅 SQL 主闸有此洞。）
--
--             本文件含两部分：
--               1. create or replace enforce_beta_allowlist()——比对两侧 btrim（其余逻辑一字未改）；
--                  外加 beta_allowlist 插入/更新时自动 btrim 的规范化触发器。
--               2. get_practice_streak 反向漂移的【待办记录】（仅注释，不执行，理由见文末）。
--
--             ⚠️ 数据库改动，需部署方手动跑（形态同 0020–0023）：Supabase 控制台 SQL Editor 执行。
--             幂等：or replace function / drop+create trigger / update 本身收敛，可安全重跑。
--             ⚠️ 本文件【不含任何真实邮箱】（敏感数据不进 git）。
-- Created   : 2026-07-19
-- -----------------------------------------------------------------------------

-- ── 1a. 存量数据收口（幂等：重跑是空操作）───────────────────────────
-- 产品方已手工跑过一次，此处再跑一遍以保证「重建环境 / 未来误插」时状态一致。
update public.beta_allowlist
   set email = btrim(email)
 where email <> btrim(email);

-- ── 1b. 入口规范化：插入/更新时自动 btrim ───────────────────────────
-- 为什么值得加（判断依据）：
--   ① 0023 的【拆除开关】是 `where email = '*'` 精确等值比对，若哨兵行被误存成 ' * '，
--      紧急全放行开关会静默失效——这是比原故障更危险的场景，而它无法靠「比对两侧 btrim」修，
--      因为哨兵那条判断按要求一字未改。入口规范化能同时兜住它。
--   ② 名单是产品方在 Table Editor 手工粘贴维护的，粘贴带空格是必然会再犯的操作，
--      靠约定不靠机制守不住。
--   ③ 选 trigger 静默规范化而非 check 约束：约束会让「加内测者」这个高频操作直接报错中断，
--      规范化则悄悄修好，对手工运维更友好。
-- 拆除成本：+1 行 drop function（触发器本身随 drop table 自动消失），已写进文末拆除 SQL。
create or replace function public.beta_allowlist_normalize_email()
returns trigger
language plpgsql
as $$
begin
  new.email := btrim(new.email);
  return new;
end;
$$;

drop trigger if exists beta_allowlist_normalize_trg on public.beta_allowlist;
create trigger beta_allowlist_normalize_trg
  before insert or update of email on public.beta_allowlist
  for each row execute function public.beta_allowlist_normalize_email();

-- ── 1c. 准入触发器函数：比对两侧 btrim ──────────────────────────────
-- ⚠️ 与 0023 的差异【仅第 5 步的 where 子句】：
--       0023: where lower(email)        = lower(target_email)
--       0024: where lower(btrim(email)) = lower(btrim(target_email))
--    匿名放行、表空防呆放行、'*' 哨兵放行、raise exception 的消息格式，
--    全部一字未改（均为台账 113 记录在案的既定行为，勿动）。
-- security definer + set search_path 同 0023，是提权防护，不可省。
create or replace function public.enforce_beta_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_email text;
begin
  -- 1) 本次要校验的邮箱：email 与 email_change 两个字段都查。
  --    ⚠️ Secure email change 开关状态不确定：开启时新邮箱先落 email_change、确认后才进 email；
  --    两字段都查可无视该开关差异。
  target_email := coalesce(new.email, new.email_change);

  -- 2) 匿名账号（无邮箱）→ 放行，不影响未注册试用。
  if target_email is null or btrim(target_email) = '' then
    return new;
  end if;

  -- 3) 防呆兜底：表为空视为「白名单未启用」，避免误删全部行把产品方自己也锁死。
  if not exists (select 1 from public.beta_allowlist) then
    return new;
  end if;

  -- 4) 拆除开关：存在哨兵行 '*' → 白名单停用，全部放行。
  if exists (select 1 from public.beta_allowlist where email = '*') then
    return new;
  end if;

  -- 5) 不在名单内 → 拒绝。【本迁移的核心改动：比对两侧都 btrim】
  --    ⚠️ 消息里的关键词 BETA_ALLOWLIST_DENIED 对前端【无用】——已实测证伪：
  --    GoTrue 把 DB 异常原文整个吞掉，前端只拿得到
  --      { message:'Database error saving new user', status:500, code:'unexpected_failure' }。
  --    前端改用 status+code 映射（见 src/lib/auth.ts 的 isAllowlistDenied）。
  --    此消息保留仅供【服务端日志排查】用，勿再假设前端能读到它。
  if not exists (
    select 1 from public.beta_allowlist
     where lower(btrim(email)) = lower(btrim(target_email))
  ) then
    raise exception 'BETA_ALLOWLIST_DENIED: email not in beta allowlist';
  end if;

  -- 6) 在名单内 → 放行。
  return new;
end;
$$;

-- 触发器绑定与 0023 完全一致；重建一次以保证「先跑 0024、0023 从未跑过」的环境也自洽。
-- ⚠️ of email, email_change 限定列：仅当这两列被写入时才触发。
-- 否则会误伤改昵称/头像/备考目标/改密码等其它 updateUser 调用。
drop trigger if exists enforce_beta_allowlist_trg on auth.users;
create trigger enforce_beta_allowlist_trg
  before insert or update of email, email_change on auth.users
  for each row execute function public.enforce_beta_allowlist();

-- ═════════════════════════════════════════════════════════════════════
-- 2. 【待办·本迁移刻意不执行】get_practice_streak 反向漂移
-- ═════════════════════════════════════════════════════════════════════
-- 现象：生产库存在函数 public.get_practice_streak(p_user_id uuid)，
--       src/lib/db/practice-sessions.ts:66 经 rpc('get_practice_streak') 在用，
--       但 0001–0023 全部迁移文件中【没有任何一处定义它】——属反向漂移：
--       生产有、仓库无，照仓库重建环境会缺这个函数，打卡天数会静默回 0
--       （getStreak 里 `if (error) return 0`，出错不报错，排查会很痛）。
--
-- 为什么本文件不写定义（明确取舍）：
--   本次实施方【没有】该函数在生产的真实定义，也没有可取到它的通道——
--   仓库只配了 PostgREST（NEXT_PUBLIC_SUPABASE_URL + service_role key），
--   无 DATABASE_URL / 无 psql 直连，读不到 pg_catalog，拿不到 pg_get_functiondef 输出。
--   而 `create or replace function` 会【真的覆盖】生产上那一份。
--   凭猜写一版语义可能不同的实现去覆盖线上正在服务的函数，风险远大于「暂时缺一条定义」：
--   猜错了是静默算错打卡天数，且覆盖后原定义再也拿不回来。故选择不做。
--
-- 下一步（交产品方，一次性操作）：
--   在 Supabase 控制台 SQL Editor 执行下面这句，把输出原样贴回，
--   由后续迁移（0025）原文收编：
--     select pg_get_functiondef(p.oid)
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'get_practice_streak';
--   （此为只读查询，不改任何东西。）

-- ── 内测结束拆除（届时单独执行，不在本文件自动跑）────────────────────
-- ⚠️ 本清单是 0023 拆除清单的【超集】，直接用本清单即可（多了最后一行规范化函数）。
--   drop trigger if exists enforce_beta_allowlist_trg on auth.users;
--   drop function if exists public.enforce_beta_allowlist();
--   drop table if exists public.beta_allowlist;             -- 其上的规范化触发器随表自动消失
--   drop function if exists public.beta_allowlist_normalize_email();
-- 代码侧同步删除三处带【临时措施】标记的段落（含 src/lib/auth.ts 的 status/code 文案映射），
-- 详见 docs/内测邮箱白名单-启用与拆除.md。
