"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Copy, KeyRound, Link2, Loader2, MessageCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { waPhone } from "@/components/modules/billing/maps";
import type { GuardianClaim } from "./types";
import { cancelGuardianClaim, issueGuardianClaim } from "./actions";

/**
 * Connecting a parent's own account to the record the crèche already holds.
 *
 * A guardian typed in by hand has no `user_id`, so that parent has nothing to
 * sign in to. This mints a single-use code that joins the two.
 *
 * It used to print the code ONCE, straight from the RPC result, and never read
 * it back — the reasoning being that a code is a secret. In practice that made
 * the feature unusable: press the button, navigate away, and the invite is
 * invisible for its whole 14-day life. Production proved it — one guardian sat
 * with a live unclaimed code that no screen could show, so nobody could tell
 * whether that parent had been invited, repeat the code down the phone, or stop
 * it. Pressing "Invite" again just deleted it and minted another.
 *
 * So the code is now read back, to admins only. It is not a password: it is
 * single-use, it lapses in 14 days, it grants exactly one guardian record, and
 * the table it lives in is already `kg_is_admin` for every command. Being able
 * to see the invite you sent is worth more than hiding a value from the people
 * who issued it.
 */
export function GuardianPortalAccess({
  guardianId,
  guardianName,
  phone,
  hasAccount,
  email,
  claim,
  now,
}: {
  guardianId: string;
  guardianName: string;
  phone: string | null;
  hasAccount: boolean;
  /**
   * The address on the guardian's record. Shown beside "connected" so staff
   * can tell WHICH account answers for this parent — two guardians in a family
   * both reading "connected" is not enough to know who to reset or re-invite.
   * Null when none is on file; the account's own address lives in `auth.users`,
   * which staff cannot read.
   */
  email: string | null;
  claim: GuardianClaim | null;
  /** The server's clock, so "expires in N days" is pure given props rather
   *  than a `Date.now()` read during render. Same trick as ArrearsRefresh. */
  now: string;
}) {
  const t = useTranslations("children.guardians.portal");
  // `fresh` holds a code minted in this render pass; `claim` is one that was
  // already outstanding when the page loaded. Either way it is the same thing.
  const [fresh, setFresh] = useState<GuardianClaim | null>(null);
  const [pending, startTransition] = useTransition();
  const current = fresh ?? claim;

  if (hasAccount) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1.5">
          <CheckCircle2 className="size-3.5 text-success" />
          {t("connected")}
        </Badge>
        {email && (
          // dir=ltr: an address is a Latin run and mirrors in the Arabic UI
          // without it — see CONVENTIONS.md, "Bidi".
          <span dir="ltr" className="text-xs text-muted-foreground">
            {email}
          </span>
        )}
      </span>
    );
  }

  function issue() {
    startTransition(async () => {
      const res = await issueGuardianClaim(guardianId);
      if (res.ok) {
        // The RPC returns only the code; the 14 days are the column default.
        const expiresAt = new Date(new Date(now).getTime() + 14 * 864e5).toISOString();
        setFresh({ code: res.code, expiresAt });
        toast.success(t("issued"));
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  function cancel() {
    startTransition(async () => {
      const res = await cancelGuardianClaim(guardianId);
      if (res.ok) {
        setFresh(null);
        toast.success(t("cancelled"));
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  if (!current) {
    return (
      <Button variant="outline" size="sm" disabled={pending} onClick={issue}>
        {pending ? (
          <Loader2 className="animate-spin" data-icon="inline-start" />
        ) : (
          <KeyRound data-icon="inline-start" />
        )}
        {t("invite")}
      </Button>
    );
  }

  // /invite names the crèche and offers both doors before asking anyone to sign
  // in. It used to point at /onboarding, which bounces a signed-out visitor to
  // the LOGIN form — so a parent who had never had an account was asked to sign
  // in to one, with no idea who had invited them. The code rides along either
  // way and lands prefilled in the claim box.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const link = `${base}/invite/${current.code}`;
  const message = t("message", { name: guardianName, link });
  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(current.expiresAt).getTime() - new Date(now).getTime()) / 864e5)
  );

  async function copy(value: string, okKey: "copied" | "linkCopied") {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t(okKey));
    } catch {
      // Clipboard is blocked in plenty of contexts; the code is on screen
      // anyway, so this is a convenience failing, not the feature failing.
      toast.error(t("copyFailed"));
    }
  }

  return (
    <div className="flex basis-full flex-wrap items-center gap-2.5 rounded-xl bg-success/5 p-2.5 ring-1 ring-success/25">
      <code
        dir="ltr"
        className="rounded-lg bg-background px-2.5 py-1 font-mono text-base font-bold tracking-[0.2em] tabular-nums ring-1 ring-border"
      >
        {current.code}
      </code>

      <Button variant="outline" size="sm" onClick={() => copy(current.code, "copied")}>
        <Copy data-icon="inline-start" />
        {t("copy")}
      </Button>

      {/* The link is the one a parent can actually act on — it survives sign-up
          and lands them on the box with the code already in it. */}
      <Button variant="outline" size="sm" onClick={() => copy(link, "linkCopied")}>
        <Link2 data-icon="inline-start" />
        {t("copyLink")}
      </Button>

      {/* How this office already talks to families. */}
      {phone && (
        <Button variant="outline" size="sm" asChild>
          <a
            href={`https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle data-icon="inline-start" />
            {t("whatsapp")}
          </a>
        </Button>
      )}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" disabled={pending}>
            <X data-icon="inline-start" />
            {t("cancel")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cancelDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancelKeep")}</AlertDialogCancel>
            <AlertDialogAction onClick={cancel}>{t("cancelConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <p className="basis-full text-xs text-pretty text-muted-foreground">
        {t("outstanding", { count: daysLeft })}{" "}
        <button
          type="button"
          onClick={issue}
          disabled={pending}
          className="rounded font-medium text-foreground underline underline-offset-4 hover:no-underline disabled:opacity-50"
        >
          {t("reissue")}
        </button>
      </p>
    </div>
  );
}
