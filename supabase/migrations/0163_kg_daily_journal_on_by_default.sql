-- 0163 — the Journal du jour is on by default.
--
-- 0152 shipped the switch OFF everywhere: a director had to find Paramètres ›
-- Notifications and flip it before any family heard about their child's day.
-- The owner's decision: on by default. Every establishment that never touched
-- the switch gets {enabled: true, send_at: "17:00"} now, and a new one gets it
-- at birth (BEFORE INSERT, so the row is born with the key and never sits in
-- the null state the reader must special-case). A director who turned it OFF
-- keeps it off: only rows without the key are touched.
--
-- 17:00 is a floor, not the moment: kg_send_daily_journals (0152) sends at
-- max(send_at, the structure's closing time), capped at 22:00, so a crèche
-- that closes at 18:30 sends at 18:30. kg_set_daily_journal stays the app's
-- only writer of the key; this file writes it once, in bulk.
begin;
set local lock_timeout = '5s';

update public.kg_tenants
   set settings = coalesce(settings, '{}'::jsonb)
                  || jsonb_build_object('daily_journal', jsonb_build_object('enabled', true, 'send_at', '17:00'))
 where settings -> 'daily_journal' is null;

create or replace function public.kg_tenant_default_daily_journal() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.settings -> 'daily_journal' is null then
    new.settings := coalesce(new.settings, '{}'::jsonb)
                    || jsonb_build_object('daily_journal', jsonb_build_object('enabled', true, 'send_at', '17:00'));
  end if;
  return new;
end $$;
revoke all on function public.kg_tenant_default_daily_journal() from public, anon, authenticated;
drop trigger if exists kg_tenant_default_daily_journal on public.kg_tenants;
create trigger kg_tenant_default_daily_journal before insert on public.kg_tenants
  for each row execute function public.kg_tenant_default_daily_journal();

do $$
declare n int;
begin
  select count(*) into n from public.kg_tenants where settings -> 'daily_journal' is null;
  if n <> 0 then raise exception '% tenants still without the key', n; end if;
  if exists (select 1 from public.kg_tenants where not public.kg_valid_daily_journal_settings(settings)) then
    raise exception 'a tenant settings row fails the shape check';
  end if;
  raise notice '0163 ok — % tenants carry daily_journal', (select count(*) from public.kg_tenants);
end $$;

notify pgrst, 'reload schema';
commit;
