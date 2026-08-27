"use client";

// Fires the overdue sweep once, after the arrears page has painted.
//
// Renders nothing and says nothing: this is housekeeping the reader did not ask
// for, so a toast would be noise on every visit, and a failure changes nothing
// they can see (the page ages debts from due dates, not from the status column).
//
// Once per Algiers day per tenant, deliberately. `kg_refresh_overdue_invoices`
// emits its digest every time it finds overdue invoices — it passes no actor to
// `kg_notify`, so nobody is filtered out — and an office that opens this page
// six times a day should not get six identical alerts. The day stamp makes this
// stand in for the daily cron until the scheduled sweep exists (NOTIFICATIONS.md).

import { startTransition, useEffect, useRef } from "react";
import { refreshOverdueInvoices } from "./arrears-actions";

const KEY_PREFIX = "kg:arrears-sweep:";

export function ArrearsRefresh({ tenantId, day }: { tenantId: string; day: string }) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const key = `${KEY_PREFIX}${tenantId}`;
    try {
      // Storage can be unavailable (private mode, blocked cookies) — then the
      // sweep simply runs, which is the safe direction to fail in.
      if (window.localStorage.getItem(key) === day) return;
    } catch {
      /* no storage — run it */
    }

    // The action revalidates when something actually changed, and that
    // re-render comes back in the same response — no router.refresh() needed.
    startTransition(async () => {
      try {
        await refreshOverdueInvoices();
        // Stamped only after the call came back: a failed sweep should be
        // retried on the next visit, not skipped until tomorrow.
        window.localStorage.setItem(key, day);
      } catch {
        /* best effort by design — see refreshOverdueInvoices() */
      }
    });
  }, [tenantId, day]);

  return null;
}
