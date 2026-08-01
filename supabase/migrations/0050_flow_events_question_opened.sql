-- -----------------------------------------------------------------------------
-- Migration : 0050_flow_events_question_opened
-- Desc      : flow_events 的 event CHECK 约束新增事件名 'match.question_opened' ——
--             记录「用户在匹配结果里点开了排第几位的题」（props: rank 1-based 排位 + candidateCount 列表总数）。
--             用途：① 定 analysis 预取范围（用户实际点前几道）；② 看 ranking 排序质量（若总点第 5 道而非
--             第 1 道 = 重排排序本身有问题，此前完全看不见）。探针 ranking-latency-probe 已确认现有三类事件
--             都不含此信号，故补埋点。
--
--             幂等：drop constraint if exists 再 add，可安全重跑（约束名 flow_events_event_check，
--             = 0018 建表时的默认命名）。只放宽枚举、不收窄，现有数据（全是旧三类事件名）不受影响、不丢。
--             ⚠️ 数据库改动，需部署方在 Supabase 控制台 SQL Editor 手动跑（形态同 0018-0023、0046-0049）：
--                本文件不自动执行；未跑前客户端上报的新事件会被约束拒绝、logEvent 内部吞掉（静默无数据），
--                跑后自动开始留痕。
-- Created   : 2026-08-01
-- -----------------------------------------------------------------------------

alter table public.flow_events drop constraint if exists flow_events_event_check;
alter table public.flow_events add constraint flow_events_event_check
  check (event in ('match.result', 'flow.corpus_bound', 'match.view_rendered', 'match.question_opened'));
