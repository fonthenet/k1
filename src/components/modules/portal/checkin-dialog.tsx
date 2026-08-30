"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { QrCode, Sun } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CheckinStatusKind } from "./checkin-client";
import { CheckinBadgeMissing, CheckinQrCard } from "./checkin-qr-card";
import type { PortalGuardianBadge } from "./portal-types";
import { useScreenWakeLock } from "./use-screen-wake-lock";

/**
 * Today's attendance for one child, resolved by whichever page opens the
 * dialog. Optional everywhere: the dialog never queries for it, so a surface
 * that does not already hold today's rows simply omits it and the tabs show
 * name and face alone.
 */
export interface CheckinDialogChildStatus {
  kind: CheckinStatusKind;
  /** Already formatted server-side, so the server and client agree. */
  time: string | null;
  reason: string | null;
  /** Who collected the child — only ever set on "left". */
  collectedBy?: string | null;
}

/** The child a trigger was opened from — name and face, nothing else. */
export interface CheckinDialogChild {
  id: string;
  name: string;
  /** Given name alone: what fits on a tab and what a parent scans for. */
  givenName: string;
  initials: string;
  photoUrl: string | null;
  status?: CheckinDialogChildStatus;
}

/**
 * The two shapes this trigger takes in the portal. Kept here rather than
 * spread across call sites so every "check in badge" button in the app stays
 * the same size and tone — and so no caller can shrink one below the 44px a
 * thumb needs at a crowded gate.
 */
type TriggerShape = "inline" | "block" | "corner";

const TRIGGER: Record<
  TriggerShape,
  {
    variant: "outline" | "ghost";
    size: "sm" | "default" | "icon";
    className: string;
    /** Corner triggers drop the label, so it moves to `aria-label` instead. */
    iconOnly?: boolean;
  }
> = {
  // Sits in a row of per-child actions next to "report an absence".
  inline: { variant: "outline", size: "sm", className: "h-11 rounded-lg px-3" },
  // Fills the width of a card, as the one action that card offers.
  block: {
    variant: "ghost",
    size: "default",
    className: "h-12 w-full justify-center text-primary hover:text-primary",
  },
  // Tucked into a card corner opposite the child's face. It reads as a small
  // glyph but is a full 44px of tap target, because a parent hits this one
  // while walking.
  corner: {
    variant: "ghost",
    size: "icon",
    className: "size-11 rounded-xl text-primary hover:text-primary",
    iconOnly: true,
  },
};

/**
 * Which child the badge is being raised for: face, "show this for X", and —
 * when the calling page already knew it — where that child stands today.
 *
 * This is the ONLY thing a tab changes. The QR above it is untouched.
 */
function CheckinChildLine({ child }: { child: CheckinDialogChild }) {
  const t = useTranslations("portal.checkin");
  // Today's wording is the portal's own, shared with the child cards and the
  // full /portal/checkin screen — a parent must never read two phrasings of
  // the same fact on two surfaces.
  const tHome = useTranslations("portal.home");

  const status = child.status;
  let statusLabel: string | null = null;
  if (status) {
    switch (status.kind) {
      case "arrived":
        statusLabel = tHome("status.arrived", { time: status.time ?? "" });
        break;
      case "left":
        statusLabel = status.collectedBy
          ? tHome("status.leftWith", { time: status.time ?? "", name: status.collectedBy })
          : tHome("status.left", { time: status.time ?? "" });
        break;
      case "absent":
        statusLabel = status.reason
          ? tHome("status.absentReason", { reason: status.reason })
          : tHome("status.absent");
        break;
      default:
        statusLabel = tHome("status.notYet");
    }
  }

  return (
    <div className="flex items-center justify-center gap-2.5 rounded-xl bg-primary/10 px-3.5 py-2.5">
      <Avatar className="size-9 shrink-0 ring-1 ring-primary/20">
        {child.photoUrl && <AvatarImage src={child.photoUrl} alt="" />}
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
          {child.initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 text-start">
        <p className="text-sm font-semibold text-primary">{t("showFor", { name: child.name })}</p>
        {statusLabel && (
          <p className="text-xs font-medium text-muted-foreground">{statusLabel}</p>
        )}
      </div>
    </div>
  );
}

/**
 * The door badge as a quick pop-up.
 *
 * A parent opens this one-handed while queueing at the gate, so it is a sheet
 * off the bottom edge on a phone (thumb reaches the QR, not a centred box) and
 * a plain dialog from `sm` up. Everything else on the screen is deliberately
 * thin: the QR is the whole point and the reassurance about how the door check
 * works lives on /portal/checkin, one tap deeper.
 *
 * It writes NOTHING. Attendance is recorded by the kiosk after a staff member
 * has compared the guardian's photo with the child's — that human comparison is
 * the second factor, and a phone screen can be photographed by anyone, so this
 * surface must never be able to shortcut it. Naming a child here is a cue for
 * the conversation at the door, nothing more.
 *
 * And the badge is issued to the ADULT: one tag code, one QR, whichever child
 * is selected. The tabs below the code switch who is being announced, never
 * what is scanned — the kiosk resolves the guardian and then offers their
 * children, siblings together if they arrive together.
 */
export function CheckinDialog({
  badge,
  child,
  trigger = "inline",
  className,
}: {
  badge: PortalGuardianBadge;
  /** Omit when the badge is opened for the family as a whole. */
  child?: CheckinDialogChild;
  trigger?: TriggerShape;
  className?: string;
}) {
  const t = useTranslations("portal.checkin");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);


  // Only while the badge is actually up: outside the dialog the parent is
  // reading their portal like any other page and should keep the usual timeout.
  useScreenWakeLock(open && !!badge.tagCode);

  const shape = TRIGGER[trigger];

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger asChild>
        <Button
          variant={shape.variant}
          size={shape.size}
          // Same words either way: a glyph-only trigger must still announce
          // itself as "check in badge", not as an unnamed button.
          aria-label={shape.iconOnly ? t("action") : undefined}
          className={cn(shape.className, className)}
        >
          {shape.iconOnly ? (
            <QrCode className="size-5" />
          ) : (
            <>
              <QrCode data-icon="inline-start" />
              {t("action")}
            </>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent
        className={cn(
          // Phone: a sheet pinned to the bottom edge, full-bleed, so the QR
          // lands in the lower half of the screen where a thumb already is —
          // and above the portal's own bottom tab bar, which it covers.
          "top-auto bottom-0 max-h-[92dvh] max-w-full gap-3.5 overflow-y-auto",
          "rounded-t-3xl rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))]",
          // Centred horizontally by auto margins rather than the default
          // start-1/2 + translate, so the same two classes hold in RTL with no
          // direction-specific override to keep in sync.
          "start-0 end-0 mx-auto translate-x-0 translate-y-0 rtl:translate-x-0",
          // From sm up it is an ordinary centred dialog again.
          "sm:top-1/2 sm:bottom-auto sm:max-w-md sm:-translate-y-1/2 sm:rounded-b-3xl"
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-base">{t("title")}</DialogTitle>
          {/* The full explanation of the door check belongs on the page, not on
              a pop-up whose job is to put the QR under a thumb — but a screen
              reader still gets it. */}
          <DialogDescription className="sr-only">{t("subtitle")}</DialogDescription>
        </DialogHeader>

        {!badge.hasGuardian || !badge.tagCode ? (
          <CheckinBadgeMissing kind={badge.hasGuardian ? "noBadge" : "noGuardian"} />
        ) : (
          <>
            <CheckinQrCard tagCode={badge.tagCode} guardianName={badge.name} />

            {/* Named under the code, because the staff member reads the code
                first and then asks who they are handing over.

                There used to be a row of sibling tabs here. It had to be
                followed by a line explaining that tapping it changed nothing —
                the badge is issued per GUARDIAN, so every child shares one
                code — and a control whose own caption says it does nothing is
                a control that should not exist. The child is named, not
                chosen. */}
            {child && <CheckinChildLine child={child} />}

            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <Sun className="mt-px size-4 shrink-0 text-gold" aria-hidden />
              {t("brightnessHint")}
            </p>
          </>
        )}

        {/* A reachable way out: the X sits in the far top corner, which is the
            one place a thumb cannot get to on the phone this is designed for. */}
        <DialogClose asChild>
          <Button variant="outline" className="h-11 w-full">
            {tc("actions.close")}
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
