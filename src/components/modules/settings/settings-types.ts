// Row shapes for the settings module (subsets of kg_* tables).

export interface EnrollLinkRow {
  id: string;
  token: string;
  label: string;
  active: boolean;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  created_at: string;
}

export interface HolidayRow {
  id: string;
  date: string;
  end_date: string | null;
  name: string;
  name_ar: string | null;
  tentative: boolean;
  closure: boolean;
}

export const TENANT_DOC_TYPES = ["agrement", "insurance", "conformity", "other"] as const;
export type TenantDocType = (typeof TENANT_DOC_TYPES)[number];

export interface TenantDocumentRow {
  id: string;
  doc_type: string;
  title: string;
  file_path: string | null;
  issued_at: string | null;
  expires_at: string | null;
}

export type DocExpiryStatus = "valid" | "expiring" | "expired" | "noExpiry";

/** Expiry status vs today; "expiring" = within the next 60 days. */
export function docExpiryStatus(expiresAt: string | null, today: string): DocExpiryStatus {
  if (!expiresAt) return "noExpiry";
  if (expiresAt < today) return "expired";
  const soon = new Date(`${today}T00:00:00+01:00`);
  soon.setDate(soon.getDate() + 60);
  const limit = soon.toISOString().slice(0, 10);
  return expiresAt <= limit ? "expiring" : "valid";
}
