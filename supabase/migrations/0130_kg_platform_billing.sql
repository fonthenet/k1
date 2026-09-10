-- 0130 — the platform bills its own subscribers.
--
-- Every crèche on Rawdatik is a paying customer and nothing in the product
-- knew it: a tenant was created and simply existed, for free, forever. The
-- prices were already public — Essentiel 4 900, Pro 9 900, Réseau 19 900 DA a
-- month, flat per structure — but they lived in a TypeScript array on the
-- landing page, so nothing could invoice against them.
--
-- WHY INVOICES AND MANUAL PAYMENTS RATHER THAN A CARD GATEWAY. There is no
-- Stripe in Algeria. Online card payment goes through SATIM (CIB / Edahabia)
-- and needs a merchant contract; B2B software here is paid in cash, by
-- virement bancaire, or by CCP. This product already tells parents there is no
-- online payment and prints them a numbered receipt instead — the platform
-- billing its own subscribers works the same way, which is also the shape a
-- gateway would slot into later as one more `method` on a payment row.
--
-- The pieces are deliberately the same shape as the crèche's own billing
-- (kg_invoices / kg_payments): it is the same problem one level up, and the
-- staff who read one will read the other.

create type kg_subscription_status as enum
  ('trialing', 'active', 'past_due', 'suspended', 'cancelled');
create type kg_platform_invoice_status as enum ('unpaid', 'paid', 'void');
create type kg_platform_payment_method as enum
  ('transfer', 'ccp', 'cash', 'card', 'other');

create table if not exists kg_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  name_ar text,
  -- Flat per structure, per month. The landing page promises "ni par enfant ni
  -- par employé", so there is deliberately no seat count here.
  price_monthly numeric(12,2) not null check (price_monthly >= 0),
  currency text not null default 'DZD',
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kg_subscriptions (
  id uuid primary key default gen_random_uuid(),
  -- One subscription per establishment. A network running several buys several.
  tenant_id uuid not null unique references kg_tenants(id) on delete cascade,
  plan_id uuid references kg_plans(id) on delete restrict,
  status kg_subscription_status not null default 'trialing',
  trial_ends_at date,
  current_period_start date,
  current_period_end date,
  cancel_at date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kg_subscriptions_status_idx on kg_subscriptions (status);

create table if not exists kg_platform_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  subscription_id uuid references kg_subscriptions(id) on delete set null,
  -- ONE series for the whole platform, unlike kg_invoices which restarts per
  -- crèche: these are the platform's own outgoing invoices and an accountant
  -- needs them to run unbroken.
  number int unique,
  period_start date not null,
  period_end date not null,
  -- How many structures this month was billed for, FROZEN at issue: a director
  -- who opens a third structure in March must not find February's invoice has
  -- quietly become three structures' worth.
  quantity int not null default 1 check (quantity > 0),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'DZD',
  status kg_platform_invoice_status not null default 'unpaid',
  issue_date date not null default current_date,
  due_date date not null,
  paid_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kg_platform_invoices_tenant_idx on kg_platform_invoices (tenant_id, period_start desc);
create index if not exists kg_platform_invoices_status_idx on kg_platform_invoices (status);
-- A subscriber cannot be billed twice for the same month.
create unique index if not exists kg_platform_invoices_period_unique
  on kg_platform_invoices (tenant_id, period_start);

create table if not exists kg_platform_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references kg_platform_invoices(id) on delete cascade,
  tenant_id uuid not null references kg_tenants(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  -- Cash first: it is how Algeria pays.
  method kg_platform_payment_method not null default 'cash',
  -- The transfer or CCP slip number. The only trace linking a bank line to an
  -- invoice when nobody remembers the conversation.
  reference text,
  received_at date not null default current_date,
  recorded_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists kg_platform_payments_invoice_idx on kg_platform_payments (invoice_id);

do $$ declare t text;
begin
  foreach t in array array['kg_plans','kg_subscriptions','kg_platform_invoices'] loop
    execute format(
      'drop trigger if exists trg_%1$s_touch on %1$I; '
      'create trigger trg_%1$s_touch before update on %1$I '
      'for each row execute function kg_touch_updated_at()', t);
  end loop;
end $$;

create or replace function kg_platform_invoice_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.number is null then
    select coalesce(max(number), 0) + 1 into new.number from kg_platform_invoices;
  end if;
  return new;
end $$;

drop trigger if exists trg_kg_platform_invoice_number on kg_platform_invoices;
create trigger trg_kg_platform_invoice_number before insert on kg_platform_invoices
  for each row execute function kg_platform_invoice_number();

-- Settled is DERIVED from the payments, never set by hand, so a half payment
-- cannot be filed as paid and the two can never disagree.
create or replace function kg_platform_invoice_settle()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_inv uuid; v_total numeric; v_due numeric;
begin
  v_inv := coalesce(new.invoice_id, old.invoice_id);
  select coalesce(sum(amount), 0) into v_total from kg_platform_payments where invoice_id = v_inv;
  select amount into v_due from kg_platform_invoices where id = v_inv;
  update kg_platform_invoices
     set status  = case when v_total >= v_due then 'paid'::kg_platform_invoice_status
                        else 'unpaid'::kg_platform_invoice_status end,
         paid_at = case when v_total >= v_due then now() else null end
   where id = v_inv and status <> 'void';
  return null;
end $$;

drop trigger if exists trg_kg_platform_payment_settle on kg_platform_payments;
create trigger trg_kg_platform_payment_settle
  after insert or update or delete on kg_platform_payments
  for each row execute function kg_platform_invoice_settle();

revoke all on function kg_platform_invoice_number() from public, anon, authenticated;
revoke all on function kg_platform_invoice_settle() from public, anon, authenticated;

insert into kg_plans (code, name, name_ar, price_monthly, sort_order) values
  ('essential', 'Essentiel', 'الأساسي',  4900, 0),
  ('pro',       'Pro',       'المتقدّم',  9900, 1),
  ('network',   'Réseau',    'الشبكة',   19900, 2)
on conflict (code) do nothing;
