-- 0048 — The scheduler.
--
-- Until now the monthly invoice run and the overdue sweep only happened when a
-- human remembered. A director who forgets on the 1st of October means October
-- has no invoices at all: nobody is billed, and the arrears alert stays quiet
-- because nothing is overdue yet. The first sign is the month's income being
-- wrong.
--
-- Algeria is UTC+1 year-round with no daylight saving, so a UTC cron expression
-- maps to a fixed local time. 05:00 UTC = 06:00 Africa/Algiers, before anyone
-- opens the doors.

create extension if not exists pg_cron with schema extensions;

-- Monthly DRAFTS on the 1st. Drafts, not issued documents — a human still
-- performs the issue step, because what gets issued is a legal facture (0047).
select cron.unschedule('kg-monthly-invoice-drafts')
 where exists (select 1 from cron.job where jobname = 'kg-monthly-invoice-drafts');
select cron.schedule(
  'kg-monthly-invoice-drafts', '0 5 1 * *',
  $$select kg_generate_all_tenants()$$);

-- Overdue statuses + the finance digest, daily. kg_refresh_overdue_invoices
-- already dedupes to one alert per tenant per Algiers day (0029), so a retry or
-- an overlapping manual run cannot spam anyone.
select cron.unschedule('kg-refresh-overdue')
 where exists (select 1 from cron.job where jobname = 'kg-refresh-overdue');
select cron.schedule(
  'kg-refresh-overdue', '30 5 * * *',
  $$select kg_refresh_overdue_invoices()$$);

-- NOT scheduled here: push dispatch. It has to POST to the app's /api/push
-- endpoint, which needs pg_net and a deployed domain — pg_cron cannot reach
-- localhost. Add it once there is a URL. Until then pushes still go out, just
-- only when a server action flushes the queue.
