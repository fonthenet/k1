"use server";

import { revalidatePath } from "next/cache";
import { flushPush } from "@/app/actions/push";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";

/**
 * Brings invoice statuses up to date: flips anything past its due date to
 * `overdue` (Africa/Algiers) and lets the database emit its one digest
 * notification per tenant — `kg_refresh_overdue_invoices`, migration 0026.
 *
 * An invoice goes overdue because a date passed, not because anyone clicked, so
 * there is no write to hang this on. Running it when a finance user opens the
 * arrears list keeps the data current without a cron in development.
 *
 * The production path is still a scheduled sweep (pg_cron, exactly like the push
 * dispatcher in NOTIFICATIONS.md) — a kindergarten where nobody opens the arrears
 * page for a week should still get its digest. This call is the safety net, not
 * the mechanism, which is why it is best-effort: a failure is swallowed, and the
 * page renders the same figures either way (arrears are computed from due dates,
 * never from the status column).
 */
export async function refreshOverdueInvoices(): Promise<{ flipped: number }> {
  const ctx = await requireFinance();

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("kg_refresh_overdue_invoices", {
      p_tenant: ctx.tenant.id,
    });
    if (error) {
      console.error("kg_refresh_overdue_invoices failed:", error.message);
      return { flipped: 0 };
    }

    // The sweep is what writes the digest notification, so push it out the way
    // every other write path does. Already best-effort on its own side.
    await flushPush();

    const flipped = typeof data === "number" ? data : Number(data ?? 0) || 0;
    if (flipped > 0) {
      // Statuses moved: the badges on these three surfaces are now stale.
      revalidatePath("/billing");
      revalidatePath("/billing/arrears");
      revalidatePath("/dashboard");
    }
    return { flipped };
  } catch (e) {
    console.error("kg_refresh_overdue_invoices failed:", e);
    return { flipped: 0 };
  }
}
