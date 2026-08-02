-- -----------------------------------------------------------------------------
-- Migration : 0054_revoke_anon_server_only_rpcs
-- Desc      : 深度防御 —— 把 7 个【只由 service_role 调用】的 RPC 从 public/anon/authenticated 收权。
--
--   起因：0052 收口了 8 个 security definer 的经营指标 RPC 之后，安全审计指出还有一批 RPC
--   同样对 anon 开放。实测（2026-08-02）确认它们【全部被 RLS 挡住】、不构成漏洞
--   （`prosecdef = false`，以调用者身份执行，RLS 生效），故本迁移不是补洞，是最小权限收口。
--
--   ⚠️【真正的价值：给将来的误改上保险】
--   这批函数今天安全，只因为它们碰巧是 invoker 而非 definer。哪天有人为了「绕开 RLS 方便点」
--   把 bump_daily_usage 改成 security definer，那一刻「任何人 POST 一下就能刷爆任意用户当天额度」
--   立即成立 —— 而改的人多半不会想到还要顺手 revoke（0043-0048 那批就是这么漏的）。
--   先把执行权收掉，将来即使有人改成 definer，anon 也调不进来。
--
--   收权名单（全部经 grep 核实：调用点一律走 getSupabaseServer() = service_role，无任何客户端调用）：
--     bump_daily_usage            src/lib/db/corpus-server.ts
--     bump_anon_restructure       src/lib/db/corpus-server.ts
--     claim_anki_generation_jobs  src/app/api/anki/generate/drain/route.ts
--     enqueue_anki_generation     src/lib/anki/enqueue.ts
--     swap_anki_corpus            src/lib/db/anki-cards-server.ts
--     unbind_anki_corpus          src/lib/db/anki-cards-server.ts
--     get_anki_cards              src/lib/anki/list.ts
--
--   ⚠️【刻意不动这三个】它们由【客户端】直接调用（走 getSupabase()，非 server 客户端），
--   收掉 authenticated 会当场打断功能：
--     get_dimension_scores()      src/lib/db/dimension-scores.ts
--     get_dimension_progress()    src/lib/db/dimension-scores.ts
--     get_practice_streak(uuid)   src/lib/db/practice-sessions.ts
--   它们同样是 invoker + RLS 生效，现状安全。若日后要收 anon（未登录角色），须先确认
--   Supabase 匿名登录用户的 JWT role 是 authenticated 而非 anon，否则会打断匿名用户的正常使用。
--   本迁移不赌这个判断，一律不动。
--
--   幂等：revoke 对已无权限者不报错，可安全重跑。
--   ⚠️ 用 npm run db:push 应用。db-push 已按文件包 BEGIN/COMMIT，本文件不自带 begin/commit。
-- Created   : 2026-08-03
-- -----------------------------------------------------------------------------

revoke execute on function public.bump_daily_usage(uuid, text)                  from public, anon, authenticated;
revoke execute on function public.bump_anon_restructure(uuid)                   from public, anon, authenticated;
revoke execute on function public.claim_anki_generation_jobs(integer)           from public, anon, authenticated;
revoke execute on function public.enqueue_anki_generation(uuid, uuid, uuid)     from public, anon, authenticated;
revoke execute on function public.swap_anki_corpus(uuid, uuid, uuid)            from public, anon, authenticated;
revoke execute on function public.unbind_anki_corpus(uuid, uuid)                from public, anon, authenticated;
revoke execute on function public.get_anki_cards(uuid, text, smallint, text)    from public, anon, authenticated;

-- 显式确认 service_role 仍可执行（revoke 不触及它；此处为幂等与防呆，重复 grant 无副作用）
grant execute on function public.bump_daily_usage(uuid, text)                   to service_role;
grant execute on function public.bump_anon_restructure(uuid)                    to service_role;
grant execute on function public.claim_anki_generation_jobs(integer)            to service_role;
grant execute on function public.enqueue_anki_generation(uuid, uuid, uuid)      to service_role;
grant execute on function public.swap_anki_corpus(uuid, uuid, uuid)             to service_role;
grant execute on function public.unbind_anki_corpus(uuid, uuid)                 to service_role;
grant execute on function public.get_anki_cards(uuid, text, smallint, text)     to service_role;

-- ── 守卫：收权后 service_role 必须仍能执行，anon 必须已不能 ──────────────────────
-- 【为什么用 has_function_privilege 而不是直接调函数】SQL Editor 以 postgres 超级用户身份执行、
-- 绕过一切 ACL，直接调必然成功、证明不了 service_role 的权限。同 0052 的守卫思路。
-- 这批函数的失败形态同样是【静默】的：额度计数 / Anki 队列写入失败都在 catch 里，
-- 用户侧只会表现为「偶尔没扣次数」或「卡片没生成」，不会报错，所以宁可在这里炸掉整个事务。
do $$
declare
  sig text;
  sigs text[] := array[
    'public.bump_daily_usage(uuid, text)',              'public.bump_anon_restructure(uuid)',
    'public.claim_anki_generation_jobs(integer)',       'public.enqueue_anki_generation(uuid, uuid, uuid)',
    'public.swap_anki_corpus(uuid, uuid, uuid)',        'public.unbind_anki_corpus(uuid, uuid)',
    'public.get_anki_cards(uuid, text, smallint, text)'
  ];
begin
  foreach sig in array sigs loop
    if not has_function_privilege('service_role', sig, 'execute') then
      raise exception '守卫失败：service_role 失去了 % 的执行权，整份迁移已回滚。额度计数/Anki 队列会静默失效，不要放行。', sig;
    end if;
    if has_function_privilege('anon', sig, 'execute') then
      raise exception '守卫失败：anon 仍能执行 %，收权没生效，整份迁移已回滚。', sig;
    end if;
  end loop;
  raise notice '✅ 守卫通过：7 个服务端专用 RPC 已对 public/anon/authenticated 收权，service_role 不受影响。';
end $$;
