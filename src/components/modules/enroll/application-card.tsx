// One family on the admissions board. Server-rendered; only the stage menu and
// the waitlist arrows are client components.

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarClock, CalendarDays, Phone, Sparkles, Users } from "lucide-react";
import { ageFromDob, childDisplayName, formatDate, formatPhone, formatTime, initials, telHref } from "@/lib/format";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StageMenu } from "./stage-menu";
import { WaitlistControls } from "./waitlist-controls";
import { applicantPhone, type ApplicationRecord } from "./types";

/** `kg_applications.source` written by kg_submit_sibling_application (migration
 *  0017): an existing parent enrolling another child. Ordinary pipeline row —
 *  only the badge and the family context on the detail page set it apart. */
export const SIBLING_SOURCE = "sibling";

/** Gold chip marking an application that comes from a family already here. */
export async function SiblingBadge() {
  const t = await getTranslations("enroll");
  return (
    <Badge className="border-transparent bg-gold-muted font-medium text-gold-ink">
      <Users data-icon="inline-start" />
      {t("sibling.badge")}
    </Badge>
  );
}

export async function ApplicationCard({
  app,
  canManage,
  waitlist,
}: {
  app: ApplicationRecord;
  canManage: boolean;
  /** Present in the waitlist lane: rank plus the reorder arrows. */
  waitlist?: { position: number; isFirst: boolean; isLast: boolean };
}) {
  const t = await getTranslations("enroll");
  const locale = await getLocale();

  const child = app.child;
  const phone = applicantPhone(app);
  const activityCount = Array.isArray(app.activity_ids) ? app.activity_ids.length : 0;
  const displayName = childDisplayName(
    {
      first_name: child.first_name ?? "",
      last_name: child.last_name ?? "",
      first_name_ar: child.first_name_ar,
      last_name_ar: child.last_name_ar,
    },
    locale
  );
  const isSibling = app.source === SIBLING_SOURCE;
  const sourceKey = app.source ? `source.${app.source}` : null;
  const sourceLabel = sourceKey ? (t.has(sourceKey) ? t(sourceKey) : app.source) : null;
  const hasInterviewSlot = app.status === "interview" && Boolean(app.interview_at);
  const hasChips = hasInterviewSlot || isSibling || Boolean(sourceLabel) || activityCount > 0;

  return (
    <Card size="sm" className="transition-shadow hover:shadow-md">
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2.5">
          {waitlist ? (
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-sm font-bold tabular-nums text-secondary-foreground">
              {waitlist.position}
            </span>
          ) : (
            <Avatar className="size-10 shrink-0">
              <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                {initials(child.first_name ?? "", child.last_name ?? "")}
              </AvatarFallback>
            </Avatar>
          )}

          <div className="min-w-0 flex-1">
            <Link
              href={`/applications/${app.id}`}
              className="block truncate text-sm font-semibold text-foreground underline-offset-4 hover:underline"
            >
              {displayName}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {child.dob ? ageFromDob(child.dob, locale) : "—"}
            </p>
          </div>

          {waitlist && canManage && (
            <WaitlistControls
              appId={app.id}
              isFirst={waitlist.isFirst}
              isLast={waitlist.isLast}
            />
          )}
          {canManage && (
            <StageMenu
              appId={app.id}
              status={app.status}
              interviewAt={app.interview_at}
              variant="ghost"
              showLabel={false}
            />
          )}
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          {phone && (
            <a
              href={telHref(phone)}
              className="flex items-center gap-1.5 hover:text-foreground"
            >
              <Phone className="size-3.5 shrink-0" />
              <span dir="ltr" className="truncate">
                {formatPhone(phone)}
              </span>
            </a>
          )}
          <p className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5 shrink-0" />
            <span className="truncate">
              {t("admin.submittedOn", { date: formatDate(app.created_at, locale) })}
            </span>
          </p>
        </div>

        {app.status === "rejected" && app.review_note && (
          <p className="line-clamp-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
            {app.review_note}
          </p>
        )}

        {hasChips && (
          <div className="flex flex-wrap items-center gap-1.5">
            {isSibling && <SiblingBadge />}
            {hasInterviewSlot && app.interview_at && (
              <Badge className="border-transparent bg-secondary font-medium text-secondary-foreground">
                <CalendarClock data-icon="inline-start" />
                {formatDate(app.interview_at, locale, { day: "numeric", month: "short" })} ·{" "}
                {formatTime(app.interview_at, locale)}
              </Badge>
            )}
            {!isSibling && sourceLabel && <Badge variant="outline">{sourceLabel}</Badge>}
            {activityCount > 0 && (
              <Badge variant="secondary">
                <Sparkles data-icon="inline-start" />
                {t("admin.activitiesCount", { count: activityCount })}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
