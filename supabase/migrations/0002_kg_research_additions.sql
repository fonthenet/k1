-- Additions from competitive/regulatory research (décret 19-253, Famly/Brightwheel/Kinderpedia patterns)

-- Dual-script names (Arabic + Latin) and kiosk PINs
alter table kg_children add column first_name_ar text, add column last_name_ar text;
alter table kg_guardians add column first_name_ar text, add column last_name_ar text,
  add column pin_code text, add column tag_code text;
alter table kg_memberships add column pin_code text;

-- Incident / accident reports with parent acknowledgement loop
create type kg_incident_severity as enum ('minor','moderate','serious');
create table kg_incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  child_id uuid not null references kg_children(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  severity kg_incident_severity not null default 'minor',
  location text,
  description text not null,
  action_taken text,
  reported_by uuid references auth.users(id),
  parent_notified_at timestamptz,
  parent_ack_at timestamptz,
  parent_ack_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on kg_incidents (tenant_id, occurred_at desc);
create index on kg_incidents (child_id);

-- Consent engine (photo consent, outings, ...)
create table kg_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  child_id uuid not null references kg_children(id) on delete cascade,
  consent_type text not null,
  granted boolean,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (child_id, consent_type)
);
create index on kg_consents (tenant_id);

-- Tenant compliance documents with expiry tracking (agrément, insurance, conformity cert)
create table kg_tenant_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  doc_type text not null default 'other',
  title text not null,
  file_path text,
  issued_at date,
  expires_at date,
  created_at timestamptz not null default now()
);
create index on kg_tenant_documents (tenant_id, expires_at);

-- Staff leave requests
create type kg_leave_status as enum ('pending','approved','rejected','cancelled');
create table kg_leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  membership_id uuid not null references kg_memberships(id) on delete cascade,
  leave_type text not null default 'vacation',
  start_date date not null,
  end_date date not null,
  reason text,
  status kg_leave_status not null default 'pending',
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index on kg_leave_requests (tenant_id, status);
create index on kg_leave_requests (membership_id);

-- Weekly menus (with allergen awareness)
create table kg_menus (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  date date not null,
  breakfast text,
  lunch text,
  snack text,
  allergens jsonb not null default '[]'::jsonb,
  notes text,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, date)
);

-- Holiday calendar (fixed civil + tentative religious dates, admin-confirmable)
create table kg_holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  date date not null,
  end_date date,
  name text not null,
  name_ar text,
  tentative boolean not null default false,
  closure boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, date, name)
);
create index on kg_holidays (tenant_id, date);

-- Payment receipt auto-numbering per tenant
create or replace function kg_assign_receipt_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.receipt_number is null then
    select 'R-' || to_char(now(),'YYYY') || '-' || lpad((count(*) + 1)::text, 5, '0')
      into new.receipt_number
      from kg_payments
      where tenant_id = new.tenant_id
        and date_trunc('year', paid_at) = date_trunc('year', now());
  end if;
  return new;
end $$;
create trigger trg_kg_payments_receipt before insert on kg_payments
  for each row execute function kg_assign_receipt_number();

-- Invoice auto-numbering per tenant
create or replace function kg_assign_invoice_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.number is null or new.number = 0 then
    select coalesce(max(number), 0) + 1 into new.number
      from kg_invoices where tenant_id = new.tenant_id;
  end if;
  return new;
end $$;
create trigger trg_kg_invoices_number before insert on kg_invoices
  for each row execute function kg_assign_invoice_number();
