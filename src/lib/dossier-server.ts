import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { DossierStatus, DossierSubject, DossierSummaryRow, SignedUrlMap } from "@/lib/dossier";

/**
 * The server half of the dossier d'inscription: the readers every page uses
 * and the one place a family paper is turned into a URL.
 *
 * Signed URLs are minted here and only here — kg-media is private, a family
 * file is readable only by whoever may read its register row, and the
 * browser never holds a key that could sign one. Pages sign once, as a map
 * keyed by storage path, and hand the map to their client components.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

const SIGNED_URL_TTL_SECONDS = 3600;

interface SignableItem {
  path: string;
  file_name?: string | null;
  mime_type?: string | null;
}

/** A PDF by its declared type, or by its extension when the row predates mime_type. */
function isPdf(item: SignableItem): boolean {
  return item.mime_type ? item.mime_type === "application/pdf" : item.path.toLowerCase().endsWith(".pdf");
}

/**
 * One createSignedUrls call for every file and form a page shows (1 h). A
 * PDF's URL carries `download=<file_name>` so the browser saves it under the
 * name the family gave it rather than the uuid the register keys on; images
 * stay inline for the thumbnail and the lightbox. The download parameter is
 * appended to each URL by hand because the client's own `download` option
 * is one name for the whole batch, and a batch here is many papers.
 */
export async function signedDossierUrls(items: ReadonlyArray<SignableItem>): Promise<SignedUrlMap> {
  const paths = Array.from(new Set(items.map((item) => item.path).filter(Boolean)));
  if (paths.length === 0) return {};

  const supabase = await createClient();
  const { data } = await supabase.storage.from("kg-media").createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

  // The response keeps the request's order and echoes each path; a path the
  // policy refused comes back with a null URL, which the map keeps as null so
  // the screen renders the row without a link rather than a broken one.
  const signed = new Map<string, string | null>();
  paths.forEach((path, i) => {
    const row = data?.find((d) => d.path === path) ?? data?.[i];
    signed.set(path, row?.signedUrl ?? null);
  });

  const out: SignedUrlMap = {};
  for (const item of items) {
    if (!item.path || item.path in out) continue;
    const url = signed.get(item.path) ?? null;
    if (url && isPdf(item)) {
      const name = item.file_name?.trim() || item.path.slice(item.path.lastIndexOf("/") + 1);
      out[item.path] = `${url}&download=${encodeURIComponent(name)}`;
    } else {
      out[item.path] = url;
    }
  }
  return out;
}

/**
 * rpc("kg_dossier_status"), typed. Null when RLS hides the subject from the
 * caller — and, for an application, whenever the caller is not staff: the
 * family reads its own pending file through kg_my_application instead.
 */
export async function loadDossier(supabase: ServerSupabase, subject: DossierSubject): Promise<DossierStatus | null> {
  const { data, error } = await supabase.rpc("kg_dossier_status", {
    p_child: subject.childId ?? null,
    p_application: subject.applicationId ?? null,
  });
  if (error) throw new Error(`kg_dossier_status: ${error.message}`);
  return (data as DossierStatus | null) ?? null;
}

/** rpc("kg_dossier_summary", { p_tenant }): every child and open application of the tenant; as a parent, their own children. */
export async function loadDossierSummary(supabase: ServerSupabase, tenantId: string): Promise<DossierSummaryRow[]> {
  const { data, error } = await supabase.rpc("kg_dossier_summary", { p_tenant: tenantId });
  if (error) throw new Error(`kg_dossier_summary: ${error.message}`);
  return (data ?? []) as DossierSummaryRow[];
}

/** The summary keyed two ways, so the roster looks children up and the board looks applications up from one read. */
export function indexDossierSummary(rows: readonly DossierSummaryRow[]): {
  byChild: Map<string, DossierSummaryRow>;
  byApplication: Map<string, DossierSummaryRow>;
} {
  const byChild = new Map<string, DossierSummaryRow>();
  const byApplication = new Map<string, DossierSummaryRow>();
  for (const row of rows) {
    if (row.child_id) byChild.set(row.child_id, row);
    else if (row.application_id) byApplication.set(row.application_id, row);
  }
  return { byChild, byApplication };
}
