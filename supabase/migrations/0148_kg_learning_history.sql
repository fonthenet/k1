-- Avoid recursive assessment/result RLS while preserving a family's history
-- after a class transfer. This narrow helper returns only an ownership boolean.
create schema if not exists kg_learning_private;
revoke all on schema kg_learning_private from public, anon;
grant usage on schema kg_learning_private to authenticated;
create function kg_learning_private.owns_assessment_result(a uuid, t uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null and public.kg_is_member(t) and exists (
    select 1 from public.kg_learning_results r
    join public.kg_child_guardians cg on cg.child_id=r.child_id
    join public.kg_guardians g on g.id=cg.guardian_id
    where r.assessment_id=a and r.tenant_id=t and g.tenant_id=t and g.user_id=auth.uid()
  );
$$;
revoke all on function kg_learning_private.owns_assessment_result(uuid,uuid) from public,anon;
grant execute on function kg_learning_private.owns_assessment_result(uuid,uuid) to authenticated;
drop policy learning_assessment_read on public.kg_learning_assessments;
create policy learning_assessment_read on public.kg_learning_assessments for select to authenticated using (
  kg_can_teach(tenant_id,class_id) or (published and kg_is_member(tenant_id) and (
    exists (select 1 from kg_children c where c.class_id=kg_learning_assessments.class_id and kg_is_parent_of(c.id))
    or kg_learning_private.owns_assessment_result(id,tenant_id)
  ))
);
notify pgrst, 'reload schema';
