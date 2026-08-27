-- Sessions/programmes, team tasks and the admissions-pipeline columns.
--
-- These objects were created directly against the database during development
-- and had no migration file, so a fresh deployment (a new kindergarten signing
-- up on a clean project) would have been missing them entirely. This file is
-- reconstructed from the live schema and is idempotent.

-- ── Enums ────────────────────────────────────────────────────────────────
do $$ begin
  create type kg_session_type as enum
    ('speech','occupational','behavioral','physio','psychological','tutoring','followup','other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type kg_program_status as enum ('active','completed','paused','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type kg_session_status as enum ('scheduled','completed','cancelled','no_show');
exception when duplicate_object then null; end $$;
do $$ begin
  create type kg_task_status as enum ('todo','in_progress','done','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type kg_task_priority as enum ('low','normal','high','urgent');
exception when duplicate_object then null; end $$;

-- ── Admissions pipeline metadata (stages themselves are in 0009) ─────────
alter table kg_applications add column if not exists waitlist_position integer;
alter table kg_applications add column if not exists interview_at timestamptz;
alter table kg_applications add column if not exists source text;

-- ── Programmes (a course of sessions for one child) ──────────────────────
create table if not exists kg_programs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  child_id uuid not null references kg_children(id) on delete cascade,
  name text not null,
  session_type kg_session_type not null default 'other',
  therapist_id uuid references kg_memberships(id) on delete set null,
  goals jsonb not null default '[]'::jsonb,
  sessions_planned integer,
  fee_per_session numeric(12,2) not null default 0,
  start_date date not null default current_date,
  end_date date,
  status kg_program_status not null default 'active',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kg_programs_child_id_idx on kg_programs (child_id);
create index if not exists kg_programs_tenant_id_status_idx on kg_programs (tenant_id, status);

create table if not exists kg_program_goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  program_id uuid not null references kg_programs(id) on delete cascade,
  title text not null,
  target text,
  progress_pct integer not null default 0 check (progress_pct >= 0 and progress_pct <= 100),
  achieved boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists kg_program_goals_program_id_idx on kg_program_goals (program_id);

-- ── Sessions ─────────────────────────────────────────────────────────────
create table if not exists kg_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  child_id uuid not null references kg_children(id) on delete cascade,
  program_id uuid references kg_programs(id) on delete set null,
  session_type kg_session_type not null default 'other',
  therapist_id uuid references kg_memberships(id) on delete set null,
  scheduled_at timestamptz not null,
  duration_min integer not null default 45,
  status kg_session_status not null default 'scheduled',
  progress_rating integer check (progress_rating >= 1 and progress_rating <= 5),
  notes text,              -- internal
  parent_summary text,     -- shown to the family once published
  published boolean not null default false,
  billed boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kg_sessions_tenant_id_scheduled_at_idx on kg_sessions (tenant_id, scheduled_at);
create index if not exists kg_sessions_child_id_scheduled_at_idx on kg_sessions (child_id, scheduled_at desc);
create index if not exists kg_sessions_therapist_id_scheduled_at_idx on kg_sessions (therapist_id, scheduled_at);

-- ── Team tasks ───────────────────────────────────────────────────────────
create table if not exists kg_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  title text not null,
  description text,
  assignee_id uuid references kg_memberships(id) on delete set null,
  child_id uuid references kg_children(id) on delete set null,
  invoice_id uuid references kg_invoices(id) on delete set null,
  due_date date,
  status kg_task_status not null default 'todo',
  priority kg_task_priority not null default 'normal',
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kg_tasks_tenant_id_status_due_date_idx on kg_tasks (tenant_id, status, due_date);
create index if not exists kg_tasks_assignee_id_status_idx on kg_tasks (assignee_id, status);

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table kg_programs       enable row level security;
alter table kg_program_goals  enable row level security;
alter table kg_sessions       enable row level security;
alter table kg_tasks          enable row level security;

drop policy if exists pg_sel on kg_programs;
drop policy if exists pg_ins on kg_programs;
drop policy if exists pg_upd on kg_programs;
drop policy if exists pg_del on kg_programs;
create policy pg_sel on kg_programs for select using (kg_is_staff(tenant_id) or kg_is_parent_of(child_id));
create policy pg_ins on kg_programs for insert with check (kg_is_educator(tenant_id));
create policy pg_upd on kg_programs for update using (kg_is_educator(tenant_id));
create policy pg_del on kg_programs for delete using (kg_is_admin(tenant_id));

drop policy if exists pgg_sel on kg_program_goals;
drop policy if exists pgg_all on kg_program_goals;
create policy pgg_sel on kg_program_goals for select using (
  kg_is_staff(tenant_id)
  or exists (select 1 from kg_programs p where p.id = program_id and kg_is_parent_of(p.child_id))
);
create policy pgg_all on kg_program_goals for all
  using (kg_is_educator(tenant_id)) with check (kg_is_educator(tenant_id));

-- Parents see a session only once the educator publishes it.
drop policy if exists ss_sel on kg_sessions;
drop policy if exists ss_ins on kg_sessions;
drop policy if exists ss_upd on kg_sessions;
drop policy if exists ss_del on kg_sessions;
create policy ss_sel on kg_sessions for select using (kg_is_staff(tenant_id) or (published and kg_is_parent_of(child_id)));
create policy ss_ins on kg_sessions for insert with check (kg_is_educator(tenant_id));
create policy ss_upd on kg_sessions for update using (kg_is_educator(tenant_id));
create policy ss_del on kg_sessions for delete using (kg_is_admin(tenant_id));

-- Tasks are internal: no parent ever reads this table.
drop policy if exists tk_sel on kg_tasks;
drop policy if exists tk_ins on kg_tasks;
drop policy if exists tk_upd on kg_tasks;
drop policy if exists tk_del on kg_tasks;
create policy tk_sel on kg_tasks for select using (kg_is_staff(tenant_id));
create policy tk_ins on kg_tasks for insert with check (kg_is_staff(tenant_id));
create policy tk_upd on kg_tasks for update using (kg_is_staff(tenant_id));
create policy tk_del on kg_tasks for delete using (kg_is_admin(tenant_id));

-- updated_at triggers, matching the pattern in 0001
do $$
declare t text;
begin
  foreach t in array array['kg_programs','kg_sessions','kg_tasks'] loop
    if not exists (select 1 from pg_trigger where tgname = 'trg_' || t || '_touch') then
      execute format('create trigger trg_%s_touch before update on %I for each row execute function kg_touch_updated_at()', t, t);
    end if;
  end loop;
end $$;
