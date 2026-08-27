/** Schema: supabase/migrations/0040_kg_credentials.sql */
export type CredentialSubject = "child" | "guardian" | "staff";
export type CredentialKind = "qr" | "rfid" | "pin";

export interface CredentialRow {
  id: string;
  kind: CredentialKind;
  value: string;
  label: string | null;
  active: boolean;
  issued_at: string;
  last_used_at: string | null;
}
