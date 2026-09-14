"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useLocale, useTranslations } from "next-intl";
import { MessageCircle, QrCode, UserRoundX } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { formatTime } from "@/lib/format";

/**
 * One child on the badge pager (0169): what the child's card shows and what
 * its QR carries. Built server-side by getMyGuardianBadge (data.ts) — the
 * enrolled children linked to the badge's guardian row, with today's
 * register row — so every surface that raises the badge shows the same
 * cards.
 */
export interface CheckinBadgeChild {
  id: string;
  /** Display name in the page's locale, as the badge's own `name` is. */
  name: string;
  /** Given name alone, for the tab. */
  givenName: string;
  initials: string;
  /** Signed for this render; null when the child has no photo. */
  photoUrl: string | null;
  /** kg_children.tag_code — the child's half of the pair the QR encodes. */
  tagCode: string;
  /** Today's kg_attendance row, or nulls: the state line under the name. */
  today: { checkInAt: string | null; checkOutAt: string | null };
}

/**
 * The QR itself, black on white, the same on every card of the pager.
 *
 * marginSize={4} is the quiet zone the QR spec asks for; the card padding
 * adds more white around it so a hand at the edge cannot clip the code.
 */
function BadgeQr({ value, title }: { value: string; title: string }) {
  return (
    <QRCodeSVG
      value={value}
      level="M"
      marginSize={4}
      size={512}
      bgColor="#ffffff"
      fgColor="#000000"
      title={title}
      className="mx-auto h-auto w-full max-w-[22rem]"
    />
  );
}

/** The white card every QR sits on. See CheckinQrCard for why it is white. */
function WhiteCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-3xl bg-white p-5 shadow-lg ring-1 ring-black/10">{children}</div>;
}

/**
 * The parent's personal door badge — the family card of the pager.
 *
 * DELIBERATE THEME OPT-OUT: this one card is literally black-on-white, in dark
 * mode too. Everything else in the portal is token-driven, but a QR is not
 * decoration — a kiosk camera has to read it off a phone screen held at arm's
 * length in a sunlit doorway, and inverted or tinted codes are exactly what
 * makes those scans fail. Same reasoning as the printed child badge
 * (`components/modules/children/badge-card.tsx`), which also pins white/black.
 *
 * The QR encodes the guardian's `tag_code` and NOTHING else: the kiosk looks the
 * adult up from it, then shows their photo next to the child's for the human
 * check. The PIN is never rendered here — this screen is held up in public.
 */
export function CheckinQrCard({
  tagCode,
  guardianName,
}: {
  tagCode: string;
  guardianName: string;
}) {
  const t = useTranslations("portal.checkin");

  return (
    <WhiteCard>
      <BadgeQr value={tagCode} title={t("qrTitle")} />
      <div className="mt-3 text-center">
        {/* Text on this card is black by necessity — the card never darkens. */}
        <p className="text-sm font-semibold text-black">
          {t("badgeOf", { name: guardianName })}
        </p>
        {/* The badge number equals what the QR encodes, so showing it leaks
            nothing new — and it lets staff type the code in when a camera
            struggles. The PIN stays off this screen. */}
        <p className="mt-1 text-xs text-black/50">{t("badgeNumber")}</p>
        <p className="font-mono text-sm font-semibold tracking-widest text-black/80" dir="ltr">
          {tagCode}
        </p>
      </div>
    </WhiteCard>
  );
}

/**
 * One child's card (0169): the QR of the pair — this adult AND this child —
 * and, under it where the family card names the adult, the child's face,
 * name and where they stand today.
 *
 * Same white card, same QR size and place as the family card, so swiping
 * between the tabs moves nothing but the caption and what the code says:
 * the kiosk reads the pair, checks that the adult may act for the child,
 * and records the move the child's state calls for — no pick list. The
 * pair is shown only as a QR, not as a number: the kiosk's keypad cannot
 * type a `+`, and a number a parent cannot use is a number they should not
 * have to read. The face is the parent's own cue — at a door with two
 * children, the card in hand must be recognisable at a glance.
 *
 * Today's line is the door's own wording (`portal.door.today.*`), shared
 * with the /d page, so the same fact reads the same on both surfaces.
 */
export function CheckinChildQrCard({ child, value }: { child: CheckinBadgeChild; value: string }) {
  const t = useTranslations("portal.checkin");
  const tDoor = useTranslations("portal.door");
  const locale = useLocale();

  const todayLine = child.today.checkOutAt
    ? tDoor("today.out", { time: formatTime(child.today.checkOutAt, locale) })
    : child.today.checkInAt
      ? tDoor("today.in", { time: formatTime(child.today.checkInAt, locale) })
      : tDoor("today.notArrived");

  return (
    <WhiteCard>
      <BadgeQr value={value} title={t("qrTitle")} />
      <div className="mt-3 flex items-center justify-center gap-3">
        <Avatar className="size-14 shrink-0 ring-1 ring-black/10">
          {child.photoUrl && <AvatarImage src={child.photoUrl} alt="" />}
          <AvatarFallback className="bg-black/5 text-sm font-semibold text-black/70">
            {child.initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 text-start">
          {/* Text on this card is black by necessity — the card never darkens.
              A name is a person's own text: direction from its first letter. */}
          <p dir="auto" className="truncate text-base font-semibold text-black">
            {child.name}
          </p>
          <p className="text-xs font-medium text-black/60">{todayLine}</p>
        </div>
      </div>
    </WhiteCard>
  );
}

/**
 * What stands in for the QR when there is nothing to show yet.
 *
 * Two different dead ends, and the difference matters to whoever reads the
 * message that follows: `noGuardian` means the account was never linked to a
 * guardian record at all, `noBadge` means the record exists but the office has
 * not issued a tag for it. Both end at the same door — a message to the office
 * — so the full page and the quick dialog share this one state rather than
 * each inventing its own wording for a family that cannot check in yet.
 */
export function CheckinBadgeMissing({ kind }: { kind: "noGuardian" | "noBadge" }) {
  const t = useTranslations("portal.checkin");

  return (
    <EmptyState
      icon={kind === "noGuardian" ? <UserRoundX /> : <QrCode />}
      title={t(`${kind}.title`)}
      description={t(`${kind}.description`)}
      action={
        <Button asChild>
          <Link href="/portal/messages">
            <MessageCircle data-icon="inline-start" />
            {t("askOffice")}
          </Link>
        </Button>
      }
    />
  );
}
