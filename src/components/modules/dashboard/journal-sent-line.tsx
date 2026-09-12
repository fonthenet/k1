import type { ReactElement } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { readJournalLedger } from "@/lib/journal-ledger";
import { formatTime } from "@/lib/format";
import type { RosterNoun } from "@/lib/vocabulary";

/**
 * The last line of the dashboard's Aujourd'hui card: whether the families got
 * today's journal. "Journal du jour envoyé à 17:03 · 24 enfants" once the
 * evening send has gone out; when it decided the day but told nobody, the one
 * reason why (the same sentence the settings footer says, so the director
 * reads one story); nothing at all before it has decided anything. No link,
 * no icon — the fact, muted, once.
 *
 * Scoped like every other read of the card: the rail's structure, or the
 * whole building; the `structure_id = scoped OR null` rule lives in the
 * ledger reader, not here.
 */
export async function JournalSentLine({
  tenantId,
  structureId,
  day,
  noun,
}: {
  tenantId: string;
  structureId: string | null;
  day: string;
  noun: RosterNoun;
}): Promise<ReactElement | null> {
  const supabase = await createClient();
  const ledger = await readJournalLedger(supabase, { tenantId, structureId, day });
  if (ledger.rows.length === 0) return null;

  const [t, locale] = await Promise.all([getTranslations("dashboard"), getLocale()]);
  const line = "border-t border-border pt-4 text-sm text-muted-foreground";

  if (ledger.sent > 0 && ledger.sentAt) {
    return (
      <p className={line}>
        {t.rich(`today.journalSent.${noun}`, {
          time: formatTime(ledger.sentAt, locale),
          count: ledger.sent,
          ltr: (c) => <span dir="ltr" className="tabular-nums">{c}</span>,
        })}
      </p>
    );
  }
  if (ledger.dominant) {
    return (
      <p className={line}>
        {t(`today.journalNothing.${ledger.dominant}`, { count: ledger.byStatus[ledger.dominant] })}
      </p>
    );
  }
  return null;
}
