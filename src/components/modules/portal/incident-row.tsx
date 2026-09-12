import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { PortalChildLink } from "@/components/shared/entity-link";
import { StatusPill } from "@/components/shared/status-pill";
import { formatDate, formatTime } from "@/lib/format";
import type { Locale } from "@/i18n/locales";
import { AckIncidentButton } from "@/components/modules/portal/ack-incident-button";

/**
 * One incident as the family reads it — on the home's "to acknowledge" list
 * and on the child's day page — so the two surfaces cannot drift.
 *
 * A server component (the translations and the clock are resolved here) that
 * wraps the one client control on the row. The severity pill is drawn only
 * when the incident is serious: a scraped knee needs no red, and the pill is
 * the row's single mark. Once acknowledged, the button gives way to one muted
 * line saying when — a receipt, never a second control.
 *
 * `childName` / `childId` name the child when the list mixes siblings (the
 * home); the day page is already about one child and passes neither.
 * `showDate` is false on the day page, where the date is the page's title.
 */
export function IncidentRow({
  incident,
  childName,
  childId,
  locale,
  showDate = true,
}: {
  incident: {
    id: string;
    occurred_at: string;
    severity: string;
    description: string;
    action_taken: string | null;
    parent_ack_at: string | null;
  };
  childName?: string;
  childId?: string;
  locale: Locale;
  showDate?: boolean;
}) {
  const t = useTranslations("portal");
  const time = formatTime(incident.occurred_at, locale);
  // The clock sits at the end of the first line only when something opens
  // it — the child's name or the severity pill. With neither, a lone time at
  // the far end over a start-aligned description was the first of five
  // alignments in one card; it opens the row instead.
  const hasLead = Boolean(childName && childId) || incident.severity === "serious";
  return (
    <li className="grid gap-1 px-5 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {childName && childId && (
          <PortalChildLink id={childId}>
            <bdi dir="auto">{childName}</bdi>
          </PortalChildLink>
        )}
        {incident.severity === "serious" && (
          <StatusPill tone="danger">{t("home.incidents.severity.serious")}</StatusPill>
        )}
        <span className={cn("text-xs text-muted-foreground tabular-nums", hasLead && "ms-auto")}>
          {showDate ? `${formatDate(incident.occurred_at, locale)} · ${time}` : time}
        </span>
      </div>
      {/* Both texts are the educator's own words, isolated (bdi) so an
          Arabic note in a French page keeps its own reading order, but
          aligned with the page: every line of the row starts at the same
          edge, the label of the action included, never inside a translated
          sentence where the colon would scramble. */}
      <p className="text-start text-sm leading-relaxed">
        <bdi dir="auto">{incident.description}</bdi>
      </p>
      {incident.action_taken && (
        <p className="text-start text-sm leading-relaxed">
          <span className="block text-xs text-muted-foreground">{t("home.incidents.actionTaken")}</span>
          <bdi dir="auto">{incident.action_taken}</bdi>
        </p>
      )}
      {incident.parent_ack_at ? (
        <p className="text-xs text-muted-foreground">
          {t.rich("day.ackedAt", {
            date: formatDate(incident.parent_ack_at, locale),
            time: formatTime(incident.parent_ack_at, locale),
            ltr: (chunks) => <span dir="ltr" className="tabular-nums">{chunks}</span>,
          })}
        </p>
      ) : (
        <div className="relative z-10 -me-3 flex justify-end">
          <AckIncidentButton incidentId={incident.id} />
        </div>
      )}
    </li>
  );
}
