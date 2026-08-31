# Notifications & web push

## How it works

1. **The database decides who is notified.** Triggers in `0012_kg_notifications.sql`
   and `0049_kg_parent_notifications.sql` insert `kg_notifications` rows. Fan-out lives in the DB, not in server actions,
   because several real events never pass through an action — a kiosk check-in is
   written by `kg_checkin_by_tag`, not a form post.
2. **Rows are language-neutral.** Each row stores a structured `type` + `data`
   payload. The reader (UI) and the push dispatcher render it per the recipient's
   own locale via `renderNotification()` in `src/lib/notifications.ts`. `title`/`body`
   on the row are only a fallback for a `type` a given build predates.
3. **In-app delivery is realtime.** `kg_notifications` is in the `supabase_realtime`
   publication (`0014`); RLS (`n_sel: user_id = auth.uid()`) means a subscriber
   receives only their own rows.
4. **Web push** is sent by `dispatchPendingPush()` (`src/lib/push-server.ts`) to every
   device in `kg_push_subscriptions`, then rows are stamped `pushed_at`.

## Who gets notified about what

| Event | Recipients |
|---|---|
| Thread message | the other side (staff reply → family; parent message → owner/admin/educator) |
| Incident reported | the child's guardians |
| Announcement published | its audience (all / parents / staff / one class) |
| Enrolment application | owner + admin |
| Check-in / check-out | the child's guardians |
| Daily report published | the child's guardians |
| Task assigned | the assignee |
| Activity request | owner + admin |

### The family's side (0049)

Until 0049 every safety notification ran one way only. `kg_notify_parent_edit`
(0016) opens with `if not kg_actor_is_parent(p_tenant) then return; end if;`, so a
parent editing an allergy told the office, and the office editing the same allergy
told nobody. These close that, plus the money and attendance events a family
cannot discover by turning up tomorrow.

All of them fan out through `kg_notify_family()`, which resolves the child once,
adds `childId` / `childName` / `audience:'parent'`, and passes `auth.uid()` so
`kg_notify`'s actor-skip drops whoever made the change. **Recipients are
`kg_parent_user_ids` only** — no money notification ever reaches an educator.

| Event | Type | Notes |
|---|---|---|
| Authorised pickup added / edited / removed | `pickup_changed` | the décret 19-253 register |
| Guardian linked / unlinked, pickup granted / revoked | `guardian_access_changed` | unlink also notifies the person who lost access, directly — by then they are out of `kg_parent_user_ids` |
| Allergy added / edited / removed | `allergy_changed` | audited even when nobody in the family has an account |
| Health record edited | `health_changed` | payload carries field *names*, never a rendered list |
| Consent changed **or deleted** | `consent_changed` | 0045 covered the flip, not the erase |
| Incident edited after reporting | `incident_updated` | also clears `parent_ack_at` — the family acknowledged different text |
| Enrolment status changed | `enrollment_changed` | withdrawal kills the badge at the door |
| Invoice issued (draft → issued) | `invoice_issued` | fires at the edge, not on INSERT: 0047 generates drafts |
| Payment recorded | `payment_recorded` | the receipt is the family's only proof in a cash economy |
| Payment amended / deleted | `payment_reversed` | a restored balance they believed settled |
| Fee plan assigned / changed / ended | `fee_changed` | needs the fee section on `/portal/payments` |
| Marked absent / sick / excused / late | `attendance_flagged` | timestamped by `date`, never `created_at` |
| Activity request answered, or staff enrolment | `activity_decision` | closes the one request/response loop the product opens |
| Session published with a `parent_summary` | `session_published` | the summary is written for the family |

### Fixes to types that already shipped (0049)

- **Thread reply with no child attached reached nobody** — the recipient list was
  only built inside `if child_id is not null`. It now falls back to everyone who
  has posted in the thread, minus staff.
- **Scheduled announcements never emitted at all** — the AFTER INSERT trigger
  returns early when `publish_at` is in the future and nothing re-ran. Swept every
  15 minutes by `kg_publish_due_announcements()`, deduped on the notification rows
  themselves (no flag column, no backfill). The audience rules moved into
  `kg_announcement_recipients()` so the sweep and the trigger cannot drift.
- **Attendance corrections re-pushed as fresh arrivals** — a corrected time now
  carries `corrected: true`.
- **A parent's own application landed on `/applications`**, which is staff-only.
- **`?tab=` on every parent href** — a permission change lands on the permissions
  tab, not the journal.

### Adding a type

1. Trigger in a migration; payload is structured data, **never a sentence**. An
   enum written in one language freezes it into every family's history.
2. Add the type to `NOTIFICATION_TYPES` and give it an href in `notificationHref`
   (`src/lib/notifications.ts`).
3. Add `types.<name>.{title,body}` to `messages/{ar,en,fr}/notifications.json`, and
   a lookup map beside `consentTypes` for any enum the payload carries.
4. Any new `{placeholder}` must also be added to the `vars` map in
   `renderNotification` — interpolation runs against a fixed map, so an unknown key
   renders as empty string, silently.
5. Icon + tone in `src/components/modules/notifications/meta.tsx`.
6. **Check the landing page exists.** A push saying "your child moved class" that
   lands on an unchanged page is worse than silence.

The actor never gets notified about their own action (`kg_notify` filters them out).

## Secrets

`.env.local` (gitignored) holds:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — safe in the browser
- `VAPID_PRIVATE_KEY` — **server only**, never import `push-server.ts` from a client component
- `PUSH_DISPATCH_SECRET` — must equal `kg_push_config.secret` in the database
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY` — Maps **Embed** API only (free, no per-load
  charge). Public by nature; restrict it by HTTP referrer in Google Cloud. Absent,
  every map falls back to OpenStreetMap.

The dispatcher deliberately does **not** use a service-role key. It reaches other
users' rows through three narrow `security definer` RPCs (`0013`) gated on that
shared secret, so its blast radius is exactly "send pending pushes".

Rotating the secret means updating both sides:

```sql
update kg_push_config set secret = '<new>', updated_at = now();
```

## Production: schedule the dispatcher

Server actions call `flushPush()` immediately after a write, so alerts are instant
for anything a user triggers in the app. A scheduler is still wanted as a safety
net (a failed send, a device offline at the moment of the write).

Once deployed, from the Supabase SQL editor:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('rawdatik-push', '* * * * *', $$
  select net.http_post(
    url := 'https://<your-domain>/api/push/dispatch',
    headers := jsonb_build_object('x-push-secret', '<PUSH_DISPATCH_SECRET>')
  );
$$);
```

This cannot be set up against `localhost` — Supabase cannot reach a dev machine.

## Platform caveats

- **Android / Chrome / Firefox / desktop**: web push works once the user grants permission.
- **iOS Safari**: push requires the site be installed to the Home Screen (iOS 16.4+).
  `PushToggle` treats a browser without `PushManager` as unsupported rather than
  showing a button that cannot work.
- A permission the user has **denied** cannot be re-prompted from JS — the UI says so
  and points at browser site settings.
