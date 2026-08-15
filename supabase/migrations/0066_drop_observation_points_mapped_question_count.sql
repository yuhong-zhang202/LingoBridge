-- -----------------------------------------------------------------------------
-- Migration : 0066_drop_observation_points_mapped_question_count
-- Desc      : 删除 `observation_points.mapped_question_count` —— 一个【从未被写入过】的假数字。
-- Created   : 2026-08-15
--
--   【这一列为什么是错的，不是"过期"是"从来就没对过"】
--   它在 0001 建表时带着 `default 0` 出生，此后**没有任何触发器、没有任何迁移、没有任何回写脚本**
--   维护过它。表里现存的值来自建表当时那份人工快照，与题库真实映射（question_observation_links）
--   之间没有任何同步机制。所以它不是「有点旧」，是**两个方向都能错**，实测两例：
--     · EMO_05「让你感到充电的事」    实算 28 道题，本列存 0；
--     · REL_06「一个让你印象深刻的陌生人」实算  0 道题，本列存 4。
--   一个把"有题"说成"没题"，一个把"没题"说成"有题"——凭它做任何判断都是抛硬币。
--
--   【为什么现在删，而不是"反正没人用先放着"】
--   代码侧确实只把它读进 TS 类型（lib/db/observation-points.ts → lib/types.ts），从不参与任何判断，
--   当前**无线上危害**。但产品方即将引入「这个观察点挂了几道题」这个概念 —— 那正是一个名字叫
--   `mapped_question_count`、类型是 int、看上去理所当然的字段最容易被顺手拿去用的时刻。
--   一个假字段的危险程度不取决于它今天有没有被用，而取决于它有多像真的。趁没人用先删掉。
--
--   🔴【真要这个数怎么取】用 `src/lib/db/questions.ts` 的 `getQuestionCountByObservations()`
--      对 question_observation_links **实算**。那是唯一真源，随题库导入自动跟着变；
--      **绝不要再往 observation_points 上加一个"缓存计数"列** —— 上一次就是这么开始的。
--
--   ⚠️【本次刻意【不】删 rich_threshold —— 提案里它与本列同批，但事实不同】
--      提案的依据是"它同病：也无写入方、无生产消费者"。两条都不成立，已核实：
--        · 有写入方：0001 建它是 `int not null`（无默认值），0003 / 0017 两份迁移与
--          supabase/seed.sql、scripts/data/observation-points-seed.json 都在显式写它；
--        · 有生产消费者：`0002_dimension_scores.sql` 的 `get_dimension_scores()` 正是拿它当
--          分子上限与分母算维度得分 ——
--              least(coalesce(pc.cnt,0), op.rich_threshold) / sum(op.rich_threshold)
--          该函数由 `src/lib/db/dimension-scores.ts` 直连调用，撑着 /profile 的能力雷达图
--          与 /question-bank 的维度进度。
--      Postgres 对字符串体的 SQL 函数【不做列依赖追踪】，所以 `drop column rich_threshold`
--      会**成功执行、不报任何错**，然后雷达图在下一次真实调用时才 500。
--      这类「删一个'没人用'的字段，结果打断线上功能」正是本项目要防的同型事故，故就此打住、
--      交产品方裁决。若日后确要删，必须先改写 0002 的两个函数并回归 /profile 与 /question-bank。
-- -----------------------------------------------------------------------------

alter table observation_points
  drop column if exists mapped_question_count;

comment on table observation_points is
  '观察点参考数据（唯一真源是 extraction.ts 的 SYSTEM_PROMPT，本表是下游）。'
  '⚠️ 不要在本表上加任何"挂了几道题"的缓存计数列：'
  '原 mapped_question_count 因无人回写而双向失真，已于 0066 删除；'
  '该数一律用 getQuestionCountByObservations() 对 question_observation_links 实算。';
