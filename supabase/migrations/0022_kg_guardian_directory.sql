-- A safe way for one family member to see another's name.
--
-- Policy g_sel on kg_guardians is `kg_is_staff(tenant_id) or user_id = auth.uid()`,
-- so a parent reads only their OWN guardian row. That is correct for the table —
-- it also holds pin_code and tag_code, the door credentials — but it means the
-- attendance view cannot say "dropped off by {co-parent}" and falls back to
-- "recorded by {staff}" whenever the other parent or a grandparent did the run.
--
-- Widening the table policy would hand credentials to every co-guardian. Expose
-- a column-limited view instead: identity fields only, never a credential.
--
-- security_invoker = false: the view runs as its owner and so bypasses the base
-- table's RLS; the WHERE clause below IS the access rule and must stay complete.
create or replace view kg_guardian_directory
with (security_invoker = false) as
select
  g.id, g.tenant_id,
  g.first_name, g.last_name, g.first_name_ar, g.last_name_ar,
  g.relationship, g.photo_path
from kg_guardians g
where
  -- staff see their tenant's guardians
  kg_is_staff(g.tenant_id)
  -- a family sees the other adults attached to their own child
  or exists (
    select 1 from kg_child_guardians cg
    where cg.guardian_id = g.id and kg_is_parent_of(cg.child_id)
  );

comment on view kg_guardian_directory is
  'Identity-only projection of kg_guardians (no pin_code/tag_code). Readable by tenant staff and by co-guardians of the same child. Use this — never the base table — when showing one family member''s name to another.';

grant select on kg_guardian_directory to authenticated;
