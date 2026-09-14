import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { LocaleToggle } from "@/app/(auth)/_components/locale-toggle";
import { Wordmark } from "@/components/landing/wordmark";
import { DoorClient } from "@/components/modules/portal/door-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal");
  return { title: t("door.title") };
}

/**
 * Where the door's QR lands (0168).
 *
 * The kiosk's idle screen shows a code that lives ninety seconds; a parent
 * points the phone's camera at it and arrives here — from the camera app,
 * one-handed, with no portal open behind them. So this page is its own small
 * field rather than a portal tab: the wordmark, so the family knows whose
 * screen this is, the language switch, and one card. The same field as the
 * join page, for the same reason — it is opened cold.
 *
 * Who is holding the phone decides what the card says — and the register
 * decides who that is. Nobody signed in: sign in, with this exact address
 * carried in `next`, so the code is not lost to the login — it has ninety
 * seconds, and a password takes twenty. Anyone signed in: the door itself,
 * and kg_door_peek's answer. It lets through every account with a guardian
 * row in the code's tenant, whatever its membership says — an owner whose
 * own child is enrolled holds ONE membership there (unique per account and
 * tenant), the staff one, and is a guardian all the same; a membership
 * heuristic here would have refused them the door the database grants. The
 * context is resolved the way the portal shell does it, without bouncing
 * staff, only to tell the client whether the account is on a team: when
 * the peek answers `not_a_parent`, a member of staff is pointed at the
 * kiosk — the other half of the scan, one tap away — instead of being told
 * they have no child here.
 *
 * The code goes to the database as it came: kg_door_peek upper-cases and
 * trims, and a code it does not know is `unknown_code` whatever its shape.
 */
export default async function DoorPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/d/${code}`)}`);

  // `isStaff` follows the membership the context settled on (a staff one
  // when the account has both and no cookie says otherwise) — the same
  // tenant /kiosk opens, so the pointer and the door it points at agree.
  const ctx = await getTenantContext();

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-[radial-gradient(ellipse_75%_100%_at_50%_0%,var(--primary),transparent_70%)] opacity-[0.09]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-24 -end-24 size-80 rounded-full bg-gold/10 blur-3xl"
        aria-hidden
      />

      <header className="relative mx-auto flex w-full max-w-md items-center justify-between gap-3 px-4 py-4">
        <Link
          href="/"
          className="min-w-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Wordmark className="min-w-0" />
        </Link>
        <LocaleToggle />
      </header>

      <main className="relative mx-auto w-full max-w-md flex-1 px-4 pt-2 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {/* The sign-in card's own shadow and ring, so the two screens a
            family meets cold — the login and the door — are one surface. */}
        <div
          className={cn(
            "rounded-3xl bg-card/80 p-5 ring-1 ring-border/50 backdrop-blur-sm",
            "shadow-[0_1px_2px_rgba(16,54,66,0.04),0_12px_40px_-12px_rgba(16,54,66,0.16)]"
          )}
        >
          <DoorClient code={code} isStaff={ctx.isStaff} />
        </div>
      </main>
    </div>
  );
}
