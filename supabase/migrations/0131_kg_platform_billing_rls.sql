-- 0131 — who may see and touch the platform's own billing.
--
-- Three audiences, and the middle one is the subtle one:
--
--   platform admin  — everything, because this is their business
--   tenant admin    — their OWN subscription and invoices, read-only. They
--                     must be able to see what they owe and prove they paid,
--                     and must not be able to mark themselves paid.
--   everyone else   — the price list, and nothing else.

alter table kg_plans              enable row level security;
alter table kg_subscriptions      enable row level security;
alter table kg_platform_invoices  enable row level security;
alter table kg_platform_payments  enable row level security;

-- A signed-in owner has to read the price list to choose a plan.
drop policy if exists plan_sel on kg_plans;
drop policy if exists plan_all on kg_plans;
create policy plan_sel on kg_plans for select to authenticated using (true);
create policy plan_all on kg_plans for all using (kg_is_platform_admin())
  with check (kg_is_platform_admin());

-- kg_is_member folds in kg_tenant_active (0112), so a SUSPENDED tenant's owner
-- would be unable to read the very invoice that explains the suspension. This
-- helper deliberately does not fold it in — the one place in the product where
-- bypassing that is the correct thing to do.
create or replace function kg_owns_tenant_billing(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from kg_memberships m
     where m.tenant_id = t and m.user_id = auth.uid()
       and m.status = 'active' and m.role in ('owner', 'admin')
  )
$$;
comment on function kg_owns_tenant_billing(uuid) is
  'Membership check that deliberately does NOT fold in kg_tenant_active: a '
  'suspended crèche''s owner must still be able to read the unpaid invoice '
  'that explains the suspension, and pay it.';
revoke all on function kg_owns_tenant_billing(uuid) from public, anon;
grant execute on function kg_owns_tenant_billing(uuid) to authenticated;

drop policy if exists sub_sel on kg_subscriptions;
drop policy if exists sub_all on kg_subscriptions;
create policy sub_sel on kg_subscriptions for select
  using (kg_is_platform_admin() or kg_owns_tenant_billing(tenant_id));
create policy sub_all on kg_subscriptions for all using (kg_is_platform_admin())
  with check (kg_is_platform_admin());

drop policy if exists pinv_sel on kg_platform_invoices;
drop policy if exists pinv_all on kg_platform_invoices;
create policy pinv_sel on kg_platform_invoices for select
  using (kg_is_platform_admin() or kg_owns_tenant_billing(tenant_id));
create policy pinv_all on kg_platform_invoices for all using (kg_is_platform_admin())
  with check (kg_is_platform_admin());

-- A subscriber may SEE that their payment was recorded — that is their receipt
-- — and may never write one. Only the platform confirms money arrived.
drop policy if exists ppay_sel on kg_platform_payments;
drop policy if exists ppay_all on kg_platform_payments;
create policy ppay_sel on kg_platform_payments for select
  using (kg_is_platform_admin() or kg_owns_tenant_billing(tenant_id));
create policy ppay_all on kg_platform_payments for all using (kg_is_platform_admin())
  with check (kg_is_platform_admin());
