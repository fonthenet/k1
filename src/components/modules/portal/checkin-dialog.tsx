"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, QrCode, Sun } from "lucide-react";
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
import {
  CheckinBadgeMissing,
  CheckinChildQrCard,
  CheckinQrCard,
  type CheckinBadgeChild,
} from "./checkin-qr-card";
import { pairValue } from "@/lib/door-code";
import type { CheckinStatusKind, PortalGuardianBadge } from "./portal-types";
import { useScreenWakeLock } from "./use-screen-wake-lock";

/**
 * Today's attendance for one child, resolved by whichever page opens the
 * dialog. Optional everywhere: the dialog never queries for it, so a surface
 * that does not already hold today's rows simply omits it. Since 0169 the
 * dialog reads today off the badge's own children instead (see
 * CheckinBadgeChild); the shape stays because the home computes it for its
 * chips and hands it through unchanged.
 */
export interface CheckinDialogChildStatus {
  kind: CheckinStatusKind;
  /** Already formatted server-side, so the server and client agree. */
  time: string | null;
  reason: string | null;
  /** Who collected the child — only ever set on "left". */
  collectedBy?: string | null;
}

/**
 * The child a trigger was opened from — the cue that picks which card the
 * pager opens on. A child's file raises the badge for THAT child, so their
 * card comes up first; the home and the children list raise it for nobody in
 * particular and the pager opens on the first child.
 */
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
 * getMyGuardianBadge's answer since 0169: v1's badge plus the children it
 * may act for (CheckinBadgeChild, declared with the card that draws it).
 * Declared here, next to the other shapes data.ts builds for this dialog,
 * because the dialog is the only reader.
 */
export interface CheckinBadge extends PortalGuardianBadge {
  children: CheckinBadgeChild[];
}

/** The pager's last tab: v1's card for the whole family. */
const FAMILY_TAB = "family";

/**
 * The two shapes this trigger takes in the portal. Kept here rather than
 * spread across call sites so every "check in badge" button in the app stays
 * the same size and tone — and so no caller can shrink one below the 44px a
 * thumb needs at a crowded gate.
 */
type TriggerShape = "inline" | "corner";

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
  // Sits in a row of per-child actions next to "report an absence", or at
  // the end of a page's header row as the one badge for the whole family.
  inline: { variant: "outline", size: "sm", className: "h-11 rounded-lg px-3" },
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
 * The door badge as a quick pop-up.
 *
 * A parent opens this one-handed while queueing at the gate, so it is a sheet
 * off the bottom edge on a phone (thumb reaches the QR, not a centred box) and
 * a plain dialog from `sm` up. Everything else on the screen is deliberately
 * thin: the QR is the whole point. This dialog is the ONLY badge surface —
 * there used to be a full /portal/checkin page as well, carrying the same QR
 * plus a sibling picker that changed nothing, and two surfaces for one code
 * meant two places to keep in step for no benefit to the parent at the gate.
 *
 * It writes NOTHING. Attendance is recorded by the kiosk after a staff member
 * has compared the guardian's photo with the child's — that human comparison is
 * the second factor, and a phone screen can be photographed by anyone, so this
 * surface must never be able to shortcut it.
 *
 * Since 0169 "Ma carte" is a pager: one card per child, and last the card
 * of the whole family. A child's card carries BOTH the adult and the child
 * in one QR (`<GUARDIAN_TAG>+<CHILD_TAG>`, see pairValue): the kiosk reads
 * it, checks that this adult may act for that child, decides arrival or
 * departure from the child's state and records at once — no pick list. The
 * family card is v1's: the guardian's tag alone, and the kiosk shows the
 * children to choose from. The owner asked for this after seeing v1 live —
 * a parent with several children and one QR did not know, at the door,
 * which child the scan was about. Now the card says it, and the segmented
 * track above the card is a REAL choice at last: it changes what is scanned.
 * (v1's sibling tabs changed nothing but a caption, and were removed for
 * that reason; the pager does not bring them back — it replaces the code.)
 */
export function CheckinDialog({
  badge,
  child,
  trigger = "inline",
  selfCheckin = false,
  className,
}: {
  badge: CheckinBadge;
  /**
   * The child the trigger was opened from, if any: their card opens first.
   * Omit when the badge is opened for the family as a whole — the pager then
   * opens on the first child.
   */
  child?: CheckinDialogChild;
  trigger?: TriggerShape;
  /**
   * The crèche lets parents scan the door (kiosk settings, 0168): the other
   * half of the same scan, said in one line under this badge. Read from
   * `kioskSettings(tenant.settings)` by the page; off by default so a
   * surface that has not looked says nothing.
   */
  selfCheckin?: boolean;
  className?: string;
}) {
  const t = useTranslations("portal.checkin");
  const tBadge = useTranslations("portal.badge");
  const tDoor = useTranslations("portal.door");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);

  // Which card is up. The cue's child when the trigger was theirs, else the
  // first child; the family card only when there is no child to show.
  // Seeded once per mount: the home's live refresh re-renders the server
  // tree around this component and keeps its state, so the card a parent
  // swiped to stays up while today's rows refresh under it — the right
  // memory for a badge held up at a door.
  const cards = badge.children;
  const cued = child && cards.some((c) => c.id === child.id) ? child.id : null;
  const [tab, setTab] = useState<string>(cued ?? cards[0]?.id ?? FAMILY_TAB);
  // A card the list no longer has (a child withdrawn under an open portal)
  // falls back to the first, never to an empty pane.
  const activeTab = tab === FAMILY_TAB || cards.some((c) => c.id === tab) ? tab : (cards[0]?.id ?? FAMILY_TAB);
  // Hoisted so the narrowing survives into the cards' render callbacks.
  const tagCode = badge.tagCode;

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
          {/* The explanation of the door check would crowd a pop-up whose job
              is to put the QR under a thumb, so it is spoken, not shown — a
              screen reader still gets it. */}
          <DialogDescription className="sr-only">{t("subtitle")}</DialogDescription>
        </DialogHeader>

        {!badge.hasGuardian || !tagCode ? (
          <CheckinBadgeMissing kind={badge.hasGuardian ? "noBadge" : "noGuardian"} />
        ) : cards.length === 0 ? (
          // No enrolled child linked to this badge yet (a family whose
          // application is still open): the family card alone, as in v1.
          <>
            <CheckinQrCard tagCode={tagCode} guardianName={badge.name} />
            <p className="text-center text-xs leading-relaxed text-muted-foreground text-pretty">
              {tBadge("familyHint")}
            </p>
          </>
        ) : (
          // The pager: a segmented track of the children by given name, the
          // family last — in both directions, because the track is a flex
          // row and flips with the page. Only the active card is mounted,
          // so one QR is drawn at a time.
          <Tabs value={activeTab} onValueChange={setTab} className="gap-3.5">
            <TabsList
              aria-label={t("pickChild")}
              // Taller than the house default: these are tapped at a door.
              // With more names than fit, the track scrolls sideways rather
              // than squeezing the names to nothing.
              className="h-auto! w-full max-w-full flex-nowrap justify-start overflow-x-auto snap-x snap-mandatory"
            >
              {cards.map((c) => (
                <TabsTrigger key={c.id} value={c.id} className="h-10 shrink-0 snap-start px-3 text-sm">
                  {/* A given name is a person's own text. */}
                  <bdi dir="auto">{c.givenName}</bdi>
                </TabsTrigger>
              ))}
              <TabsTrigger value={FAMILY_TAB} className="h-10 shrink-0 snap-start px-3 text-sm">
                {tBadge("family")}
              </TabsTrigger>
            </TabsList>

            {cards.map((c) => (
              <TabsContent key={c.id} value={c.id} className="grid gap-3.5">
                <CheckinChildQrCard child={c} value={pairValue(tagCode, c.tagCode)} />
                <p className="text-center text-xs leading-relaxed text-muted-foreground text-pretty">
                  {tBadge("childHint", { name: c.name })}
                </p>
              </TabsContent>
            ))}
            <TabsContent value={FAMILY_TAB} className="grid gap-3.5">
              <CheckinQrCard tagCode={tagCode} guardianName={badge.name} />
              <p className="text-center text-xs leading-relaxed text-muted-foreground text-pretty">
                {tBadge("familyHint")}
              </p>
            </TabsContent>
          </Tabs>
        )}

        {badge.hasGuardian && tagCode && (
          <>
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <Sun className="mt-px size-4 shrink-0 text-gold" aria-hidden />
              {t("brightnessHint")}
            </p>

            {/* The door's own code is the other end of this scan: where the
                team is not at the tablet, the parent's camera does the same
                job. One line, only where the crèche has switched it on. */}
            {selfCheckin && (
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <Camera className="mt-px size-4 shrink-0" aria-hidden />
                {tDoor("orScan")}
              </p>
            )}
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
