-- -----------------------------------------------------------------------------
-- Migration : 0002_dimension_scores
-- Desc      : 维度得分与维度进度的只读 Postgres 函数（调用方需有 authenticated 角色）
-- Created   : 2026-06-02
-- -----------------------------------------------------------------------------

-- 维度得分（§8.4）：Σmin(该点 primary 语料数, 阈值) ÷ Σ该维度所有点阈值
create or replace function get_dimension_scores()
returns table(dimension_id text, score numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with primary_counts as (
    select cpl.point_id, count(*)::int as cnt
    from corpus_point_links cpl
    join corpus c on c.id = cpl.corpus_id
    where cpl.role = 'primary' and c.user_id = auth.uid()
    group by cpl.point_id
  ),
  point_scores as (
    select op.dimension_id,
           least(coalesce(pc.cnt, 0), op.rich_threshold) as num,
           op.rich_threshold as den
    from observation_points op
    left join primary_counts pc on pc.point_id = op.id
  )
  select ps.dimension_id,
         case when sum(ps.den) = 0 then 0
              else round(sum(ps.num)::numeric / sum(ps.den)::numeric, 4)
         end as score
  from point_scores ps
  group by ps.dimension_id;
$$;

-- 维度进度：该维度已亮灯（≥1 条 primary 语料）的观察点数 / 该维度观察点总数
create or replace function get_dimension_progress()
returns table(dimension_id text, lit int, total int)
language sql
stable
security invoker
set search_path = public
as $$
  with lit_points as (
    select distinct cpl.point_id
    from corpus_point_links cpl
    join corpus c on c.id = cpl.corpus_id
    where cpl.role = 'primary' and c.user_id = auth.uid()
  )
  select op.dimension_id,
         count(*) filter (where lp.point_id is not null)::int as lit,
         count(*)::int as total
  from observation_points op
  left join lit_points lp on lp.point_id = op.id
  group by op.dimension_id;
$$;

grant execute on function get_dimension_scores() to authenticated;
grant execute on function get_dimension_progress() to authenticated;
