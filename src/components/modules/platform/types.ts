/** Schema: supabase/migrations/0043_kg_platform_admin.sql */
export type LeadStatus = "new" | "contacted" | "converted" | "lost" | "spam";

export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "converted", "lost", "spam"];

export interface LeadRow {
  id: string;
  created_at: string;
  centre_type: string | null;
  size: string | null;
  priority: string | null;
  wilaya: string | null;
  phone: string;
  locale: string;
  recommended_plan: string | null;
  status: LeadStatus;
  note: string | null;
  contacted_at: string | null;
}

export interface PlatformTenantRow {
  id: string;
  name: string;
  wilaya: string | null;
  commune: string | null;
  status: string;
  created_at: string;
  children: number;
  staff: number;
  last_activity: string | null;
}

export interface PlatformStats {
  tenants: number;
  tenants_active: number;
  children: number;
  staff: number;
  families: number;
  leads_new: number;
  leads_total: number;
  signups_30d: number;
}
