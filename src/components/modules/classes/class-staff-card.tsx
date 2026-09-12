import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SectionCard } from "@/components/shared/section-card";
import { StaffLink } from "@/components/shared/entity-link";
import { initialsFromName } from "@/lib/format";
import { AssignStaffDialog, type AssignableStaff } from "./assign-staff-dialog";
import type { AssignedStaff } from "./class-types";

/**
 * The team on a class — who is on it and who leads it — as one section.
 *
 * A divided list of people, main educator first. "Leads this class" is said
 * once, as the one gold-ink word beside the name — the mark a detail row
 * uses. The gold ring on the avatar belongs to the list cards, where there is
 * no room for the word; here every avatar wears the same hairline ring so
 * the word is the only mark. No tinted row, no badge, no star. The dialog is
 * the one place the team is changed, so the rows carry no controls of their
 * own; it also shows where each person already works, which a per-row button
 * never could.
 */
export async function ClassStaffCard({
  classId,
  className,
  assigned,
  staff,
  canManage,
}: {
  classId: string;
  /** Locale-resolved class name, for the dialog title. */
  className: string;
  assigned: AssignedStaff[];
  /** Every active member, each with the other classes they are already on. */
  staff: AssignableStaff[];
  canManage: boolean;
}) {
  const t = await getTranslations("classes.detail.staff");

  return (
    <SectionCard
      icon={Users}
      tone={0}
      title={t("title")}
      hint={t("hint")}
      action={
        // The icon trigger: in the page's narrow column a labelled button
        // would push the title and its hint onto three lines.
        canManage ? (
          <AssignStaffDialog
            classId={classId}
            className={className}
            staff={staff}
            assigned={assigned}
            trigger="icon"
          />
        ) : undefined
      }
      contentClassName="gap-0"
    >
      {assigned.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {assigned.map((s) => (
            <li key={s.membershipId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <Avatar className="size-9 ring-1 ring-border">
                <AvatarFallback className="bg-secondary text-xs font-semibold text-primary">
                  {initialsFromName(s.name) || "?"}
                </AvatarFallback>
              </Avatar>
              {/* An inline bdi, not a block with text-start: the name is
                  isolated for bidi but stays beside its avatar whichever
                  script it is written in. */}
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                <StaffLink id={s.membershipId} className="font-semibold">
                  <bdi>{s.name}</bdi>
                </StaffLink>
                {s.isMain && (
                  <span className="text-xs font-medium text-gold-ink">{t("main")}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
