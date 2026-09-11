"use server";

import { createClient } from "@/lib/supabase/server";
import { supportsPrivateSchools } from "./private-school-types";

/** Capability check only: the RPC returns enum labels, never tenant records. */
export async function privateSchoolsAvailable(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase.rpc("kg_available_center_types");
  return !error && supportsPrivateSchools(data);
}
