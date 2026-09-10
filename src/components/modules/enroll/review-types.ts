// What the REVIEW side of an application knows that the public wizard does
// not: which structure of the building the family asked for, and whether the
// file is about a child who already exists.
//
// Kept apart from ./types.ts on purpose. That file is the contract between the
// wizard and kg_submit_application, and it is edited by whoever works on the
// form; these fields only matter once a director is looking at the queue.
// `ApplicationRecord & ApplicationReviewFields` is the row a review page reads.

import type { ApplicationRecord } from "./types";

/** kg_structures, as embedded on an application row (`kg_structures(...)`). */
export interface StructureRef {
  id: string;
  name: string;
  name_ar: string | null;
  color: string;
  center_type: string;
}

/** kg_classes, as embedded on an application row (`kg_classes(...)`). */
export interface ClassRef {
  id: string;
  name: string;
  name_ar: string | null;
  structure_id: string | null;
}

/**
 * Columns added by 0136 (structure_id, class_id) and 0140 (existing_child_id,
 * source = 'transfer'). NULL structure_id is an answer — the family applied
 * to the building as a whole, or applied before the building had structures
 * — so a chip must simply not render rather than say "unknown".
 */
export interface ApplicationReviewFields {
  structure_id: string | null;
  class_id: string | null;
  /** 'sibling' | 'transfer' | a marketing channel | null — see ./types.ts. */
  source: string | null;
  /**
   * Set only on a transfer request: the child this file is ABOUT. Approving
   * such a file moves that child (kg_move_child) instead of creating one —
   * that is the whole difference between a transfer and an application.
   */
  existing_child_id: string | null;
  /** Present when the page selected the embed; absent on `select("*")`. */
  kg_structures?: StructureRef | null;
  kg_classes?: ClassRef | null;
}

export type ReviewApplication = ApplicationRecord & ApplicationReviewFields;

/** `kg_applications.source` written by kg_request_transfer (0140). */
export const TRANSFER_SOURCE = "transfer";

export function isTransferApplication(
  app: Pick<ApplicationReviewFields, "source" | "existing_child_id">
): boolean {
  // Both, not either: a stale row with the source but no child would make
  // the approve button call kg_move_child on nothing, and one with the child
  // but another source is not something the database ever writes.
  return app.source === TRANSFER_SOURCE && !!app.existing_child_id;
}

/** One row of kg_find_matching_child (0140). */
export interface MatchingChild {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
  structure_id: string | null;
  class_id: string | null;
}

/**
 * The child a transfer request is about, as they stand TODAY — the "is in
 * the crèche, Petite section" half of the sentence the reviewer reads.
 */
export interface TransferSubject {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  status: string;
  structure_id: string | null;
  class_id: string | null;
}

/**
 * What the approve dialog needs to know about a transfer beyond the row: the
 * names of where the child is now, resolved server-side so the client never
 * sees a structure id it cannot name.
 */
export interface TransferSummary {
  childId: string;
  fromStructureName: string | null;
  fromClassName: string | null;
}
