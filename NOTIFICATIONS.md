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
4. **Push** is sent by `dispatchPendingPush()` (`src/lib/push-server.ts`) to every
   browser in `kg_push_subscriptions` (VAPID) and every phone in `kg_push_devices`
   (Expo), then rows are stamped `pushed_at`. Both transports render the title and
   body through the same `renderNotification()` the bell uses — there is no second
   codebase to keep in step, this file is the parity. Since 0159 both pending-push
   RPCs carry `is_staff` (an active non-parent membership of the row's tenant) and the
   dispatcher decides the URL from it, not from the payload's `audience`: an educator
   who is also a parent gets `/calendar` for a closure and `/portal/calendar` for her
   own child's appointment.

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

### The calendar (0159)

The calendar's rows say **what happened, from the person who did it**. Every
payload of these types carries a `kind`, and the renderer picks
`types.<type>.kinds.<kind>` for the title and `types.<type>.bodies.<kind>` for the
body where a kind needs its own sentence, falling back to the type's plain
`title`/`body` (so a bundle that predates a kind still says something true). A
row that spans days (`endDate` ≠ `date`) reads `bodies.range`; a one-day row
reads `bodies.single` where the type has one.

| Event | Type · kinds | Recipients | Notes |
|---|---|---|---|
| Event created / changed / removed / cancelled / reminded | `event` · `created` `changed` `removed` `cancelled` `reminder` | the audience's families and staff (`kg_event_recipients`) | `removed` = the event's scope moved away from a family ("Ne vous concerne plus"); re-added → `created` again; `cancelled` reaches everyone whose LATEST row is not `removed` (`kg_event_told`); a title / time / all-day / room edit is `changed` and a restore from cancelled is `changed` to the current audience; a description-only edit is silent; a room-only edit > 7 days out is bell-only; `created`/`cancelled` > 30 days out are bell-only. Payload: `eventId kind classId className classNameAr structureId structureName structureNameAr roomName roomNameAr date time endTime allDay description audience` |
| Closure created / confirmed / reminded | `closure` · `created` `confirmed` `reminder` | the structure's families (all, for the building) + staff (`kg_closure_recipients`) | confirmed rows only — a tentative Aïd is silent until the decree; `confirmed` also fires when a confirmed closure's dates or scope move (école → building tells the new families); `kind = 'public'` rows are not news on creation; once per person per holiday per kind (per date for `confirmed`). Payload: `holidayId kind date endDate name nameAr structureId structureName structureNameAr tentative holidayKind audience` |
| Therapy appointment set / moved / changed / cancelled / reminded | `session_scheduled` · `created` `rescheduled` `changed` `cancelled` `reminder` | the child's guardians | future rows only; un-cancel = `rescheduled`; therapist / room / duration = `changed`; a hard delete of a future row = `cancelled`; the note and the outcome are silent (the summary is `session_published`). The reminder's 36-hour suppression reads `scheduled_changed_at` (0157), never `updated_at`. Payload: `sessionId kind childId childName childNameAr date time endTime sessionType therapist audience` |
| Test or exam date set / moved | `assessment_scheduled` · `created` `changed` | the class's families | `test`/`exam` only, never an observation; per date dedupe. Payload: `assessmentId kind assessmentKind classId className classNameAr date audience` |
| Leave request decided | `leave` · `approved` `rejected` | the member | Payload: `leaveId kind leaveType date endDate audience` |

**The actor rule.** The actor of a row is whoever is doing the write —
`auth.uid()`, or `cancelled_by` for a cancellation — never the event's author
by assumption; the author only stands in when nobody is signed in (a cron, the
SQL editor). A **reminder has no actor**, so its recipients include the author
when still an active member: the director who created the parents' meeting
reads "Demain : Réunion des parents" like everyone else.

**Times in payloads** are timestamptz values in jsonb (`to_jsonb(ts)`, the
0097 ISO-8601-with-offset shape), never `::text`; `time`/`endTime` are `''`
for an all-day row and the renderer collapses the empty segment. The renderer
repairs the older text form (`2026-09-22 16:00:00+00`) before parsing, so a row
an old trigger wrote still renders on Safari.

**Where they land** (`notificationHref`): `event` → staff
`/calendar?view=day&date=<date>&event=<eventId>`, family
`/portal/calendar?date=<date>&event=<eventId>` (the day view opens and says
"gone" if the event was deleted — no detail route to 404 on); `closure` → the
calendar on that date; `session_scheduled` → family `/portal/calendar?date=`,
staff `/sessions/<id>`; `assessment_scheduled` → family `/portal/calendar?date=`,
staff `/learning/assessments/<id>`; `leave` → `/staff/leaves`.

**Bidi.** The row's own name (an event title, a holiday, a member) is dropped
into a sentence in the reader's language, so `renderNotification` wraps it in
FSI…PDI (U+2068/U+2069) — the plain-text equivalent of `<bdi dir="auto">` — and
a French title survives an Arabic push banner intact.

**Cron jobs** (Africa/Algiers): `kg-event-reminders` and `kg-session-reminders`
at 06:30 (`kg_remind_tomorrows_events()`, `kg_remind_tomorrows_sessions()` — two
jobs, so a failure in one never costs the other), `kg-closure-reminders` at 16:00
(`kg_remind_tomorrows_closures()`, heard before pick-up: the afternoon before the
first day the structure would otherwise have opened). Every reminder row is
wrapped: one bad row never silences a day's reminders for every tenant.

### The dossier d'inscription (0164)

Two types, fired by `kg_on_child_document_change` on `kg_child_documents`
(AFTER INSERT; AFTER UPDATE OF status) and wrapped so a notification never
aborts the write. Six pushes for one file is noise, so there is **no push per
accepted paper**, no reminder, no expiry cron: the office hears that a paper
arrived, the family hears that a paper was refused (with the reason) or that
the file is complete.

| Event | Type · kinds | Recipients | Notes |
|---|---|---|---|
| A family sent a paper | `document_received` | owner + admin + educator of the tenant (`kg_staff_user_ids`) | INSERT with `source = 'family'` only — a staff scan (`source = 'staff'`, born `accepted`, D15) tells the office nothing. Actor = `uploaded_by`. `title` = the requirement's French name, `body` = null. |
| A paper was refused | `document_reviewed` · `rejected` | the child's guardians (`kg_parent_user_ids`) or, before approval, the applicant (`kg_applications.applicant_user_id`) | Always; the review note travels in `body` — the one place the family learns why. `kg_review_document` refuses a rejection without a note (23514). |
| The last required paper was accepted | `document_reviewed` · `complete` | same | Fired from a REQUIRED, ACTIVE line only (an optional paper accepted afterwards does not repeat it), whether the paper was accepted by review (UPDATE) or handed in at the desk and scanned by staff (INSERT accepted). `kg_dossier_status(...).complete` decides. |

Payload: `childId applicationId documentId requirementKey name nameAr childName
childNameAr audience` (+ `kind` for `document_reviewed`). `name`/`nameAr` are
the requirement's two names (or the row's title for an "Autre pièce"); the
renderer picks `nameAr` for an Arabic reader exactly as it does for a
closure, and isolates it (FSI…PDI) inside the sentence. Templates:
`types.document_received.{title,body}`,
`types.document_reviewed.{title,body,kinds.rejected,kinds.complete,bodies.rejected,bodies.complete}`
— `bodies.rejected` is `{name} · {text}` where `{text}` is the row's body (the
note); `bodies.complete` is one sentence with no placeholder.

**Where they land** (`notificationHref`): staff → `/applications/<applicationId>`
while the file is pending, else `/children/<childId>?tab=documents`; family →
`/portal/children/<childId>?tab=permissions` once the child exists (the tab is
labelled "Dossier"), else `/enroll/dossier/<applicationId>` — the tenant-less
page a first-time applicant can open before having a membership; a
`document_received` read as a parent lands on `/portal`. A row bound to the
child at approval keeps `applicationId` as provenance and the child wins.

Icon and tone for the two types in `src/components/modules/notifications/meta.tsx`
are not part of this package (they fall through to the generic icon until the
owner of that file adds them).

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
   a lookup map beside `consentTypes` for any enum the payload carries. A type whose
   payload carries `kind` adds `kinds.<kind>` titles (and `bodies.<kind>` where a kind
   needs its own sentence; `bodies.range`/`bodies.single` for a row that may span days).
4. Any new `{placeholder}` must also be added to the `vars` map in
   `renderNotification` — interpolation runs against a fixed map, so an unknown key
   renders as empty string, silently.
5. Icon + tone in `src/components/modules/notifications/meta.tsx` (the four calendar
   types of 0159 — `closure`, `session_scheduled`, `assessment_scheduled`, `leave` —
   still fall through to the generic icon there).
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
users' rows through narrow `security definer` RPCs (`0013`, `0075`; the two
pending-push readers recreated by `0159` with `is_staff`, executable by `anon`)
gated on that shared secret, so its blast radius is exactly "send pending pushes".

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
