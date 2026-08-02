-- -----------------------------------------------------------------------------
-- Migration : 0053_flow_events_instrumentation_v2
-- Desc      : 补埋点（漏斗 D0–D5）的数据库地基，三件事：
--             ① event CHECK 由「枚举白名单」放宽为「前缀正则」——一次到位，免得每加一个事件名
--                就得追一条迁移（且线上没跑迁移前新事件全被静默丢掉）。只放宽不收窄：
--                现有 4 类事件名（match.result / flow.corpus_bound / match.view_rendered /
--                match.question_opened）全部仍合法，历史数据一行不影响、不丢。
--             ② 新增 is_qa 列：把产品方自测流量标出来，离线算漏斗时剔除。
--             ③ 新增 (user_id, created_at desc) 索引：漏斗一律按人聚合查（见下方口径说明）。
--             幂等：drop constraint if exists 再 add / add column if not exists / create index
--             if not exists，可安全重跑。
--
-- ⚠️ 事件名的真闸【不在这里】。CHECK 放宽后，DB 只拦形态、不再拦具体名字；
--    唯一的事件名白名单是 src/app/api/events/route.ts 的 EVENT_SPECS 分发表（未注册立即 400）
--    与 src/lib/events.ts 的 FlowEventName 联合类型。改事件名先改那两处。
--
-- ⚠️ 未跑本迁移之前，所有新事件名都会被旧的枚举 CHECK 拒绝，而 logEvent 内部 try/catch 会把
--    错误吞掉（只 console.error、不阻断主链路）—— 表现为【埋点代码全在跑、库里零数据】，
--    页面上一点异常都看不出来。上线补埋点前必须先跑本迁移。
--
-- ⚠️ is_qa 红线（与 src/lib/qa-flag.ts / qa-traffic.ts 顶注同文，逐字保留）：
--    本标记来自客户端可控输入（URL 参数 → localStorage → 请求头），**可伪造**。
--    **永久禁止**用于额度 / 权限 / 计费 / RLS 判定，只可写入统计列。
--    额度判定一律走服务端 isInternalAccount(userId)。
--    一旦把它接上业务闸，「加个 URL 参数就能无限白嫖」立即成立。
--
-- ⚠️ 基线起算日：本迁移之前的历史数据里混着产品方自测流量，且【无法回溯标记】
--    （谁在什么时候自测过，事后没有任何依据可判）。故 is_qa 一律默认 false，
--    漏斗基线只能从本迁移生效日往后算，不要把生效日之前的数据并进来做同比。
--
-- ⚠️ 刻意【不建 qa_users 之类的视图】：视图无 RLS，且 PG 默认 security_invoker=false 会以
--    owner 身份执行、绕过 flow_events 的 RLS；Supabase 的 pg_default_acl 还会自动给 anon 授权，
--    等于凭空开一条匿名直读埋点表的路径。要排除 QA 流量，离线查询里写子查询即可。
--
-- Created   : 2026-08-02
-- Note      : 用 `npm run db:push` 应用。
-- Note      : 2026-08-02【本次仅修正下方 ③ 的注释表述，SQL 语句一字未变】——
--             本迁移已应用到生产，注释改动不影响既成结果，也无需重跑。
--             原表述「recording 页早退时残留上次流程的 flow_id」的理由已过期（commit 3e07e53 已把
--             newFlowId() 提到函数最开头）；结论（按 user_id 聚合）仍然成立，真正的理由见新注释。
-- -----------------------------------------------------------------------------

-- ① 事件名 CHECK 由枚举白名单放宽为前缀正则（只放宽不收窄，现有 4 类全部仍合法）
alter table public.flow_events drop constraint if exists flow_events_event_check;
alter table public.flow_events add constraint flow_events_event_check
  check (event ~ '^(flow|match|quota|auth|page)\.[a-z][a-z0-9_]{1,39}$');

-- ② QA 流量标记列（纯统计用，红线见上）
alter table public.flow_events add column if not exists is_qa boolean not null default false;

-- ③ 按人聚合的漏斗查询索引（分析 P0 事件时忽略 flow_id、一律按 user_id 聚合：
--    capture_started / capture_abandoned 在页面挂载/卸载时上报，早于本次流程的 newFlowId()，
--    携带的是 sessionStorage 里上一次流程的 flow_id，见 client-events.ts 顶注）
create index if not exists flow_events_user_created_idx
  on public.flow_events (user_id, created_at desc);
