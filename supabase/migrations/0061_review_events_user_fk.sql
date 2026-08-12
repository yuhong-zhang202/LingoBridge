-- -----------------------------------------------------------------------------
-- Migration : 0061_review_events_user_fk
-- Desc      : 给 review_events.user_id 补 auth.users 外键（on delete cascade），
--             堵住「注销用户的 uuid 永久留库」这个被遗忘权缺口（审计 2026-08-06 P1-5）。
--
--   ── 这张表当初为什么没有外键 ────────────────────────────────────────────
--   不是随手漏的，是本项目一条成文纪律的产物。0022_consent_records 把它写在了注释里：
--     「user_id 不建外键（不随 auth.users 删除级联）—— 删号时走 account/delete 的显式硬删
--       （决策4），与 0020/0021 同款『不信 FK cascade』纪律。」
--   即：这批带 user_id 的业务表【故意】不挂外键，删号的正确性由 api/account/delete 的显式删除
--   清单来保证（那份清单也确实逐张枚举了 corpus / flow_events / consent_records / anki_* 等）。
--   0046 建 review_events 时照搬了这条纪律的前半截（裸 user_id 列、无外键），
--   【却没做后半截 —— 没有把这张表加进删号清单】。于是它成了纪律里唯一一张两头落空的表：
--   既没有 FK cascade 兜底，也不在显式删除清单里。
--
--   ── 后果（未修复时的真实状态）──────────────────────────────────────────
--   用户注销后：profiles / corpus / flow_events / consent_records 等全被删干净，
--   auth.users 行也没了，唯独 review_events 里那些 (user_id, kind, created_at) 原样留着。
--   admin.deleteUser 的级联也够不到它（没有外键，级联无从谈起）。
--   结果是一个【指向已注销自然人的 uuid】永久留在库里，再无任何机制会清它 ——
--   这正是删号路由自己在 api_usage_logs 那段注释里判定为「不可接受」的同款残留。
--   审计当日快照 93 行；本次修复前实测 142 行 / 11 个用户。
--
--   ── 本次为什么补 FK，而不是只改代码 ────────────────────────────────────
--   代码侧已同批修好：删号路由的显式删除清单里加了 review_events（第一道闸，与纪律一致）。
--   FK 是【第二道闸】，兜的是「路由压根没跑到」的那些路径：
--     · 运维在 Supabase 控制台 Auth 页手删用户（不经过我们的路由）；
--     · 将来有人写了新的删号/清理入口，忘了同步那份清单（本次事故的同款形态，它已经发生过一次）；
--     · admin.deleteUser 被别的服务端代码直接调用。
--   所以本次【不是推翻】0022 的「不信 FK cascade」纪律 —— 显式删仍是主路径、仍排在前面；
--   只是承认「全靠人记得往清单里加一行」这道软防线已被证伪一次，得有个不依赖记忆的硬兜底。
--
--   ── 级联行为为什么选 on delete cascade ─────────────────────────────────
--   · 不能选默认的 no action / restrict：那样一旦有残留行，admin.deleteUser 会因外键冲突直接失败，
--     整个删号 500 —— 把「清理不干净」升级成「用户根本删不掉号」，方向反了。
--     兜底闸的失败方向必须是「帮忙删干净」，不是「把被遗忘权卡死」。
--   · 不能选 set null：user_id 是 not null（改成可空才谈得上），且更根本的是没意义 ——
--     本表只有 (user_id, kind, created_at) 三个有效字段，抹掉 user_id 后剩下的行对留存/活跃
--     计算毫无价值（留存是按人算的、首活日也按人算），只剩一个无主计数还会污染分母。
--   · 这与 api_usage_logs 走「去标识化保留」的口径不同是有意的：那张表记的是钱（硬删会让注销用户
--     的成本从总额蒸发、账目失真），本表记的是行为埋点、无账目意义，故与同类的 flow_events 同口径：
--     用户注销即随之清除。
--
--   ── 未跑本迁移前会怎样 ──────────────────────────────────────────────────
--   不会报错、不会崩 —— 代码侧那一行显式删是自洽的，走 /api/account/delete 注销的用户，
--   其 review_events 会被删干净。差别只在于【只剩一道闸】：任何绕过该路由的删号路径
--   （控制台手删用户、admin API 直调、将来新写的清理入口）仍会留下孤儿 uuid，且没有任何
--   机制会发现或清理它。故本迁移与代码同批上线（推 main 时 db-push.yml 自动应用）。
--   反过来，只跑迁移不发代码也是安全的：FK cascade 会替路由把该删的删掉。两者互不依赖。
--
--   ── 孤儿行 ────────────────────────────────────────────────────────────
--   2026-08-07 只读核实：孤儿行 0 条，加约束不会因脏数据失败。但本文件仍在加约束前先清一遍 ——
--   核实时点与真正执行时点之间存在窗口（这期间若有人走控制台手删了用户，就会新产生孤儿），
--   而 add constraint 是会全表校验的，撞上一条就整份迁移回滚。清理口径与上面的级联选择一致：
--   指向已不存在用户的埋点行，本来就是这次要消灭的残留。
--
--   ── 锁 ────────────────────────────────────────────────────────────────
--   add constraint 会对 review_events 与 auth.users 各取一个 ShareRowExclusive 锁并全表校验。
--   当前 142 行 / 百余用户，瞬时完成，对登录无感。若将来本表涨到十万行级，应改成
--   `add constraint ... not valid` + 单独 `validate constraint` 两步，避免长时间持锁 auth.users。
--
--   幂等：孤儿清理是 delete ... where not exists（重跑命中 0 行）；加约束前查 pg_constraint，
--         已存在即跳过。可安全重跑。
--   ⚠️ 本文件刻意不带 begin/commit：db:push 会自动把整份迁移包进事务，自带会嵌套出错（同 0052/0054/0057/0060）。
-- Created   : 2026-08-07
-- -----------------------------------------------------------------------------

-- ① 先清孤儿行（指向已不存在的 auth.users）。0 条时静默通过；有则报数，便于事后对账。
do $$
declare
  v_orphans bigint;
begin
  delete from public.review_events e
   where not exists (select 1 from auth.users u where u.id = e.user_id);
  get diagnostics v_orphans = row_count;
  if v_orphans > 0 then
    raise notice '⚠️ 清理 review_events 孤儿行 % 条（指向已注销用户，正是本迁移要消灭的残留）。', v_orphans;
  else
    raise notice '✅ review_events 无孤儿行，直接加约束。';
  end if;
end $$;

-- ② 补外键。约束名沿用 PG 默认命名习惯 {表}_{列}_fkey，便于日后按名检索/排障。
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.review_events'::regclass
       and conname  = 'review_events_user_id_fkey'
  ) then
    alter table public.review_events
      add constraint review_events_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
    raise notice '✅ 已加外键 review_events_user_id_fkey → auth.users(id) on delete cascade。';
  else
    raise notice 'ℹ️ 外键 review_events_user_id_fkey 已存在，跳过（幂等重跑）。';
  end if;
end $$;

-- ③ 守卫：外键必须存在【且级联行为必须是 cascade】。
-- 【为什么要单独验 confdeltype】只验「约束存在」是不够的：若有人日后把它改成 no action / restrict，
-- 表面上「外键还在」，实际效果却从「兜底删干净」翻转成「有残留行就把删号整个卡死」——
-- 是本迁移最不该发生的反向失败，而且不看 confdeltype 根本看不出来。
-- confdeltype: 'c'=cascade / 'a'=no action / 'r'=restrict / 'n'=set null / 'd'=set default。
do $$
declare
  v_deltype "char";
begin
  select confdeltype into v_deltype
    from pg_constraint
   where conrelid = 'public.review_events'::regclass
     and conname  = 'review_events_user_id_fkey';

  if v_deltype is null then
    raise exception '守卫失败：review_events_user_id_fkey 不存在，外键没建上，整份迁移已回滚。';
  end if;
  if v_deltype <> 'c' then
    raise exception '守卫失败：review_events_user_id_fkey 的删除级联是 %，不是 cascade。整份迁移已回滚 —— 非 cascade 会让残留行把删号卡死（详见顶注）。', v_deltype;
  end if;
  raise notice '✅ 守卫通过：review_events.user_id → auth.users(id) on delete cascade 已生效。';
end $$;
