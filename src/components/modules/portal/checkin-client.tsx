"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Baby, CircleCheck, Sun, TriangleAlert } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { attendanceChipClasses } from "./portal-types";
import { CheckinQrCard } from "./checkin-qr-card";
import { useScreenWakeLock } from "./use-screen-wake-lock";

export type CheckinStatusKind = "notYet" | "arrived" | "left" | "absent";

export interface CheckinChildRow {
  id: string;
  name: string;
  secondaryName: string | null;
  initials: string;
  photoUrl: string | null;
  className: string | null;
  classColor: string | null;
  allergies: string[];
  status: {
    kind: CheckinStatusKind;
    /** Already formatted server-side, so the server and client agree. */
    time: string | null;
    reason: string | null;
    /** Who collected the child — only ever set on "left". */
    collectedBy?: string | null;
  };
}

/**
 * The doorway screen: the parent's QR on top, their children underneath.
 *
 * Selecting a child writes NOTHING. Attendance is written by the kiosk after a
 * staff member has compared the guardian's photo with the child's — that human
 * comparison is the second factor, and a phone screen can be photographed by
 * anyone, so this screen must never be able to shortcut it. The selection here
 * is a cue for the conversation at the door, nothing more.
 */
export function CheckinClient({
  tagCode,
  guardianName,
  childRows,
  statusFailed,
}: {
  tagCode: string;
  guardianName: string;
  childRows: CheckinChildRow[];
  statusFailed: boolean;
}) {
  const t = useTranslations("portal.checkin");
  const tHome = useTranslations("portal.home");
  const [selectedId, setSelectedId] = useState<string | null>(
    childRows.length === 1 ? childRows[0].id : null
  );

  // This whole page is the badge, so the lock is held for as long as it is
  // open. Same helper the quick dialog uses — see `use-screen-wake-lock.ts`
  // for why every failure there is swallowed.
  useScreenWakeLock();

  const statusLabel = (status: CheckinChildRow["status"]): string => {
    switch (status.kind) {
      case "arrived":
        return tHome("status.arrived", { time: status.time ?? "" });
      case "left":
        return status.collectedBy
          ? tHome("status.leftWith", { time: status.time ?? "", name: status.collectedBy })
          : tHome("status.left", { time: status.time ?? "" });
      case "absent":
        return status.reason
          ? tHome("status.absentReason", { reason: status.reason })
          : tHome("status.absent");
      default:
        return tHome("status.notYet");
    }
  };

  const selected = childRows.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="grid gap-5">
      <header className="grid gap-1.5">
        <h1 className="text-xl font-bold leading-tight tracking-tight">{t("title")}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("subtitle")}</p>
      </header>

      <CheckinQrCard tagCode={tagCode} guardianName={guardianName} />

      {selected && (
        <p className="rounded-xl bg-primary/10 px-3.5 py-2.5 text-center text-sm font-semibold text-primary">
          {t("selectedNote", { name: selected.name })}
        </p>
      )}

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Sun className="mt-px size-4 shrink-0 text-gold" aria-hidden />
        {t("brightnessHint")}
      </p>

      <section className="grid gap-3">
        <div className="grid gap-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("childrenTitle")}
          </h2>
          {childRows.length > 0 && (
            <p className="text-xs leading-relaxed text-muted-foreground">{t("childrenHint")}</p>
          )}
        </div>

        {childRows.length === 0 && (
          <EmptyState
            icon={<Baby />}
            title={tHome("emptyChildren")}
            description={tHome("emptyChildrenDescription")}
          />
        )}

        {statusFailed && (
          <p className="flex items-center gap-2 rounded-xl bg-warning/15 px-3 py-2 text-xs font-medium text-foreground">
            <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
            {t("statusError")}
          </p>
        )}

        {childRows.map((child) => {
          const isSelected = child.id === selectedId;
          return (
            <button
              key={child.id}
              type="button"
              // No aria-label: the card's own text (name, class, today's
              // status) is a better accessible name than "Select X" would be.
              aria-pressed={isSelected}
              onClick={() => setSelectedId(isSelected ? null : child.id)}
              className={cn(
                "flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border p-3 text-start transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:bg-muted/60"
              )}
            >
              <Avatar className="size-14 shrink-0 ring-1 ring-primary/15">
                {child.photoUrl && <AvatarImage src={child.photoUrl} alt="" />}
                <AvatarFallback className="bg-primary/10 text-base font-semibold text-primary">
                  {child.initials}
                </AvatarFallback>
              </Avatar>

              <span className="grid min-w-0 flex-1 gap-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{child.name}</span>
                  {child.secondaryName && (
                    <span className="text-xs text-muted-foreground" dir="auto">
                      {child.secondaryName}
                    </span>
                  )}
                </span>
                {child.className && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: child.classColor ?? "var(--gold)" }}
                      aria-hidden
                    />
                    {child.className}
                  </span>
                )}
                <span className="flex flex-wrap items-center gap-1.5">
                  {!statusFailed && (
                    <Badge className={attendanceChipClasses(child.status.kind)}>
                      {statusLabel(child.status)}
                    </Badge>
                  )}
                  {/* Safety signal: an allergy stays visible wherever a child
                      appears in a check-in context, parent-facing included. */}
                  {child.allergies.length > 0 && (
                    <Badge className="border-transparent bg-destructive-solid font-semibold text-destructive-foreground">
                      {t("allergy", { list: child.allergies.join(" · ") })}
                    </Badge>
                  )}
                </span>
              </span>

              {isSelected && (
                <CircleCheck className="size-6 shrink-0 text-primary" aria-hidden />
              )}
            </button>
          );
        })}
      </section>
    </div>
  );
}
