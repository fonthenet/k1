// Where an owed amount goes when somebody clicks it.
//
// Every "owes 10 000 DA" in the dashboard used to be either inert or pointed at
// a list, which is the one thing the reader does not need: they are looking at
// the amount precisely because they already know whose it is. The child page's
// badge was the worst of them — it linked to `/billing?child=<id>`, a parameter
// the billing hub never read, so it landed on the unfiltered hub scoped to the
// CURRENT month, with the overdue invoice from an earlier month nowhere on
// screen. Clicking the debt navigated away from the debt.
//
// One open invoice is by far the common case (today it is every owing child in
// the crèche), and it can simply be opened. Several go to the child's own
// billing tab, which lists every month rather than one, and where the reader
// can then pick. Zero — the badge should not have rendered, but a stale figure
// or an invoice older than the 36 the page loads can get here — falls back to
// the same tab rather than a dead link.

/**
 * @param childId  Whose amount this is.
 * @param openInvoiceIds  That child's unsettled invoices, OLDEST DUE FIRST.
 *   Ordering matters only for the caller's own "which one is it" copy; with a
 *   single id it is the answer outright.
 */
export function owedHref(childId: string, openInvoiceIds: string[]): string {
  return openInvoiceIds.length === 1
    ? `/billing/invoices/${openInvoiceIds[0]}`
    : `/children/${childId}?tab=billing`;
}

/** An invoice still owed on: not cancelled, not a draft, not settled. */
export function isOpenInvoice(i: {
  status: string;
  total: number | string;
  paid_amount: number | string;
}): boolean {
  return (
    i.status !== "void" && i.status !== "draft" && Number(i.total) > Number(i.paid_amount)
  );
}
