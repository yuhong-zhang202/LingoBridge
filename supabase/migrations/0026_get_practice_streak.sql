-- -----------------------------------------------------------------------------
-- Migration : 0026_get_practice_streak
-- Desc      : 收编 get_practice_streak —— 修正「生产有、仓库无」的反向漂移。
--             该函数在生产库一直存在且被 src/lib/db/practice-sessions.ts:66 使用
--             （「我的」页连续打卡天数），但 0001–0025 任何迁移文件里都没有它的
--             定义。后果：重建环境 / 换 Supabase 项目时该函数会缺失，而 getStreak
--             出错时 `if (error) return 0`——打卡天数会静默变成 0、不报错、无人知晓。
--
--             本文件是 2026-07-20 从生产库 `pg_get_functiondef()` 导出的**原样收编**，
--             逻辑一字未改，仅补上头部注释。执行本迁移不会改变生产的任何行为
--             （create or replace 覆盖成完全相同的定义）。
--
-- 背景      : 由 2026-07-19 夜的生产迁移对账发现（台账 115）。0024 的注释曾写
--             「由后续迁移 0025 收编」，但 0025 被 consent_audit 占用，故改用 0026。
--
-- 幂等      : create or replace，可安全重跑。
-- Created   : 2026-07-20
-- -----------------------------------------------------------------------------

-- 连续打卡天数：从今天（或昨天，容忍今天还没练）起向前逐日回溯 practice_sessions，
-- 断一天即止。日界按 Asia/Shanghai 计算——用户的「今天」是北京时间的今天，
-- 不是 UTC 的今天（否则国内用户在 08:00 前练习会被算进前一天）。
create or replace function public.get_practice_streak(p_user_id uuid)
returns integer
language plpgsql
as $function$
declare
  today date := (now() at time zone 'Asia/Shanghai')::date;
  streak int := 0;
  cursor_day date;
  has_today boolean;
begin
  if p_user_id is null then
    return 0;
  end if;

  select exists(
    select 1 from practice_sessions
    where user_id = p_user_id
      and (created_at at time zone 'Asia/Shanghai')::date = today
  ) into has_today;

  -- 今天练过 → 从今天起算；今天没练但昨天练过 → 从昨天起算（当天尚未练习不算断签）；
  -- 两天都没有 → 连续中断，直接归零。
  if has_today then
    cursor_day := today;
  elsif exists(
    select 1 from practice_sessions
    where user_id = p_user_id
      and (created_at at time zone 'Asia/Shanghai')::date = today - 1
  ) then
    cursor_day := today - 1;
  else
    return 0;
  end if;

  loop
    if exists(
      select 1 from practice_sessions
      where user_id = p_user_id
        and (created_at at time zone 'Asia/Shanghai')::date = cursor_day
    ) then
      streak := streak + 1;
      cursor_day := cursor_day - 1;
    else
      exit;
    end if;
  end loop;

  return streak;
end;
$function$;
