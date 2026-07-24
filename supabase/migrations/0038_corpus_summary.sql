-- -----------------------------------------------------------------------------
-- Migration : 0038_corpus_summary
-- Desc      : corpus 增加「一句话概括」字段 summary —— 整理语料时 AI 顺手多产一句
--             （≤ 20 字，说清「这条语料讲的啥」，如「跟室友因宿舍卫生分工道歉」），
--             供 Anki 题卡正面在题干下方给用户一句上下文提示（全站受益）。
--
--   语义：summary 是「这段语料本身讲了什么」的极简概括，与 cleaned_text（整理后正文）
--         同源同一次 restructure 调用产出，写入路径见 src/services/restructure.ts +
--         src/lib/db/corpus.ts updateCorpusCleaned。
--
--   可空：旧语料（本迁移前建的行）summary 为 NULL，前端按空降级（整行不渲染）；
--         上线前另有回填脚本批量补（见 docs/Anki-剩余待办.md），本迁移不回填存量。
--
--   幂等：ADD COLUMN IF NOT EXISTS，可安全重跑。
-- Created   : 2026-07-24
-- Note      : 本迁移须在 Supabase SQL Editor 手动执行——仓库无 CLI，DDL 不走 REST 通道。
-- -----------------------------------------------------------------------------

ALTER TABLE corpus ADD COLUMN IF NOT EXISTS summary TEXT;
