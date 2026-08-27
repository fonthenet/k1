-- Rawdati — multi-tenant kindergarten management platform
-- All platform tables are prefixed kg_ (this database is shared with a legacy prototype).

create extension if not exists pgcrypto;

-- ===== Enums =====
create type kg_role as enum ('owner','admin','educator','staff','accountant','parent');
create type kg_member_status as enum ('active','invited','disabled');
create type kg_child_status as enum ('pending','enrolled','waitlist','withdrawn','alumni');
create type kg_gender as enum ('male','female');
create type kg_relationship as enum ('father','mother','guardian','grandparent','sibling','other');
create type kg_allergy_severity as enum ('mild','moderate','severe');
create type kg_application_status as enum ('submitted','under_review','approved','rejected','waitlist');
create type kg_attendance_status as enum ('present','absent','late','excused','sick');
create type kg_checkin_method as enum ('tag','kiosk','manual','parent');
create type kg_fee_period as enum ('once','monthly','quarterly','yearly','per_session');
create type kg_invoice_status as enum ('draft','sent','unpaid','partial','paid','overdue','void');
create type kg_payment_method as enum ('cash','cib','edahabia','bank_transfer','cheque','chargily','other');
create type kg_txn_kind as enum ('income','expense');
create type kg_payroll_status as enum ('draft','finalized','paid');
create type kg_audience as enum ('all','parents','staff','class');
create type kg_activity_enrollment_status as enum ('requested','active','ended','cancelled');

-- ===== Tenancy =====
create table kg_tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  phone text,
  email text,
  address text,
  wilaya text default 'Jijel',
  commune text,
  currency text not null default 'DZD',
  default_locale text not null default 'fr',
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table kg_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  avatar_url text,
  locale text not null default 'fr',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table kg_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role kg_role not null default 'parent',
  status kg_member_status not null default 'active',
  job_title text,
  hire_date date,
  base_salary numeric(12,2),
  staff_code text,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index on kg_memberships (user_id);
create index on kg_memberships (tenant_id, role);

create table kg_staff_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  email text not null,
  role kg_role not null default 'educator',
  job_title text,
  token text not null unique default encode(gen_random_bytes(16),'hex'),
  invited_by uuid references auth.users(id),
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);

-- ===== Classes =====
create table kg_classes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  name text not null,
  name_ar text,
  age_min_months int,
  age_max_months int,
  capacity int not null default 20,
  room text,
  color text not null default '#6366f1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on kg_classes (tenant_id);

create table kg_class_staff (
  class_id uuid not null references kg_classes(id) on delete cascade,
  membership_id uuid not null references kg_memberships(id) on delete cascade,
  is_main boolean not null default false,
  primary key (class_id, membership_id)
);

-- ===== Children & families =====
create table kg_children (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  class_id uuid references kg_classes(id) on delete set null,
  first_name text not null,
  last_name text not null,
  dob date not null,
  gender kg_gender not null,
  photo_path text,
  blood_type text,
  status kg_child_status not null default 'enrolled',
  tag_code text,
  enrollment_date date default current_date,
  withdrawal_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, tag_code)
);
create index on kg_children (tenant_id, status);
create index on kg_children (class_id);

create table kg_guardians (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  first_name text not null,
  last_name text not null,
  relationship kg_relationship not null default 'guardian',
  phone text not null,
  phone_alt text,
  email text,
  national_id text,
  address text,
  workplace text,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on kg_guardians (tenant_id);
create index on kg_guardians (user_id);

create table kg_child_guardians (
  child_id uuid not null references kg_children(id) on delete cascade,
  guardian_id uuid not null references kg_guardians(id) on delete cascade,
  is_primary boolean not null default false,
  can_pickup boolean not null default true,
  is_financial boolean not null default false,
  primary key (child_id, guardian_id)
);

create table kg_authorized_pickups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  child_id uuid not null references kg_children(id) on delete cascade,
  name text not null,
  relationship text,
  phone text,
  national_id text,
  photo_path text,
  created_at timestamptz not null default now()
);
create index on kg_authorized_pickups (child_id);

create table kg_child_health (
  child_id uuid primary key references kg_children(id) on delete cascade,
  medical_conditions jsonb not null default '[]'::jsonb,
  medications jsonb not null default '[]'::jsonb,
  vaccinations jsonb not null default '[]'::jsonb,
  dietary_restrictions text,
  special_needs text,
  doctor_name text,
  doctor_phone text,
  emergency_notes text,
  updated_at timestamptz not null default now()
);

create table kg_child_allergies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  child_id uuid not null references kg_children(id) on delete cascade,
  allergen text not null,
  severity kg_allergy_severity not null default 'mild',
  reaction text,
  action_plan text,
  created_at timestamptz not null default now()
);
create index on kg_child_allergies (child_id);
create index on kg_child_allergies (tenant_id);

create table kg_child_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  child_id uuid not null references kg_children(id) on delete cascade,
  doc_type text not null default 'other',
  title text not null,
  file_path text not null,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on kg_child_documents (child_id);

-- ===== Enrollment (parent self-signup) =====
create table kg_enroll_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(12),'hex'),
  label text not null default 'Lien d''inscription',
  active boolean not null default true,
  expires_at timestamptz,
  max_uses int,
  use_count int not null default 0,
  default_class_id uuid references kg_classes(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on kg_enroll_links (tenant_id);

create table kg_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  link_id uuid references kg_enroll_links(id) on delete set null,
  applicant_user_id uuid references auth.users(id) on delete set null,
  status kg_application_status not null default 'submitted',
  child jsonb not null,
  guardians jsonb not null default '[]'::jsonb,
  health jsonb not null default '{}'::jsonb,
  activity_ids jsonb not null default '[]'::jsonb,
  note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_child_id uuid references kg_children(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on kg_applications (tenant_id, status);
create index on kg_applications (applicant_user_id);

-- ===== Activities =====
create table kg_activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  name text not null,
  name_ar text,
  description text,
  category text not null default 'general',
  fee_amount numeric(12,2) not null default 0,
  fee_period kg_fee_period not null default 'monthly',
  schedule jsonb not null default '[]'::jsonb,
  capacity int,
  photo_path text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on kg_activities (tenant_id, active);

create table kg_activity_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  activity_id uuid not null references kg_activities(id) on delete cascade,
  child_id uuid not null references kg_children(id) on delete cascade,
  status kg_activity_enrollment_status not null default 'active',
  start_date date default current_date,
  end_date date,
  created_at timestamptz not null default now(),
  unique (activity_id, child_id)
);
create index on kg_activity_enrollments (child_id);
create index on kg_activity_enrollments (tenant_id);

-- ===== Attendance (children) =====
create table kg_attendance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  child_id uuid not null references kg_children(id) on delete cascade,
  date date not null default current_date,
  status kg_attendance_status not null default 'present',
  check_in_at timestamptz,
  check_out_at timestamptz,
  check_in_method kg_checkin_method,
  check_out_method kg_checkin_method,
  checked_in_by uuid references auth.users(id),
  checked_out_by uuid references auth.users(id),
  picked_up_by text,
  absence_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (child_id, date)
);
create index on kg_attendance (tenant_id, date);

-- ===== Staff time clock =====
create table kg_timesheets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  membership_id uuid not null references kg_memberships(id) on delete cascade,
  date date not null default current_date,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  method kg_checkin_method not null default 'manual',
  approved boolean not null default false,
  approved_by uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on kg_timesheets (tenant_id, date);
create index on kg_timesheets (membership_id, date);

-- ===== Billing (money in from families) =====
create table kg_fee_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  name text not null,
  name_ar text,
  amount numeric(12,2) not null,
  period kg_fee_period not null default 'monthly',
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on kg_fee_plans (tenant_id);

create table kg_child_fees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  child_id uuid not null references kg_children(id) on delete cascade,
  fee_plan_id uuid not null references kg_fee_plans(id) on delete cascade,
  custom_amount numeric(12,2),
  discount_pct numeric(5,2) not null default 0,
  discount_note text,
  start_date date not null default current_date,
  end_date date,
  created_at timestamptz not null default now(),
  unique (child_id, fee_plan_id)
);
create index on kg_child_fees (tenant_id);

create table kg_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  child_id uuid not null references kg_children(id) on delete cascade,
  number int not null,
  period_month date,
  issue_date date not null default current_date,
  due_date date,
  status kg_invoice_status not null default 'unpaid',
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, number)
);
create index on kg_invoices (tenant_id, status);
create index on kg_invoices (child_id);

create table kg_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references kg_invoices(id) on delete cascade,
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  kind text not null default 'tuition',
  description text not null,
  qty numeric(8,2) not null default 1,
  unit_amount numeric(12,2) not null default 0,
  amount numeric(12,2) not null default 0,
  activity_id uuid references kg_activities(id) on delete set null
);
create index on kg_invoice_items (invoice_id);

create table kg_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  invoice_id uuid references kg_invoices(id) on delete set null,
  child_id uuid references kg_children(id) on delete set null,
  amount numeric(12,2) not null,
  method kg_payment_method not null default 'cash',
  reference text,
  receipt_number text,
  paid_at timestamptz not null default now(),
  received_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now()
);
create index on kg_payments (tenant_id, paid_at);
create index on kg_payments (invoice_id);

-- ===== Accounting (general ledger-lite) =====
create table kg_txn_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  name text not null,
  kind kg_txn_kind not null,
  color text not null default '#94a3b8',
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);
create index on kg_txn_categories (tenant_id, kind);

create table kg_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  kind kg_txn_kind not null,
  category_id uuid references kg_txn_categories(id) on delete set null,
  amount numeric(12,2) not null,
  date date not null default current_date,
  method kg_payment_method not null default 'cash',
  description text not null default '',
  reference text,
  related_payment_id uuid references kg_payments(id) on delete set null,
  attachment_path text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on kg_transactions (tenant_id, date);
create index on kg_transactions (tenant_id, kind);

-- ===== Payroll =====
create table kg_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  month date not null,
  status kg_payroll_status not null default 'draft',
  finalized_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, month)
);

create table kg_payroll_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references kg_payroll_runs(id) on delete cascade,
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  membership_id uuid not null references kg_memberships(id) on delete cascade,
  base_amount numeric(12,2) not null default 0,
  bonuses numeric(12,2) not null default 0,
  deductions numeric(12,2) not null default 0,
  advances_deducted numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  paid_at timestamptz,
  method kg_payment_method,
  note text,
  unique (run_id, membership_id)
);
create index on kg_payroll_items (tenant_id);

create table kg_salary_advances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  membership_id uuid not null references kg_memberships(id) on delete cascade,
  amount numeric(12,2) not null,
  date date not null default current_date,
  repaid boolean not null default false,
  payroll_item_id uuid references kg_payroll_items(id) on delete set null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on kg_salary_advances (tenant_id, membership_id);

-- ===== Communication =====
create table kg_announcements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  title text not null,
  body text not null default '',
  audience kg_audience not null default 'all',
  class_id uuid references kg_classes(id) on delete cascade,
  pinned boolean not null default false,
  publish_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on kg_announcements (tenant_id, publish_at desc);

create table kg_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  child_id uuid references kg_children(id) on delete cascade,
  subject text not null default '',
  created_by uuid not null references auth.users(id),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on kg_threads (tenant_id, last_message_at desc);

create table kg_thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references kg_threads(id) on delete cascade,
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  body text not null,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index on kg_thread_messages (thread_id, created_at);

create table kg_daily_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  child_id uuid not null references kg_children(id) on delete cascade,
  date date not null default current_date,
  mood text,
  meals jsonb not null default '[]'::jsonb,
  nap jsonb,
  bathroom jsonb not null default '[]'::jsonb,
  activities_text text,
  photos jsonb not null default '[]'::jsonb,
  notes text,
  published boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (child_id, date)
);
create index on kg_daily_reports (tenant_id, date);

create table kg_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz,
  audience kg_audience not null default 'all',
  class_id uuid references kg_classes(id) on delete cascade,
  color text not null default '#f59e0b',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on kg_events (tenant_id, start_at);

create table kg_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references kg_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'info',
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on kg_notifications (user_id, created_at desc);

create table kg_audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid references kg_tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on kg_audit_log (tenant_id, created_at desc);

-- ===== updated_at trigger =====
create or replace function kg_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'kg_tenants','kg_profiles','kg_memberships','kg_classes','kg_children','kg_guardians',
    'kg_applications','kg_activities','kg_attendance','kg_timesheets','kg_fee_plans',
    'kg_invoices','kg_transactions','kg_announcements','kg_daily_reports'
  ] loop
    execute format('create trigger trg_%s_touch before update on %I for each row execute function kg_touch_updated_at()', t, t);
  end loop;
end $$;
