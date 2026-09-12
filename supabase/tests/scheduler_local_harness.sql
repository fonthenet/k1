-- LOCAL DISPOSABLE DATABASE ONLY. psql -v ON_ERROR_STOP=1 -f this_file
-- Replays the real scheduler dependencies, not the unrelated full application.
-- Then: scheduler_hardening.sql (0150) and room_bookings.sql (0155/0156).
-- auth.users/auth.uid emulate Supabase locally; remote auth/notification
-- integration is deliberately not claimed by this focused harness.
\set ON_ERROR_STOP on
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
insert into auth.users select gen_random_uuid(),now() from generate_series(1,3);
\ir ../migrations/0001_kg_schema.sql
\ir ../migrations/0002_kg_research_additions.sql
\ir ../migrations/0003_kg_rls.sql
\ir ../migrations/0009_kg_center_type.sql
\ir ../migrations/0010_kg_sessions_tasks_pipeline.sql
-- Rooms (0123) need kg_touch_updated_at from 0001 and kg_is_member/kg_is_admin
-- from 0003, nothing later; the room ledger (0155) needs the table.
\ir ../migrations/0123_kg_rooms.sql
\ir ../migrations/0068_kg_tenant_opening_hours.sql
-- The current structure shape needed by 0134 (avoids replaying billing setup).
create table public.kg_structures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.kg_tenants(id) on delete cascade,
  name text not null,
  center_type public.kg_center_type not null default 'kindergarten'
);
alter table public.kg_classes add column structure_id uuid references public.kg_structures(id) on delete set null;
alter table public.kg_children add column structure_id uuid references public.kg_structures(id) on delete set null;
\ir ../migrations/0134_kg_structures_everywhere.sql
\ir ../migrations/0146_kg_private_school_types.sql
grant select,insert,update,delete on all tables in schema public to authenticated;
\ir ../migrations/0147_kg_learning_workflows.sql
\ir ../migrations/0148_kg_learning_history.sql
\ir ../migrations/0149_kg_learning_class_index.sql
\ir ../migrations/0150_kg_scheduler_hardening.sql
-- 0135 is not replayed: 0155 recreates kg_room_refuse_orphaning and its trigger
-- (drop trigger if exists), so the room guard under test is the widened one.
\ir ../migrations/0155_kg_room_bookings.sql
\ir ../migrations/0156_kg_activities_schedule_shape.sql
