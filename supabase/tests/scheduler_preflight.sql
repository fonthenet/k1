-- Read-only diagnostic. Zero rows in BOTH result sets is required before apply.
-- Includes completed and no_show: only cancellation releases staff occupancy.
select 'session' source, id, 'invalid duration or timestamp' problem
from public.kg_sessions where duration_min <= 0 or not isfinite(scheduled_at)
union all
select 'lesson', id, 'invalid timestamp'
from public.kg_learning_lessons where not isfinite(starts_at) or not isfinite(ends_at);

with bookings as (
  select 'lesson' source,id,tenant_id,membership_id,status,starts_at,ends_at
  from public.kg_learning_lessons where status <> 'cancelled'
  union all
  select 'session',id,tenant_id,therapist_id,status::text,scheduled_at,
    scheduled_at + duration_min * interval '1 minute'
  from public.kg_sessions where status <> 'cancelled' and therapist_id is not null
)
select a.membership_id, a.tenant_id, a.source a_source,a.id a_id,a.status a_status,
  b.source b_source,b.id b_id,b.status b_status,
  greatest(a.starts_at,b.starts_at) overlap_start,least(a.ends_at,b.ends_at) overlap_end
from bookings a join bookings b
  on a.membership_id=b.membership_id and (a.source,a.id)<(b.source,b.id)
  and a.starts_at<b.ends_at and b.starts_at<a.ends_at
order by a.membership_id,overlap_start,a.id,b.id;
