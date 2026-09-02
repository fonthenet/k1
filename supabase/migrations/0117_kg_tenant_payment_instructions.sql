-- 0117 — the parent portal tells every family to pay in cash, whatever the crèche does.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- /portal/payments ends with a "how to pay" card, and its text is a message
-- key: "Payments are made in cash at the kindergarten office, and you receive
-- a numbered receipt on the spot." It is the same sentence for every tenant,
-- because kg_tenants has nowhere to keep anything else.
--
-- That sentence is true of the first client today and false of the next one
-- that takes a CCP or a bank transfer — and a CCP number, a RIP or the name
-- of the account holder is exactly the kind of thing a parent needs to read
-- off their phone at the post office. Without a column it can only reach
-- them as a message thread, once, from the office, per family.
--
-- The same card also has to survive Arabic: a CCP is a run of digit groups
-- ("0020 0034 5678 90 clé 45"), and a run of digit groups inside a
-- right-to-left paragraph is reordered by the bidi algorithm. The portal
-- therefore renders these lines LTR line by line; the column stores plain
-- text and leaves the layout to the reader.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- One optional text column. NULL means "say nothing beyond the default" — the
-- portal keeps its cash sentence for a tenant that has not written anything,
-- so nothing changes for the first client until the director types.
--
-- No trigger, no notification: this is settings copy, not a change to any
-- family's file. Length is capped so a pasted contract cannot become the
-- payments page.

begin;

alter table kg_tenants
  add column if not exists payment_instructions text;

alter table kg_tenants drop constraint if exists kg_tenants_payment_instructions_len;
alter table kg_tenants add constraint kg_tenants_payment_instructions_len
  check (payment_instructions is null or char_length(payment_instructions) <= 1000);

comment on column kg_tenants.payment_instructions is
  'Free text shown to families on /portal/payments under "how to pay": CCP, '
  'RIP, account holder, opening hours of the cash desk. NULL keeps the '
  'portal''s default cash-at-the-office sentence. Rendered line by line with '
  'digit-only lines forced LTR so a CCP survives an Arabic page.';

commit;
