"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { QrCode, Sun, Users } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
        statusLabel = tHome("status.left", { time: status.time ?? "" });
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
 * Which of my children am I announcing?
 *
 * A row of faces, not a dropdown: a parent one place from the front of the
 * queue recognises a photo faster than they read a list, and a tab that is
 * already visible costs one tap instead of three. Each tab is 44px tall and
 * keeps its natural width, so three or four siblings scroll sideways at 375px
 * rather than squashing into unreadable slivers — and because the row is a
 * plain overflow container, RTL scrolls from the correct edge for free.
 */
function CheckinChildTabs({
  options,
  value,
  onValueChange,
}: {
  options: CheckinDialogChild[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const t = useTranslations("portal.checkin");
  const listRef = useRef<HTMLDivElement>(null);

  // With four siblings the row is wider than the phone, and the child the
  // dialog opened on may be the one off the edge. Nothing is broken when that
  // happens — the line below still names them — but the row would read as
  // "nothing chosen", so it is dragged to the selected tab once, on open. The
  // dialog unmounts its content when it closes, so this runs per opening.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-slot="tabs-trigger"][data-state="active"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    // Deliberately mount-only: after that the parent is driving the row.
  }, []);

  return (
    <Tabs value={value} onValueChange={onValueChange} className="min-w-0 gap-2.5">
      <TabsList
        ref={listRef}
        aria-label={t("pickChild")}
        className={cn(
          "w-full max-w-full justify-start gap-1 overflow-x-auto rounded-xl p-1",
          // The stock list is a fixed 8 units tall; these tabs carry a face and
          // a full thumb target, so the height comes from the content instead.
          "h-auto group-data-horizontal/tabs:h-auto"
        )}
      >
        {options.map((option) => (
          <TabsTrigger
            key={option.id}
            value={option.id}
            // grow, but never shrink: with room to spare the tabs share the
            // row; with too little they overflow and the row scrolls.
            className="h-11 flex-[1_0_auto] gap-2 rounded-lg px-2.5"
          >
            <Avatar className="size-7 shrink-0 ring-1 ring-primary/15">
              {option.photoUrl && <AvatarImage src={option.photoUrl} alt="" />}
              <AvatarFallback className="bg-primary/10 text-[0.625rem] font-semibold text-primary">
                {option.initials}
              </AvatarFallback>
            </Avatar>
            <span className="max-w-28 truncate">{option.givenName}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      {/* One panel per child, and all it holds is the line naming them. The QR
          sits ABOVE this whole block precisely because it does not belong to
          any one tab. */}
      {options.map((option) => (
        <TabsContent key={option.id} value={option.id}>
          <CheckinChildLine child={option} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

/**
 * The child a freshly opened dialog should land on.
 *
 * Opened from one child's card, it is that child — the parent already said who
 * they meant. Opened cold, it is the first child who has not walked in yet,
 * because a parent standing at the door is almost always there for the one
 * still outside. With no attendance to go on, the first child.
 */
function defaultChildId(options: CheckinDialogChild[], child?: CheckinDialogChild): string {
  if (child && options.some((o) => o.id === child.id)) return child.id;
  const notYet = options.find((o) => o.status?.kind === "notYet");
  return notYet?.id ?? options[0]?.id ?? "";
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
  family,
  trigger = "inline",
  className,
}: {
  badge: PortalGuardianBadge;
  /** Omit when the badge is opened for the family as a whole. */
  child?: CheckinDialogChild;
  /**
   * Every child linked to this guardian, so a family with siblings can switch
   * between them without closing the dialog. Fetched once per page and shared
   * by every trigger on it — never queried from in here.
   */
  family?: CheckinDialogChild[];
  trigger?: TriggerShape;
  className?: string;
}) {
  const t = useTranslations("portal.checkin");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);

  const options = family ?? [];
  // One child needs no chooser, and an only child must never see a tab bar
  // holding a single tab.
  const showTabs = options.length > 1;
  const [selectedId, setSelectedId] = useState(() => defaultChildId(options, child));

  // Only while the badge is actually up: outside the dialog the parent is
  // reading their portal like any other page and should keep the usual timeout.
  useScreenWakeLock(open && !!badge.tagCode);

  const shape = TRIGGER[trigger];
  const selected = options.find((o) => o.id === selectedId) ?? options[0] ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Every opening starts from the sensible child again: a parent who
        // switched to a sibling last time and then tapped THIS card meant this
        // card's child, not the leftover selection.
        if (next) setSelectedId(defaultChildId(options, child));
        setOpen(next);
      }}
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
                first and then asks who they are handing over. */}
            {showTabs && selected ? (
              <>
                <CheckinChildTabs
                  options={options}
                  value={selected.id}
                  onValueChange={setSelectedId}
                />
                {/* Said plainly, because a row of tabs above a QR invites the
                    wrong guess: the code did not change when you tapped. */}
                <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                  <Users className="mt-px size-4 shrink-0 text-primary" aria-hidden />
                  {t("sameCodeHint")}
                </p>
              </>
            ) : (
              child && <CheckinChildLine child={child} />
            )}

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
