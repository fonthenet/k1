"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { IdCard, Loader2, Printer, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import {
  issueGuardianCredentials,
  revokeGuardianCredentials,
  type IssuedCredentials,
} from "./guardian-credentials-actions";
import { GuardianCredentialsDialog } from "./guardian-credentials-dialog";

/** What the profile page is allowed to know about a guardian's credential. */
export interface GuardianCredentialState {
  tagCode: string | null;
  hasPin: boolean;
}

/**
 * Per-guardian door-credential control, rendered inside the guardians card.
 *
 * Admin-only: the page must not render this at all for other staff. The RPCs
 * enforce it too, but a button that is guaranteed to fail is worse than no
 * button. See `GuardiansSection`, which gates on `canManageCredentials`.
 */
export function GuardianCredentialsControl({
  childId,
  guardianId,
  credential,
}: {
  childId: string;
  guardianId: string;
  credential: GuardianCredentialState;
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const router = useRouter();
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);
  const [pending, startTransition] = useTransition();

  function fail(error: "forbidden" | "invalid" | "notFound" | "generic") {
    toast.error(error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"));
  }

  function issue() {
    startTransition(async () => {
      const res = await issueGuardianCredentials(childId, guardianId);
      if (res.ok) {
        setIssued(res.data);
        toast.success(t("guardians.credentials.toastIssued"));
        router.refresh();
      } else {
        fail(res.error);
      }
    });
  }

  function revoke() {
    startTransition(async () => {
      const res = await revokeGuardianCredentials(childId, guardianId);
      if (res.ok) {
        toast.success(t("guardians.credentials.toastRevoked"));
        router.refresh();
      } else {
        fail(res.error);
      }
    });
  }

  const badgeHref = `/children/${childId}/guardian/${guardianId}/badge`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {credential.tagCode ? (
          <>
            <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-1">
              <IdCard className="size-3.5 text-muted-foreground" aria-hidden />
              <span dir="ltr" className="font-mono text-xs font-semibold tracking-wider">
                {credential.tagCode}
              </span>
              {credential.hasPin && (
                // The PIN itself is never sent to the browser again — only the
                // fact that one exists. The dots are a reminder, not the value.
                <span
                  className="font-mono text-xs tracking-widest text-muted-foreground"
                  title={t("guardians.credentials.pinMaskedLabel")}
                  aria-label={t("guardians.credentials.pinMaskedLabel")}
                >
                  ••••
                </span>
              )}
            </span>

            <Button asChild variant="outline" size="sm">
              <Link href={badgeHref} target="_blank" rel="noopener noreferrer">
                <Printer data-icon="inline-start" />
                {t("guardians.credentials.printBadge")}
              </Link>
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" disabled={pending}>
                  <ShieldOff data-icon="inline-start" className="text-destructive" />
                  {t("guardians.credentials.revoke")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("guardians.credentials.revokeTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("guardians.credentials.revokeDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="min-h-11">
                    {tc("actions.cancel")}
                  </AlertDialogCancel>
                  <AlertDialogAction className="min-h-11" onClick={revoke}>
                    {t("guardians.credentials.revoke")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={issue} disabled={pending}>
            {pending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <IdCard data-icon="inline-start" />
            )}
            {t("guardians.credentials.issue")}
          </Button>
        )}
      </div>

      <GuardianCredentialsDialog
        childId={childId}
        guardianId={guardianId}
        credentials={issued}
        onClose={() => setIssued(null)}
      />
    </>
  );
}
