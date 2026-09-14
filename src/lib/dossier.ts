// The dossier d'inscription, in TypeScript.
//
// Migration 0164 turned kg_child_documents from a shelf staff filled into the
// register of what a family hands in: one list of requirements per KIND of
// structure (kg_document_requirements), one row per paper answering one of
// them, a review state, a source, an expiry. Every screen that shows a paper
// — the public wizard's step, the portal child page, the family's pending
// file, the application review, the child record, the roster, the board,
// the settings page — imports its vocabulary and its row shapes from here,
// so a state word, a path rule or an accept list is typed once.
//
// Column and jsonb key names are the migration's, verbatim (snake_case as the
// RPCs return them); when a shape here and the SQL disagree, the SQL wins.
//
// CLIENT-SAFE: the upload control and the wizard step import this file, so
// nothing here touches the server client factory, the server marker package
// or the request-headers API. The server half lives in dossier-server.ts.
import type { AppChildPayload, AppGuardianPayload, AppHealthPayload } from "@/components/modules/enroll/types";
import type { StatusTone } from "@/components/shared/status-pill";

/* ── A. Vocabulary ───────────────────────────────────────────────────────── */

/** kg_center_kind(kg_center_type): private_* → 'school', everything else → 'early'. */
export type DossierKind = "early" | "school";

/** kg_document_requirements.applies_to — a label on the line, never a join to a guardian. */
export type DocumentAppliesTo = "child" | "guardian";

/** kg_document_requirements.accepts */
export type DocumentAccepts = "any" | "image" | "pdf";

/** enum kg_document_status — the three STORED states of a register row. */
export type DocumentStatus = "received" | "accepted" | "rejected";

/** kg_child_documents.source — who put the paper on the register. */
export type DocumentSource = "family" | "staff";

/**
 * The DERIVED state of a requirement, as kg_dossier_status returns it in
 * `lines[].state` and `todo[].state`. "missing" = no row; "expired" =
 * accepted with expires_at before kg_today(). Never stored (D9): no cron,
 * no fourth enum value — the latest row and today's date decide.
 */
export type DossierState = "missing" | "received" | "accepted" | "rejected" | "expired";

/** Mime types the register accepts. Storage's metadata is the source of truth for a family row. */
export type DocumentMime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

/** kg_child_documents.size_bytes CHECK: 1..10485760. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Longest side of a family photo of a paper after resizeToJpeg — a legible A4 scan at 300–600 KB. */
export const DOCUMENT_IMAGE_MAX_PX = 1600;

/**
 * The two seeded requirements the printable sheets stand in for: a print
 * link appears only when the kind's list carries the key.
 */
export const PRINTABLE_KEYS = { fiche: "information_sheet", demande: "handwritten_request" } as const;

/**
 * StatusPill tone per derived state — D9. `null` means NO pill: an accepted
 * paper reads as a muted "Acceptée le …" line, a missing one as muted
 * "Manquante" for staff and as the outline "Ajouter" button for the family.
 * The expected state renders nothing; the pill is spent on what needs a
 * human (received) and on what the office refused or time voided.
 */
export const DOSSIER_STATE_TONE: Record<DossierState, StatusTone | null> = {
  received: "attention",
  rejected: "danger",
  expired: "danger",
  accepted: null,
  missing: null,
};

const SCHOOL_TYPES = new Set(["private_primary", "private_middle", "private_secondary"]);

/** kg_center_kind in TypeScript, for a structure's center_type — or the tenant's when the child has no structure. */
export function centerKind(centerType: string | null | undefined): DossierKind {
  return centerType && SCHOOL_TYPES.has(centerType) ? "school" : "early";
}

/**
 * The requirement's name in the reader's language: name_ar for Arabic when
 * the row has one, else the French name. English falls back to French on
 * purpose — the seeded papers are French-named Algerian documents (extrait
 * de naissance, certificat de résidence) that an English-speaking parent in
 * Algeria will be asked for by that name at the desk, and a director can
 * rename any row from the settings page.
 */
export function requirementName(req: { name: string; name_ar: string | null }, locale: string): string {
  return (locale === "ar" && req.name_ar) || req.name;
}

/** description_ar for Arabic when present, else description; null when the row has neither. */
export function requirementDescription(
  req: { description: string | null; description_ar: string | null },
  locale: string
): string | null {
  return (locale === "ar" && req.description_ar) || req.description || null;
}

/** The rows of one kind, in sort_order. Works on DocumentRequirement and EnrollRequirement alike. */
export function forKind<T extends { kind: DossierKind; sort_order: number }>(
  items: readonly T[],
  kind: DossierKind
): T[] {
  return items.filter((item) => item.kind === kind).sort((a, b) => a.sort_order - b.sort_order);
}

/** The file input's `accept` for a requirement: the OS sheet then offers camera, library and files (D16). */
export function acceptAttr(accepts: DocumentAccepts): string {
  switch (accepts) {
    case "image":
      return "image/*";
    case "pdf":
      return "application/pdf";
    default:
      return "image/*,application/pdf";
  }
}

/**
 * Where a FAMILY upload lands: `${pathPrefix}/${uuid}.${pdf|jpg}`.
 * pathPrefix is one of
 *   `u/${uid}/enroll/docs`                         the wizard, the add-child wizard, /enroll/dossier/[id]
 *   `t/${tenantId}/children/${childId}/documents`  the portal child page
 * Images are re-encoded to JPEG before upload, so anything that is not a PDF
 * is a .jpg; the server actions re-check the result against the two regexes
 * below before handing it to kg_attach_document.
 */
export function documentUploadPath(pathPrefix: string, mime: DocumentMime | string): string {
  return `${pathPrefix}/${crypto.randomUUID()}.${mime === "application/pdf" ? "pdf" : "jpg"}`;
}

/** A uid, a tenant id or a child id dropped into a regex: uuids carry no metacharacters, but the guard costs nothing. */
function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `^u/<uid>/enroll/docs/<uuid>.(jpg|pdf)$` — what attachMyApplicationDocument and the sibling submit accept. */
export const FAMILY_ENROLL_PATH_RE = (uid: string): RegExp =>
  new RegExp(`^u/${escapeRe(uid)}/enroll/docs/[0-9a-f-]{36}\\.(jpg|pdf)$`);

/** `^t/<tenant>/children/<child>/documents/<uuid>.(jpg|pdf)$` — what attachMyChildDocument accepts. */
export const FAMILY_CHILD_PATH_RE = (tenantId: string, childId: string): RegExp =>
  new RegExp(`^t/${escapeRe(tenantId)}/children/${escapeRe(childId)}/documents/[0-9a-f-]{36}\\.(jpg|pdf)$`);

/**
 * Magic-byte sniff of a file's first bytes: %PDF-, FF D8 FF (JPEG),
 * 89 50 4E 47 (PNG), RIFF….WEBP. Returns null for anything else — HEIC
 * included, on purpose: a staff browser must convert before uploading
 * (D15), and a family photo is re-encoded to JPEG by the upload control
 * before it ever reaches this check. The declared mime type of an upload is
 * whatever the client said; the bytes are what the register keeps.
 */
export function sniffDocumentMime(head: Uint8Array | ArrayBuffer): DocumentMime | null {
  const b = head instanceof Uint8Array ? head : new Uint8Array(head);
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return "application/pdf";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/* ── B. Row types, as the tables return them ─────────────────────────────── */

/** One row of kg_document_requirements (select "*"). */
export interface DocumentRequirement {
  id: string;
  tenant_id: string;
  kind: DossierKind;
  /** Seeded slug (birth_certificate …) or `custom-xxxxxxxx`. Unique per (tenant_id, kind). */
  key: string;
  /** French. */
  name: string;
  name_ar: string | null;
  description: string | null;
  description_ar: string | null;
  required: boolean;
  applies_to: DocumentAppliesTo;
  accepts: DocumentAccepts;
  /** `t/${tenant_id}/forms/${id}.pdf` or null (CHECK kg_document_requirements_form_in_tenant). */
  form_path: string | null;
  /** The uploaded PDF's original file name, shown to the family. */
  form_name: string | null;
  /** 1..120 or null (no expiry). Accepting sets expires_at = kg_today() + valid_months. */
  valid_months: number | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** The seeded keys, for code that names one (print links, the seed script). Custom rows have other keys. */
export type SeededRequirementKey =
  | "handwritten_request"
  | "contract"
  | "birth_certificate"
  | "health_booklet"
  | "id_photos"
  | "medical_certificate"
  | "information_sheet"
  | "commitment_sheet"
  | "legalised_authorisation"
  | "vaccination_record"
  | "guardian_id"
  | "residence_certificate"
  | "school_certificate";

/** One row of kg_child_documents after 0164 (select "*"). child_id or application_id is set, never neither. */
export interface ChildDocumentRecord {
  id: string;
  tenant_id: string;
  child_id: string | null;
  application_id: string | null;
  /** Null only for an "Autre pièce": the FK is RESTRICT, so a delete never nulls it. */
  requirement_id: string | null;
  /** requirement.key, 'other', or a legacy DOC_TYPES value on a pre-0164 row. */
  doc_type: string;
  /** requirement.name at attach time, or the staff-typed title of an extra. */
  title: string;
  /** UNIQUE — the register's handle on the object in Storage. */
  file_path: string;
  uploaded_by: string | null;
  status: DocumentStatus;
  source: DocumentSource;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  /** date, YYYY-MM-DD, or null. */
  expires_at: string | null;
  created_at: string;
}

/* ── C. RPC payloads ─────────────────────────────────────────────────────── */

/** kg_get_enroll_link(...).documents[] — every ACTIVE requirement of the tenant, both kinds, ordered kind, sort_order. */
export interface EnrollRequirement {
  id: string;
  kind: DossierKind;
  key: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  description_ar: string | null;
  required: boolean;
  applies_to: DocumentAppliesTo;
  accepts: DocumentAccepts;
  form_path: string | null;
  form_name: string | null;
  sort_order: number;
  /**
   * NOT from the RPC: /enroll/[token]/page.tsx mints it with signedMediaUrl
   * (blank forms are public objects) and fills it in before handing the link
   * to the wizard. Absent or null when there is no form or signing failed.
   */
  form_url?: string | null;
}

/** `lines[].document` of kg_dossier_status — the LATEST row of the requirement, or null. */
export interface DossierLineDocument {
  id: string;
  file_path: string;
  file_name: string | null;
  mime_type: string | null;
  status: DocumentStatus;
  source: DocumentSource;
  review_note: string | null;
  reviewed_at: string | null;
  expires_at: string | null;
  created_at: string;
  uploaded_by: string | null;
}

/**
 * `lines[]` of kg_dossier_status: every ACTIVE requirement of the subject's
 * kind, plus the archived ones that still have a row for this subject
 * (`active: false` — shown, never counted, D18). Ordered active desc, sort_order.
 */
export interface DossierLine {
  id: string;
  key: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  description_ar: string | null;
  required: boolean;
  applies_to: DocumentAppliesTo;
  accepts: DocumentAccepts;
  form_path: string | null;
  form_name: string | null;
  valid_months: number | null;
  active: boolean;
  state: DossierState;
  document: DossierLineDocument | null;
}

/** `todo[]` of kg_dossier_status: the active REQUIRED lines still to settle, in sort_order. */
export interface DossierTodo {
  id: string;
  key: string;
  name: string;
  name_ar: string | null;
  state: Extract<DossierState, "missing" | "rejected" | "expired">;
}

/** `extra[]` of kg_dossier_status: rows with no requirement ("Autres pièces"), newest first. */
export interface DossierExtra {
  id: string;
  title: string;
  doc_type: string;
  file_path: string;
  file_name: string | null;
  status: DocumentStatus;
  created_at: string;
}

/**
 * kg_dossier_status(p_child, p_application) → jsonb. Null when the subject
 * is not readable under the caller's RLS — a parent asking about another
 * family's child gets null, never an empty file. `(null, application)` is
 * STAFF-ONLY (kg_applications is staff-only since 0058): an applicant gets
 * null there and reads their own file through kg_my_application. The counts
 * look at ACTIVE REQUIRED lines only.
 */
export interface DossierStatus {
  kind: DossierKind;
  /** Active required lines. */
  required: number;
  /** Active required lines accepted and not expired. */
  accepted: number;
  /** Active lines (required or not) in state received — "Pièces à vérifier". */
  pending: number;
  /** Active required lines missing, rejected or expired. */
  missing: number;
  /** Every active required line accepted (true on an empty list). */
  complete: boolean;
  todo: DossierTodo[];
  lines: DossierLine[];
  extra: DossierExtra[];
}

/**
 * One row of kg_dossier_summary(p_tenant): every child and every open
 * application (status not approved or rejected), active REQUIRED
 * requirements only. As a parent, RLS narrows it to their own children.
 */
export interface DossierSummaryRow {
  child_id: string | null;
  application_id: string | null;
  required: number;
  /** Accepted and not expired. */
  accepted: number;
  /** Received. */
  pending: number;
  /** Neither accepted nor pending: missing, rejected, expired. */
  missing: number;
}

/** What the roster and the board show from a summary row: `ok` = accepted, `total` = required. */
export interface DossierCount {
  ok: number;
  total: number;
}

/**
 * kg_my_application(p_id) → jsonb: the applicant's OWN words plus the
 * dossier, never a pipeline stage, a reviewer or a date (0058). Null when
 * the file is not theirs. Once approved the answer is the short form — the
 * child exists and the page redirects to it (D12).
 */
export type MyApplication =
  | { id: string; approved: true; child_id: string | null }
  | {
      id: string;
      approved: false;
      tenant_id: string;
      tenant_name: string;
      tenant_address: string | null;
      tenant_commune: string | null;
      tenant_wilaya: string | null;
      tenant_phone: string | null;
      /** A storage path (t/…/branding/…), signed by the page. */
      tenant_logo_url: string | null;
      child: AppChildPayload;
      guardians: AppGuardianPayload[];
      health: AppHealthPayload;
      structure_id: string | null;
      structure_name: string | null;
      structure_name_ar: string | null;
      class_name: string | null;
      class_name_ar: string | null;
      created_at: string;
      /** status = 'rejected' → the list is read-only. Never the stage itself. */
      closed: boolean;
      dossier: DossierStatus;
    };

/** One row of kg_my_applications() after 0164: the 0142 columns plus three counts. */
export interface MyApplicationRow {
  id: string;
  tenant_name: string;
  child_first_name: string | null;
  child_last_name: string | null;
  created_at: string;
  closed: boolean;
  source: string | null;
  existing_child_id: string | null;
  structure_id: string | null;
  class_id: string | null;
  /** 0 when the kind has no active required requirement — the row then stays a non-door. */
  dossier_required: number;
  dossier_missing: number;
  /** todo entries in state 'rejected'. */
  dossier_rejected: number;
}

/** One entry of `p_documents` for both submit RPCs. An entry the RPC cannot register is dropped, never fatal. */
export interface SubmitDocument {
  requirement_id: string;
  path: string;
  file_name: string;
}

/** Which register a paper hangs on. Exactly one id — kg_attach_document raises 22023 otherwise. */
export type DossierSubject =
  | { childId: string; applicationId?: undefined }
  | { applicationId: string; childId?: undefined };

/** RPC argument names, so nobody retypes them. */
export interface DossierRpcArgs {
  kg_dossier_status: { p_child: string | null; p_application: string | null };
  kg_dossier_summary: { p_tenant: string };
  kg_my_application: { p_id: string };
  kg_my_applications: Record<string, never>;
  kg_attach_document: {
    p_tenant: string;
    p_requirement: string;
    p_path: string;
    p_child?: string | null;
    p_application?: string | null;
    p_file_name?: string | null;
  };
  /** A verdict only: 'received' is refused with 22023 — a paper is born received, it never goes back. */
  kg_review_document: { p_doc: string; p_status: DocumentStatus; p_note?: string | null };
  /** restoreLegalList passes { p_active: true, p_restore: true }; the trigger and the migration pass their own. */
  kg_seed_document_requirements: { p_tenant: string; p_kind: DossierKind; p_active?: boolean; p_restore?: boolean };
  /** 9 arguments since 0164 — the 8-argument overload is gone. */
  kg_submit_application: {
    p_token: string;
    p_child: unknown;
    p_guardians: unknown;
    p_health: unknown;
    p_activity_ids: string[];
    p_fee_plan_id: string | null;
    p_class_id: string | null;
    p_structure_id: string | null;
    p_documents: SubmitDocument[];
  };
  /** 8 arguments since 0164 — the 7-argument overload is gone. */
  kg_submit_sibling_application: {
    p_tenant: string;
    p_child: unknown;
    p_health: unknown;
    p_activity_ids: string[];
    p_structure_id: string | null;
    p_class_id: string | null;
    p_fee_plan_id: string | null;
    p_documents: SubmitDocument[];
  };
}

/**
 * The SQLSTATEs the RPCs raise, mapped by the actions to the error codes the
 * UI knows:
 *   22023 invalid_parameter_value → "invalid"      (bad requirement — or one of the other kind —, path,
 *                                                   type, an empty object, a subject not in the tenant)
 *   42501 insufficient_privilege  → "forbidden"    (not theirs; or the line already carries a paper the
 *                                                   family may not double: received, or accepted and valid)
 *   23514 check_violation         → "noteRequired" (kg_review_document: refused without a note)
 *   23503 foreign_key_violation   → "referenced"   (deleteRequirement: papers still point at it)
 *   23505 unique_violation        → "duplicate"    (a path already on the register)
 */
export type DossierSqlState = "22023" | "42501" | "23514" | "23503" | "23505";

/* ── D. Client-side upload value ─────────────────────────────────────────── */

/**
 * One uploaded file the client holds before an RPC registers it. Persisted
 * in the wizard draft (localStorage v3) and re-exported by enroll/types.ts
 * for the wizard's own imports.
 */
export interface WizardDocument {
  /** The storage path the browser uploaded to (documentUploadPath). */
  path: string;
  /** Original file name, at most 120 characters — becomes kg_child_documents.file_name. */
  file_name: string;
  /** "application/pdf" or "image/jpeg" (images are re-encoded); picks the thumbnail or the PDF tile. */
  mime: string;
}

/** Storage path → signed URL (1 h), or null when signing failed. One map serves files and forms. */
export type SignedUrlMap = Record<string, string | null>;
