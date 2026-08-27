-- 0036 — A derived ledger row cannot be hand-edited or hand-deleted.
--
-- The journal hides the edit/delete buttons on rows written by a trigger, but
-- policy tx_all still allowed any finance user to change them through the API.
-- These rows are copies: the source of truth is the payment, the advance or the
-- payslip. Editing the copy makes the two disagree; deleting it hides cash that
-- really moved. Both are now refused.
--
-- The FK cascades (0032) still remove these rows when their source is deleted —
-- referential actions run as the table owner and are not subject to RLS.

drop policy if exists tx_all on kg_transactions;

create policy tx_sel on kg_transactions for select
  using (kg_is_finance(tenant_id));

create policy tx_ins on kg_transactions for insert
  with check (kg_is_finance(tenant_id));

create policy tx_upd on kg_transactions for update
  using (kg_is_finance(tenant_id) and related_payment_id is null
         and related_advance_id is null and related_payroll_item_id is null)
  with check (kg_is_finance(tenant_id) and related_payment_id is null
         and related_advance_id is null and related_payroll_item_id is null);

create policy tx_del on kg_transactions for delete
  using (kg_is_finance(tenant_id) and related_payment_id is null
         and related_advance_id is null and related_payroll_item_id is null);
