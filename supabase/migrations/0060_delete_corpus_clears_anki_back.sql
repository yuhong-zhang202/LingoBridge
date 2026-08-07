-- -----------------------------------------------------------------------------
-- Migration : 0060_delete_corpus_clears_anki_back
-- Desc      : 删语料时【真的清空绑定题卡的卡背】，收敛成单事务 RPC —— 补上「界面承诺了、系统没做」的缺口。
--
--   ── 问题（2026-08-07 确证）──────────────────────────────────────────────
--   素材库删语料时 UI 对用户的承诺是「删除后，绑定的题卡会退回题目分析（卡背清空）」
--   （src/app/library/CorpusMatchesTab.tsx 确认框 / 成功 Toast / 桌面批量撤销 Toast 三处）。
--   而 src/lib/db/corpus.ts 的 deleteCorpus 实际只做两件事：删 corpus_point_links、删 corpus 行。
--   0030 的外键 `anki_cards.corpus_id references corpus(id) on delete set null` 只把 corpus_id 置空，
--   【generated_answer 与 edited_answer 原封不动】。也没有约束兜底：0030 的 enforce_anki_part3_invariant
--   触发器只管 part3，part1/2 卡对「corpus_id 已空、卡背还在」这个状态毫无限制。
--
--   后果两层：
--     ① 用户看到的是假的 —— 他删了自己讲的故事，界面说卡背清空了，实际那段【基于他的故事生成的
--        英文答案】还留在题卡上，下次进复习/分析仍会看到。
--     ② 合规 —— 用户行使了删除权，但从其个人数据派生出的内容没被删掉，而系统告诉他删干净了。
--
--   真正会清卡背的是另外两条路，删语料这条【都没走】：
--     · 解绑 RPC  0035:unbind_anki_corpus   → 只清 generated_answer
--     · 换语料    0037:swap_anki_corpus     → generated_answer + edited_answer 都清
--
--   ── 口径（产品方 2026-08-07 拍板）─────────────────────────────────────────
--   generated_answer 与 edited_answer 【一起清】，按 0037 的口径而非 0035。理由：源故事都删了，
--   派生内容留着既没有上下文、合规上也不干净；且与现有文案「卡背清空」一致。
--   绝不动 box / due_at / last_reviewed_at —— SRS 复习进度与语料无关（同 0035/0037 的既定边界）。
--
--   ── 为什么必须是一个事务 ────────────────────────────────────────────────
--   旧实现是「删 links → 删 corpus」两条独立的客户端 DML，靠外键收尾。任何中间失败都会留下半成品：
--   「语料已删、卡背还在」（承诺落空）或「卡背已清、语料还在」（用户看到故事还在却没了答案）。
--   本 RPC 把「清卡背 + 删语料」放进同一个 plpgsql 函数体 = 同一事务，要么全成要么全回滚。
--   范式照 0035_anki_txn_rpcs.sql。
--
--   ── 语句顺序是有讲究的，别调换 ───────────────────────────────────────────
--   必须【先 update anki_cards、后 delete corpus】。反过来的话，delete 会先触发外键 on delete set null
--   把 anki_cards.corpus_id 抹成 null，随后 `where corpus_id = p_corpus_id` 一行都匹配不到 ——
--   卡背会被静默漏清，而函数依然「成功」返回。这正是本次要修的 bug 的同款形态。
--
--   ── 越权防线（本 RPC 会删数据，这是最大风险面）──────────────────────────
--   本 RPC 与 0058 那类服务端专用 RPC 不同：它由【登录用户自己在浏览器里】调用
--   （src/lib/db/corpus.ts 走 getSupabase() = anon key + 用户 JWT），不是 service_role。三道防线：
--
--     ① 【不收 user_id 参数】。唯一入参是 p_corpus_id，用户身份一律取自 JWT 的 auth.uid()，
--        调用方无从伪造。对比 0035/0037 那批 service_role RPC 都显式收 p_user_id —— 那是因为
--        service_role 侧的越权防护落在应用层（requireUser 反查），而客户端侧【不能】这么做：
--        任何 user_id 入参在客户端都等于「请随便填一个别人的 id」。
--     ② 【security invoker】（即不写 security definer，走 PG 默认）。函数以调用者身份执行，
--        RLS 逐行生效：0001 的 own_corpus_all（corpus）与 0030 的 own_anki_cards_all（anki_cards）
--        都是 `using (auth.uid() = user_id)`。这是硬防线 —— 即使将来有人改坏了函数体里的 where 条件，
--        RLS 仍然让别人的行在这个函数眼里根本不存在。
--        （刻意不用 security definer：0052 的教训就是 definer 函数默认对 anon 敞开；一个会 DELETE 的
--          definer 函数一旦漏了 auth.uid() 校验，就是「任何人删任何人语料」级别的事故。）
--     ③ 两条 DML 的 where 都显式带 `user_id = auth.uid()`，与 RLS 构成双保险（belt-and-suspenders，
--        同 drain 回填卡背时多带一条 .eq('user_id') 的做法）。
--
--   传别人的 corpus_id 会发生什么：update 的 `user_id = auth.uid()` 只可能匹配到【调用者自己的】卡行，
--   delete 的 `user_id = auth.uid()` 与 corpus 的 RLS 双双不匹配 → 两条语句都命中 0 行，
--   函数正常返回、对方数据分毫未动。与现有 deleteCorpus「删不存在的 id 也不报错」的幂等语义一致。
--
--   ── 授权 ───────────────────────────────────────────────────────────────
--   ⚠️ 必须自带 revoke：PG 对新建函数默认 GRANT EXECUTE TO PUBLIC，Supabase 的 default privileges
--   还额外给 anon / authenticated（0052 就是为此打的 hotfix，0043-0048 那批只写 grant 的旧范式是根因）。
--     · revoke from public, anon —— 未登录角色 auth.uid() 为 null，本就删不动任何东西，先收掉执行权，
--       将来即使有人把它误改成 security definer，anon 也调不进来（0054 的「给将来的误改上保险」同理）。
--     · grant to authenticated —— 这是唯一需要的授权对象。本项目的匿名试用用户走 signInAnonymously
--       （src/lib/supabase.ts），其 JWT role 同样是 authenticated（佐证：0001/0030 的 RLS 策略全是
--       `to authenticated`，而匿名用户能正常创建并读取自己的语料），故匿名试用用户删自己的语料不受影响。
--     · 【刻意不 grant service_role】—— 函数体靠 auth.uid() 定位用户，service_role 调用时 auth.uid()
--       为 null，会直接抛 CORPUS_DELETE_NO_AUTH。没有服务端调用点，也不该有。删号清理走的是
--       src/app/api/account/delete/route.ts 的整用户级联，与本 RPC 无关。
--
--   ── 在途生成任务（anki_generation_jobs）为什么不在这里动 ──────────────────
--   0035 的 unbind_anki_corpus 会顺手删掉在途任务，本 RPC 【故意不删】，因为：
--     · 0031 的 RLS 只给了 own_anki_gen_jobs_select，客户端没有 delete 策略 —— security invoker 下
--       删不掉。要删就得提权成 security definer，为此把上面那条硬防线换掉，风险收益完全不划算。
--     · 不删也不会让卡背复活：0031 的 `corpus_id references corpus(id) on delete set null` 会在本事务里
--       把残留任务的 corpus_id 置空，drain 领到后 `if (!corpus) failJob(terminal, 'CORPUS_MISSING')`
--       （src/app/api/anki/generate/drain/route.ts）判死信、直接返回，【不会写 anki_cards】，
--       且死信状态 failed 会释放 0031 的 active 部分唯一索引坑位，不挡该题日后重新入队。
--     · 唯一残留窗口是 anki-cards-server.ts 头注早已记录的那条既有极窄竞态：任务已被 drain 领走、
--       语料快照已在 worker 内存里，这一秒无论删不删任务行都拦不住那次回填。本轮不扩大范围解决。
--
--   ── 未跑本迁移前会怎样 ──────────────────────────────────────────────────
--   函数不存在 → 客户端 supabase.rpc('delete_corpus_and_clear_cards') 得到 PostgREST 的 PGRST202
--   （Could not find the function），deleteCorpus 抛「删除语料失败：…」。
--   表现：素材库删语料【当场失败并弹「删除失败，请重试」】，语料不会被删。
--   即 fail-closed —— 不会退化成「删了语料但没清卡背」的旧假承诺状态。故代码与迁移必须同批上线
--   （本仓库 .github/workflows/db-push.yml 在推 main 时自动应用，与应用部署同一次推送）。
--
--   幂等：create or replace + revoke/grant 重复执行无副作用，可安全重跑。
--   ⚠️ 本文件刻意不带 begin/commit：db:push 会自动把整份迁移包进事务，自带会嵌套出错（同 0052/0054/0057）。
-- Created   : 2026-08-07
-- -----------------------------------------------------------------------------

-- 删语料（单事务原子）：清空所有绑定该语料的自有题卡的卡背（corpus_id + generated_answer +
--   edited_answer 三者一并置空，保留 SRS 进度）→ 删语料行（corpus_point_links / corpus_question_matches
--   由 0001 / 0007 的 on delete cascade 自动清）。
-- 同一语料可绑多题：update 不限 question_id，故【全部】同源题卡一次清干净。
-- 未绑任何题的语料：update 命中 0 行（本就无卡背可清），delete 照常执行，语义正确、不报错。
create or replace function public.delete_corpus_and_clear_cards(p_corpus_id uuid)
returns void
language plpgsql
-- 刻意不写 security definer：以调用者身份执行，让 RLS 成为越权硬防线（详见顶注「越权防线」②）。
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- 无 JWT（未登录 / service_role 误调）一律拒绝：没有 auth.uid() 就无从判定「自己的」语料，
  -- 此时若放行，下面两条 where 会退化成匹配 user_id = null 的行。宁可炸掉整个事务。
  if v_uid is null then
    raise exception 'CORPUS_DELETE_NO_AUTH: 未登录，无法删除语料（本 RPC 只能由登录用户删自己的语料）';
  end if;

  -- ① 先清卡背。顺序不可与 ② 调换（详见顶注「语句顺序」）。
  --    绝不动 box / due_at / last_reviewed_at：复习进度与语料无关。
  --    part3 卡不会被命中（0030 不变式令其 corpus_id 恒 null），其用户手写的 edited_answer 不受影响
  --    —— 那不是本语料的派生内容。
  update public.anki_cards
     set corpus_id        = null,
         generated_answer = null,
         edited_answer    = null,
         updated_at       = now()
   where corpus_id = p_corpus_id
     and user_id   = v_uid;

  -- ② 再删语料行。cascade 顺带清掉 corpus_point_links（0001）与 corpus_question_matches（0007）。
  delete from public.corpus
   where id      = p_corpus_id
     and user_id = v_uid;
end;
$$;

-- ── 授权：收掉默认的 PUBLIC / anon，只给 authenticated（详见顶注「授权」）──────
revoke execute on function public.delete_corpus_and_clear_cards(uuid) from public, anon;
grant  execute on function public.delete_corpus_and_clear_cards(uuid) to authenticated;

-- ── 守卫：authenticated 必须能执行，anon 必须不能 ─────────────────────────────
-- 【为什么用 has_function_privilege 而不是直接调一次函数】SQL Editor / db:push 以超级用户身份执行，
-- 绕过一切 ACL，直接调必然成功、证明不了 authenticated 的权限。同 0052 / 0054 的守卫思路。
-- 【为什么值得加这道守卫】收错权的两个方向失败形态截然不同，都不该放行：
--   · authenticated 被收掉 → 用户删语料一律 403、素材库删除功能整体瘫痪；
--   · anon 仍可执行 → 虽然有 auth.uid() is null 的拦截兜底，但那是函数体里的一行代码，
--     属于「改一行就没了」的软防线；ACL 层收住才是不依赖函数体正确性的硬防线。
do $$
begin
  if not has_function_privilege('authenticated', 'public.delete_corpus_and_clear_cards(uuid)', 'execute') then
    raise exception '守卫失败：authenticated 不能执行 delete_corpus_and_clear_cards，整份迁移已回滚。删语料会全线 403，不要放行。';
  end if;
  if has_function_privilege('anon', 'public.delete_corpus_and_clear_cards(uuid)', 'execute') then
    raise exception '守卫失败：anon 仍能执行 delete_corpus_and_clear_cards，收权没生效，整份迁移已回滚。';
  end if;
  raise notice '✅ 守卫通过：delete_corpus_and_clear_cards —— authenticated 可执行、anon 已收权。';
end $$;
