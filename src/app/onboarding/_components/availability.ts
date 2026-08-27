"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Availability = "idle" | "checking" | "free" | "taken";

/** The answer we last got back, and what it was an answer about. */
type Answer = { value: string; free: boolean | null };

/**
 * Is this name (or address) still going spare?
 *
 * Checked while the person types rather than only on submit, because the whole
 * form is thrown back at them otherwise — and the name is the first field, so
 * they would have filled in everything else before finding out.
 *
 * The RPCs behind this return a boolean and nothing else (0052): a stranger can
 * learn that "Les Petits Génies" is taken, never who holds it or where they are.
 */
export function useAvailability(
  value: string,
  rpc: "kg_tenant_name_available" | "kg_tenant_slug_available",
  minLength: number
): Availability {
  const [answer, setAnswer] = useState<Answer | null>(null);

  const trimmed = value.trim();
  const tooShort = trimmed.length < minLength;

  useEffect(() => {
    if (tooShort) return;
    let cancelled = false;
    // Debounced: one round trip per pause, not one per keystroke.
    const timer = setTimeout(async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc(rpc, {
        [rpc === "kg_tenant_name_available" ? "p_name" : "p_slug"]: trimmed,
      });
      if (cancelled) return;
      // A failed check must never read as "taken" — the person would rename a
      // perfectly good crèche because the network blipped. `null` says nothing
      // at all; creation still enforces the rule either way.
      setAnswer({ value: trimmed, free: error ? null : Boolean(data) });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, tooShort, rpc]);

  // Derived, not stored: "checking" is simply the gap between what is in the
  // box and what we last heard back about.
  if (tooShort) return "idle";
  if (answer?.value !== trimmed) return "checking";
  if (answer.free === null) return "idle";
  return answer.free ? "free" : "taken";
}
