"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useTranslations } from "next-intl";
import { MessageCircle, QrCode, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * The parent's personal door badge.
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
    <div className="rounded-3xl bg-white p-5 shadow-lg ring-1 ring-black/10">
      {/* marginSize={4} is the quiet zone the QR spec asks for; the card padding
          adds more white around it so a hand at the edge cannot clip the code. */}
      <QRCodeSVG
        value={tagCode}
        level="M"
        marginSize={4}
        size={512}
        bgColor="#ffffff"
        fgColor="#000000"
        title={t("qrTitle")}
        className="mx-auto h-auto w-full max-w-[22rem]"
      />
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
    </div>
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
