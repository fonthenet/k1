"use client";

import { useTransition, type ReactNode } from "react";
import { Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cancelLeave, decideLeave } from "./actions";

/**
 * Approve / reject for an admin on a pending request.
 *
 * The same idiom as the advances page, so one act reads one way across the
 * two registers: an outline verb says "yes", a ghost verb says "no", both in
 * the neutral colour — the page's one red is the "Refusé" pill in the history
 * rows, and a decision that has not been taken yet earns no colour of its own.
 * Each verb opens a confirm that names the person and the period, then says
 * in one sentence what changes. The verbs carry no glyph: they share the last
 * cell of a seven-column register, and the two icons were the width that
 * pushed the French table past its card.
 *
 * The approve confirm also states what the person is scheduled to give over
 * those days (kg_leave_conflicts, read by the page): a warning with the
 * counts in bold, never a refusal — the cours stay planned, the timetable
 * strikes the initials, and finding a replacement is the director's next
 * move, not this dialog's.
 */
export function LeaveDecisionButtons({
  id,
  memberName,
  period,
  conflicts,
}: {
  id: string;
  memberName: string;
  /** The formatted range with its day count, as the row prints it. */
  period: ReactNode;
  /** Scheduled cours and follow-ups of the person over the period. */
  conflicts?: { lessons: number; sessions: number };
}) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function decide(decision: "approved" | "rejected") {
    startTransition(async () => {
      const res = await decideLeave(id, decision);
      if (res.ok) {
        toast.success(decision === "approved" ? t("leaves.approvedToast") : t("leaves.rejectedToast"));
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  // The name is person-typed, so it sits on its own line in its own
  // direction rather than inside the translated sentence.
  const fact = (
    <span className="block text-foreground">
      <bdi dir="auto" className="block text-start font-medium">
        {memberName}
      </bdi>
      <span className="block">{period}</span>
    </span>
  );

  return (
    <div className="flex items-center justify-end gap-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={pending}>
            {t("leaves.approve")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("leaves.approveTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {fact}
              <span className="block">{t("leaves.approveDesc")}</span>
              {/* The consequence as one sentence with the counts in bold
                  (brief A7). Zero cours and zero follow-ups is nothing to
                  say. The name rides inside the sentence as an isolate so a
                  Latin name in the Arabic dialog keeps its letters in order. */}
              {conflicts && conflicts.lessons + conflicts.sessions > 0 && (
                <span className="block text-foreground">
                  {t.rich("leaves.conflicts", {
                    name: `\u2068${memberName}\u2069`,
                    lessons: conflicts.lessons,
                    sessions: conflicts.sessions,
                    b: (chunks) => <b className="font-semibold tabular-nums">{chunks}</b>,
                  })}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={() => decide("approved")}>
              {t("leaves.approve")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" disabled={pending}>
            {t("leaves.reject")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("leaves.rejectTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {fact}
              <span className="block">{t("leaves.rejectDesc")}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            {/* Not destructive: the description promises the person can ask
                again, and the page has already spent its red on "Refusé". */}
            <AlertDialogAction disabled={pending} onClick={() => decide("rejected")}>
              {t("leaves.reject")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Cancel button for one's own pending request. */
export function LeaveCancelButton({ id }: { id: string }) {
  const t = useTranslations("staff");
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await cancelLeave(id);
          if (res.ok) toast.success(t("leaves.cancelledToast"));
          else toast.error(t(`errors.${res.error}`));
        })
      }
    >
      <Undo2 data-icon="inline-start" />
      {t("leaves.cancel")}
    </Button>
  );
}
