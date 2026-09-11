-- Apply before enabling private-school creation. Existing tenants are unchanged.
alter type public.kg_center_type add value if not exists 'private_primary';
alter type public.kg_center_type add value if not exists 'private_middle';
alter type public.kg_center_type add value if not exists 'private_secondary';

-- Deployment capability discovery; no tenant data or elevated privileges.
create or replace function public.kg_available_center_types()
returns text[]
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select enum_range(null::public.kg_center_type)::text[];
$$;

revoke all on function public.kg_available_center_types() from public, anon;
grant execute on function public.kg_available_center_types() to authenticated;

notify pgrst, 'reload schema';
