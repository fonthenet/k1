"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Baby,
  Ban,
  Check,
  Coffee,
  Keyboard,
  Loader2,
  LogIn,
  LogOut,
  ScanLine,
  TriangleAlert,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { setLocale } from "@/app/actions/locale";
import { childDisplayName, formatTime, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KioskKeypad } from "./kiosk-keypad";
import { KioskScanner } from "./kiosk-scanner";
import { toDateStr } from "./dates";
import { flushPush } from "@/app/actions/push";
import { allergenLabel } from "@/lib/allergens";

type Mode = "children" | "staff";
type Entry = "keypad" | "scan";
type Direction = "in" | "out";

interface KioskChild {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  tag_code: string | null;
  photo_path: string | null;
  kg_classes: { name: string; name_ar: string | null } | null;
}

interface KioskGuardian {
  id: string;
  first_name: string;
  last_name: string;
  relationship: string;
  photo_path: string | null;
  photoUrl: string | null;
}

/** One child on the guardian's pick list, with what a tap would record. */
interface PickChild {
  child: KioskChild;
  photoUrl: string | null;
  direction: Direction;
  checkInAt: string | null;
  /** kg_child_guardians.can_pickup for THIS guardian. Blocks the tile at departure. */
  canPickup: boolean;
}

/** Why the database refused to write — see migration 0027. */
type DuplicateReason = "already_in" | "already_out" | "just_arrived" | "returned";

/** A refused scan: nothing was written, a human has to decide. */
interface DuplicateInfo {
  child: KioskChild;
  photoUrl: string | null;
  reason: DuplicateReason;
  checkInAt: string | null;
  checkOutAt: string | null;
}

interface RecordedRow {
  child: KioskChild;
  direction: Direction;
  at: string;
}

/** What a batch has written so far, plus the duplicates still awaiting a call. */
interface DuplicateBatch {
  queue: DuplicateInfo[];
  done: RecordedRow[];
  guardian: KioskGuardian | null;
  knownPhotos: Record<string, string | null>;
  failedCount: number;
  usedRpc: boolean;
  date: string;
  /** How many children the parent asked for — the honest denominator. */
  total: number;
}

type RecordOutcome =
  | { kind: "recorded"; direction: Direction; at: string; viaRpc: boolean }
  | {
      kind: "duplicate";
      reason: DuplicateReason;
      checkInAt: string | null;
      checkOutAt: string | null;
    }
  | { kind: "failed"; message: string }
  // The database said no. Distinct from "failed": the request worked and
  // nothing was written — the custody gate, a closed day, or a scan outside
  // opening hours. The reason travels with it because they read very
  // differently at the door.
  | { kind: "refused"; reason: string };

/** The jsonb kg_checkin_by_tag returns, in both of its shapes. */
interface CheckinPayload {
  duplicate?: boolean;
  /** The custody gate: can_pickup=false at departure. NOTHING was written. */
  refused?: boolean;
  reason?: string;
  at?: string;
  check_in_at?: string | null;
  check_out_at?: string | null;
}

interface CheckedEntry {
  child: KioskChild;
  direction: Direction;
  at: string;
  allergies: string[];
  photoUrl: string | null;
}

interface ChildResult {
  date: string;
  entries: CheckedEntry[];
  failedCount: number;
  /** null when only a child's own tag was scanned — no adult was verified. */
  guardian: KioskGuardian | null;
}

/** Every move the staff clock understands, in the order a day goes. */
type StaffAction = "in" | "break_start" | "break_end" | "out";
type StaffState = "off" | "on_clock" | "on_break";

/** Who is at the pad and where their day currently stands. */
interface StaffPick {
  code: string;
  name: string;
  state: StaffState;
  clockInAt: string | null;
  breakStartAt: string | null;
  breakMinutes: number;
  /** Decides which lunch policy line this person is shown. */
  payType: "monthly" | "hourly";
  lunchAllowance: number;
}

interface StaffResult {
  name: string;
  action: StaffAction;
  at: string;
  breakMinutes: number;
  /** What actually comes off the pay — not the same as breakMinutes. */
  unpaidBreakMinutes: number;
}

const CHILD_SELECT =
  "id, first_name, last_name, first_name_ar, last_name_ar, tag_code, photo_path, kg_classes(name, name_ar)";
const GUARDIAN_SELECT = "id, first_name, last_name, relationship, photo_path";
const CODE_RE = /^[A-Z0-9-]{1,32}$/;
const RELATIONSHIPS = ["father", "mother", "guardian", "grandparent", "sibling", "other"];

const DUPLICATE_REASONS: DuplicateReason[] = ["already_in", "already_out", "just_arrived", "returned"];
/** The RPC's own window for "this is a double scan, not a pickup". */
const JUST_ARRIVED_MS = 2 * 60 * 1000;

function readReason(value: unknown, asked: Direction): DuplicateReason {
  if (DUPLICATE_REASONS.includes(value as DuplicateReason)) return value as DuplicateReason;
  // Unknown reason from a newer backend: still refused, so never claim success.
  return asked === "in" ? "already_in" : "already_out";
}

/**
 * What the quiet "anyway" button would write. `already_out` and `returned` are
 * the cases where the child is outside the building, so they record an arrival
 * (a forced `returned` also re-opens the day — the RPC clears the departure);
 * the others are a staff member saying "no, this really is a pickup".
 */
function forceDirection(reason: DuplicateReason): Direction {
  return reason === "already_out" || reason === "returned" ? "in" : "out";
}

/** The clash the RPC reports, recomputed for children who have no tag code. */
function localDuplicate(
  direction: Direction,
  att: { check_in_at: string | null; check_out_at: string | null } | null
): DuplicateReason | null {
  if (!att) return null;
  if (direction === "in" && att.check_in_at && !att.check_out_at) return "already_in";
  // Checked out earlier today, back at the door now.
  if (direction === "in" && att.check_out_at) return "returned";
  if (direction === "out" && att.check_out_at) return "already_out";
  if (
    direction === "out" &&
    att.check_in_at &&
    !att.check_out_at &&
    Date.now() - new Date(att.check_in_at).getTime() < JUST_ARRIVED_MS
  )
    return "just_arrived";
  return null;
}

/**
 * A camera reads whatever is on the phone screen. If a QR happens to carry a
 * URL wrapper, the code we care about is the last path segment or a code/tag
 * query parameter; anything else is passed through untouched.
 */
function normalizeScan(raw: string): string {
  let value = raw.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const param =
        url.searchParams.get("code") ??
        url.searchParams.get("tag") ??
        url.searchParams.get("pin");
      const segment = url.pathname.split("/").filter(Boolean).pop() ?? "";
      value = param ?? segment;
    } catch {
      /* not a URL after all — keep the raw text */
    }
  }
  return value.trim().toUpperCase();
}

export function KioskClient({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName: string;
}) {
  const t = useTranslations("kiosk");
  const tc = useTranslations("common");
  const locale = useLocale();
  const supabase = useMemo(() => createClient(), []);

  const [mode, setMode] = useState<Mode>("children");
  const [entry, setEntry] = useState<Entry>("keypad");
  const [code, setCodeState] = useState("");
  // A hardware reader fires its whole burst — every digit and the closing
  // Enter — inside one task, before React commits a single state update. The
  // Enter handler therefore cannot read `code`; it would see the value from
  // before the card was presented. This ref is written synchronously on every
  // keystroke so the submit always sees what was actually scanned.
  const codeRef = useRef("");
  const setCode = useCallback((next: string | ((c: string) => string)) => {
    const value = typeof next === "function" ? next(codeRef.current) : next;
    codeRef.current = value;
    setCodeState(value);
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [presentCount, setPresentCount] = useState(0);
  const [now, setNow] = useState<Date | null>(null);

  // The staff pad no longer asks for a direction up front: the code comes
  // first, then only the moves that are legal from that person's current state
  // are offered. Nobody has to know which button they are supposed to press,
  // and an impossible transition cannot be tapped in the first place.
  const [staffPick, setStaffPick] = useState<StaffPick | null>(null);
  // A guardian code opens the verification screen: the adult's face, then their
  // children. The guardian carried here is what gets attributed to every child.
  const [pickList, setPickList] = useState<{
    guardian: KioskGuardian;
    children: PickChild[];
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [childResult, setChildResult] = useState<ChildResult | null>(null);
  const [staffResult, setStaffResult] = useState<StaffResult | null>(null);
  const [pickupName, setPickupName] = useState("");
  const [pickupTouched, setPickupTouched] = useState(false);
  const [pickupSaving, setPickupSaving] = useState(false);
  // Scans the database refused. Until this is empty, nothing is confirmed.
  const [duplicateBatch, setDuplicateBatch] = useState<DuplicateBatch | null>(null);
  const [dupBusy, setDupBusy] = useState(false);

  // ----- live clock -----
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // ----- present count (poll every 30 s) -----
  const refreshPresent = useCallback(async () => {
    const { count } = await supabase
      .from("kg_attendance")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("date", toDateStr(new Date()))
      .not("check_in_at", "is", null)
      .is("check_out_at", null);
    if (typeof count === "number") setPresentCount(count);
  }, [supabase, tenantId]);

  useEffect(() => {
    const first = setTimeout(refreshPresent, 0);
    const id = setInterval(refreshPresent, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refreshPresent]);

  // ----- error display (shake + auto-clear) -----
  const showError = useCallback((msg: string) => {
    setError(msg);
    setShakeKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(id);
  }, [error, shakeKey]);

  const mapError = useCallback(
    (message: string) => {
      if (message.includes("unknown_tag") || message.includes("unknown_code"))
        showError(t("errors.unknownCode"));
      else if (message.includes("pickup_not_allowed")) showError(t("errors.pickupNotAllowed"));
      // The crèche is shut. Said plainly, because the person holding the tag is
      // standing at a door that is not open.
      else if (message.includes("closed_day")) showError(t("errors.closedDay"));
      else if (message.includes("outside_hours")) showError(t("errors.outsideHours"));
      else if (message.includes("already_clocked_in")) showError(t("errors.alreadyClockedIn"));
      else if (message.includes("already_on_break")) showError(t("errors.alreadyOnBreak"));
      else if (message.includes("not_on_break")) showError(t("errors.notOnBreak"));
      else if (message.includes("not_clocked_in")) showError(t("errors.notClockedIn"));
      else showError(t("errors.generic"));
    },
    [showError, t]
  );

  // ----- result dismissal -----
  const dismissChildResult = useCallback(() => {
    setChildResult(null);
    setPickupName("");
    setPickupTouched(false);
  }, []);

  useEffect(() => {
    if (!childResult || pickupTouched) return;
    // A verification card carries more to read than the old single-child one.
    const delay = childResult.guardian || childResult.entries.length > 1 ? 8000 : 5000;
    const id = setTimeout(dismissChildResult, delay);
    return () => clearTimeout(id);
  }, [childResult, pickupTouched, dismissChildResult]);

  useEffect(() => {
    if (!staffResult) return;
    const id = setTimeout(() => setStaffResult(null), 5000);
    return () => clearTimeout(id);
  }, [staffResult]);


  // ----- signed photo URLs -----
  const signPhotos = useCallback(
    async (paths: (string | null)[]): Promise<Record<string, string>> => {
      const wanted = [...new Set(paths.filter((p): p is string => !!p))];
      if (wanted.length === 0) return {};
      const { data } = await supabase.storage
        .from("kg-media")
        .createSignedUrls(wanted, 600);
      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
      }
      return map;
    },
    [supabase]
  );

  // ----- write one attendance row -----
  /**
   * Writes one child's row. Without `force` the write may be REFUSED: the kiosk
   * infers direction from today's row, so a second scan of a child already
   * inside used to be silently recorded as a departure. kg_checkin_by_tag now
   * reports the clash instead of guessing (migration 0027) and a human decides.
   */
  const recordChild = useCallback(
    async (
      child: KioskChild,
      guardianId: string | null,
      force?: Direction
    ): Promise<RecordOutcome> => {
      const date = toDateStr(new Date());
      const { data: att } = await supabase
        .from("kg_attendance")
        .select("check_in_at, check_out_at")
        .eq("tenant_id", tenantId)
        .eq("child_id", child.id)
        .eq("date", date)
        .maybeSingle();

      const direction: Direction =
        force ?? (att?.check_in_at && !att.check_out_at ? "out" : "in");
      let at = new Date().toISOString();

      if (child.tag_code) {
        // Always the full argument set — the 5- and 6-argument overloads are gone.
        const { data, error: rpcError } = await supabase.rpc("kg_checkin_by_tag", {
          p_tenant: tenantId,
          p_tag: child.tag_code,
          p_direction: direction,
          p_method: "kiosk",
          p_picked_up_by: null,
          // null when the child's own tag was scanned — the RPC verifies the
          // guardian is actually linked to this child before trusting it.
          p_guardian: guardianId,
          p_force: !!force,
        });
        if (rpcError) return { kind: "failed", message: rpcError.message };

        const payload = (data ?? {}) as CheckinPayload;
        if (payload.refused === true)
          return { kind: "refused", reason: payload.reason ?? "pickup_not_allowed" };
        if (payload.duplicate === true) {
          // NOTHING was written. Never treat this as a success.
          return {
            kind: "duplicate",
            reason: readReason(payload.reason, direction),
            checkInAt: payload.check_in_at ?? null,
            checkOutAt: payload.check_out_at ?? null,
          };
        }
        if (payload.at) at = payload.at;
        return { kind: "recorded", direction, at, viaRpc: true };
      }

      // No tag: no RPC to lean on, so we write the row ourselves. The guardian id
      // is safe to trust here because this branch is only ever reached from the
      // pick list, which is built from kg_child_guardians for that guardian.
      // The double-scan trap lives in the inference, not in the RPC, so the same
      // guard has to apply to tagless children too.
      if (!force) {
        const reason = localDuplicate(direction, att ?? null);
        if (reason)
          return {
            kind: "duplicate",
            reason,
            checkInAt: att?.check_in_at ?? null,
            checkOutAt: att?.check_out_at ?? null,
          };
      }

      const attribution =
        direction === "out" ? "checked_out_guardian_id" : "checked_in_guardian_id";

      if (!att) {
        const { error: insError } = await supabase.from("kg_attendance").insert({
          tenant_id: tenantId,
          child_id: child.id,
          date,
          status: "present",
          check_in_at: at,
          check_in_method: "kiosk",
          // Only reachable when a departure is forced onto a child with no row.
          ...(direction === "out" ? { check_out_at: at, check_out_method: "kiosk" } : {}),
          ...(guardianId
            ? direction === "out"
              ? { checked_out_guardian_id: guardianId }
              : { checked_in_guardian_id: guardianId }
            : {}),
        });
        if (insError) return { kind: "failed", message: insError.message };
        return { kind: "recorded", direction, at, viaRpc: false };
      }

      const patch: Record<string, unknown> =
        direction === "out"
          ? { status: "present", check_out_at: at, check_out_method: "kiosk" }
          : {
              status: "present",
              check_in_at: att.check_in_at ?? at,
              check_in_method: "kiosk",
            };
      // Only ever add attribution — a later child-tag scan must not wipe the
      // adult a guardian scan already recorded.
      if (guardianId) patch[attribution] = guardianId;

      const { error: updError } = await supabase
        .from("kg_attendance")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("child_id", child.id)
        .eq("date", date);
      if (updError) return { kind: "failed", message: updError.message };
      return { kind: "recorded", direction, at, viaRpc: false };
    },
    [supabase, tenantId]
  );

  /** Builds the one confirmation card, once every child in the batch is settled. */
  const finishBatch = useCallback(
    async (batch: {
      date: string;
      done: RecordedRow[];
      guardian: KioskGuardian | null;
      failedCount: number;
      knownPhotos: Record<string, string | null>;
      usedRpc: boolean;
    }) => {
      const { date, done, guardian, failedCount, knownPhotos, usedRpc } = batch;

      // The RPC's trigger queued the parents' notification, but no server action
      // ran, so nothing would flush the push queue. Deliberately not awaited.
      if (usedRpc) void flushPush();

      const ids = done.map((d) => d.child.id);
      const missingPhotos = done
        .filter((d) => !!d.child.photo_path && !knownPhotos[d.child.id])
        .map((d) => d.child.photo_path as string);

      const [allergyRes, signed] = await Promise.all([
        supabase
          .from("kg_child_allergies")
          .select("child_id, allergen")
          .eq("tenant_id", tenantId)
          .in("child_id", ids),
        signPhotos(missingPhotos),
      ]);

      const allergyMap: Record<string, string[]> = {};
      for (const row of (allergyRes.data ?? []) as { child_id: string; allergen: string }[]) {
        (allergyMap[row.child_id] ??= []).push(allergenLabel(row.allergen, tc));
      }

      const entries: CheckedEntry[] = done.map((d) => ({
        child: d.child,
        direction: d.direction,
        at: d.at,
        allergies: allergyMap[d.child.id] ?? [],
        photoUrl:
          knownPhotos[d.child.id] ??
          (d.child.photo_path ? (signed[d.child.photo_path] ?? null) : null),
      }));

      setPickList(null);
      setSelected([]);
      setPickupName("");
      setPickupTouched(false);
      setChildResult({ date, entries, failedCount, guardian });
      refreshPresent();
    },
    [supabase, tenantId, signPhotos, refreshPresent, tc]
  );

  /**
   * Records every chosen child against the SAME verified guardian, then builds
   * one confirmation card. Failures are counted, never swallowed. A child the
   * database refused is NOT a success and NOT a failure: the rest of the batch
   * is written and that child is queued for a human decision.
   */
  const recordChildren = useCallback(
    async (
      children: KioskChild[],
      guardian: KioskGuardian | null,
      knownPhotos: Record<string, string | null> = {}
    ) => {
      const date = toDateStr(new Date());
      const done: RecordedRow[] = [];
      const duplicates: DuplicateInfo[] = [];
      let failedCount = 0;
      let lastMessage = "";
      let usedRpc = false;

      for (const child of children) {
        const res = await recordChild(child, guardian?.id ?? null);
        if (res.kind === "recorded") {
          done.push({ child, direction: res.direction, at: res.at });
          if (res.viaRpc) usedRpc = true;
        } else if (res.kind === "refused") {
          // The tile should already have been blocked; this is the database
          // holding the line if it wasn't. Loud, specific, no write happened.
          failedCount += 1;
          lastMessage = res.reason;
        } else if (res.kind === "duplicate") {
          duplicates.push({
            child,
            photoUrl: knownPhotos[child.id] ?? null,
            reason: res.reason,
            checkInAt: res.checkInAt,
            checkOutAt: res.checkOutAt,
          });
        } else {
          failedCount += 1;
          lastMessage = res.message;
        }
      }

      if (done.length === 0 && duplicates.length === 0) {
        mapError(lastMessage || "generic");
        return;
      }

      if (duplicates.length > 0) {
        const missing = duplicates
          .filter((d) => !!d.child.photo_path && !d.photoUrl)
          .map((d) => d.child.photo_path as string);
        const signed = await signPhotos(missing);
        setPickList(null);
        setSelected([]);
        setPickupName("");
        setPickupTouched(false);
        setDuplicateBatch({
          queue: duplicates.map((d) => ({
            ...d,
            photoUrl:
              d.photoUrl ?? (d.child.photo_path ? (signed[d.child.photo_path] ?? null) : null),
          })),
          done,
          guardian,
          knownPhotos,
          failedCount,
          usedRpc,
          date,
          total: children.length,
        });
        // Whatever did go through is already on the roster — say so honestly.
        refreshPresent();
        return;
      }

      await finishBatch({ date, done, guardian, failedCount, knownPhotos, usedRpc });
    },
    [recordChild, mapError, signPhotos, refreshPresent, finishBatch]
  );

  /** Settles the duplicate at the head of the queue: skip it, or force the write. */
  const answerDuplicate = useCallback(
    async (force: boolean) => {
      if (dupBusy) return;
      const batch = duplicateBatch;
      const current = batch?.queue[0];
      if (!batch || !current) return;

      let next: DuplicateBatch = { ...batch, queue: batch.queue.slice(1) };
      if (force) {
        setDupBusy(true);
        try {
          const res = await recordChild(
            current.child,
            batch.guardian?.id ?? null,
            forceDirection(current.reason)
          );
          if (res.kind === "recorded") {
            next = {
              ...next,
              done: [
                ...next.done,
                { child: current.child, direction: res.direction, at: res.at },
              ],
              usedRpc: next.usedRpc || res.viaRpc,
              knownPhotos: { ...next.knownPhotos, [current.child.id]: current.photoUrl },
            };
          } else {
            // Forced and still not written — count it, never claim it worked.
            next = { ...next, failedCount: next.failedCount + 1 };
          }
        } catch {
          next = { ...next, failedCount: next.failedCount + 1 };
        } finally {
          setDupBusy(false);
        }
      }

      if (next.queue.length > 0) {
        setDuplicateBatch(next);
        return;
      }
      setDuplicateBatch(null);
      if (next.done.length === 0) {
        if (next.failedCount > 0) showError(t("errors.generic"));
        refreshPresent();
        return;
      }
      await finishBatch(next);
    },
    [duplicateBatch, dupBusy, recordChild, finishBatch, refreshPresent, showError, t]
  );

  /** Backdrop or Escape: every duplicate still queued counts as cancelled. */
  const cancelDuplicates = useCallback(async () => {
    if (dupBusy) return;
    const batch = duplicateBatch;
    if (!batch) return;
    setDuplicateBatch(null);
    if (batch.done.length === 0) {
      refreshPresent();
      return;
    }
    await finishBatch(batch);
  }, [duplicateBatch, dupBusy, finishBatch, refreshPresent]);

  // ----- code lookup (identical path for keypad, hardware scanner and camera) -----
  const submitChild = useCallback(
    async (value: string) => {
      // One lookup, one namespace. kg_credentials (0040) holds every printed
      // QR, every proximity card and every PIN under a single unique index, so
      // a scanned value can only ever mean one person — the kiosk no longer
      // has to try tables in a fixed order and hope they never collide.
      const { data: resolved, error: resolveError } = await supabase.rpc(
        "kg_resolve_credential",
        { p_tenant: tenantId, p_value: value }
      );
      if (resolveError) {
        mapError(resolveError.message);
        return;
      }
      const hit = (resolved ?? {}) as {
        found?: boolean;
        subject_type?: "child" | "guardian" | "staff";
        subject_id?: string;
      };
      if (!hit.found || !hit.subject_id) {
        showError(t("errors.unknownCode"));
        return;
      }
      if (hit.subject_type === "staff") {
        // A real badge, just at the wrong pad. Name the mistake instead of
        // calling a valid card unknown.
        showError(t("errors.staffCodeHere"));
        return;
      }

      if (hit.subject_type === "child") {
        const { data: childRow } = await supabase
          .from("kg_children")
          .select(CHILD_SELECT)
          .eq("tenant_id", tenantId)
          .eq("status", "enrolled")
          .eq("id", hit.subject_id)
          .limit(1);
        const childMatch = (childRow ?? []) as unknown as KioskChild[];
        if (childMatch.length === 0) {
          showError(t("errors.unknownCode"));
          return;
        }
        // A child's own tag says nothing about the adult holding it. Record it
        // with no attribution and say so plainly on the confirmation.
        setCode("");
        await recordChildren(childMatch, null);
        return;
      }

      // A guardian credential: this identifies the ADULT at the door.
      const { data: guardianRows, error: guardianError } = await supabase
        .from("kg_guardians")
        .select(GUARDIAN_SELECT)
        .eq("tenant_id", tenantId)
        .eq("id", hit.subject_id)
        .limit(1);
      if (guardianError) {
        mapError(guardianError.message);
        return;
      }

      const guardians = (guardianRows ?? []) as unknown as Omit<KioskGuardian, "photoUrl">[];
      if (guardians.length === 0) {
        showError(t("errors.unknownCode"));
        return;
      }

      const guardianRow = guardians[0];
      const { data: links } = await supabase
        .from("kg_child_guardians")
        .select("child_id, can_pickup")
        .eq("guardian_id", guardianRow.id);
      const linkRows = (links ?? []) as { child_id: string; can_pickup: boolean }[];
      // can_pickup rides with the link, not the child: the same child can have
      // one parent who collects and one who only drops off.
      const pickupByChild: Record<string, boolean> = {};
      for (const l of linkRows) pickupByChild[l.child_id] = l.can_pickup;
      const childIds = [...new Set(linkRows.map((l) => l.child_id))];
      if (childIds.length === 0) {
        showError(t("errors.noChildren"));
        return;
      }

      const { data: kids } = await supabase
        .from("kg_children")
        .select(CHILD_SELECT)
        .eq("tenant_id", tenantId)
        .eq("status", "enrolled")
        .in("id", childIds)
        .order("first_name");
      const children = (kids ?? []) as unknown as KioskChild[];
      if (children.length === 0) {
        showError(t("errors.noChildren"));
        return;
      }

      const date = toDateStr(new Date());
      const [attRes, photoMap] = await Promise.all([
        supabase
          .from("kg_attendance")
          .select("child_id, check_in_at, check_out_at")
          .eq("tenant_id", tenantId)
          .eq("date", date)
          .in(
            "child_id",
            children.map((c) => c.id)
          ),
        signPhotos([guardianRow.photo_path, ...children.map((c) => c.photo_path)]),
      ]);

      const attMap: Record<string, { check_in_at: string | null; check_out_at: string | null }> =
        {};
      for (const row of (attRes.data ?? []) as {
        child_id: string;
        check_in_at: string | null;
        check_out_at: string | null;
      }[]) {
        attMap[row.child_id] = { check_in_at: row.check_in_at, check_out_at: row.check_out_at };
      }

      const picks: PickChild[] = children.map((child) => {
        const att = attMap[child.id];
        return {
          child,
          photoUrl: child.photo_path ? (photoMap[child.photo_path] ?? null) : null,
          direction: att?.check_in_at && !att.check_out_at ? "out" : "in",
          checkInAt: att?.check_in_at ?? null,
          canPickup: pickupByChild[child.id] ?? false,
        };
      });

      setCode("");
      // A blocked tile (departure without pickup permission) is never
      // pre-selected — not even for an only child.
      const preselect =
        picks.length === 1 && (picks[0].direction === "in" || picks[0].canPickup);
      setSelected(preselect ? [picks[0].child.id] : []);
      setPickList({
        guardian: {
          ...guardianRow,
          photoUrl: guardianRow.photo_path ? (photoMap[guardianRow.photo_path] ?? null) : null,
        },
        children: picks,
      });
    },
    [supabase, tenantId, mapError, showError, t, signPhotos, recordChildren, setCode]
  );

  const submitStaff = useCallback(
    async (value: string) => {
      const { data, error: rpcError } = await supabase.rpc("kg_staff_clock_state", {
        p_tenant: tenantId,
        p_code: value,
      });
      if (rpcError) {
        mapError(rpcError.message);
        return;
      }
      const st = (data ?? {}) as {
        staff_name?: string;
        state?: StaffState;
        clock_in_at?: string | null;
        break_start_at?: string | null;
        break_minutes?: number | string | null;
        pay_type?: "monthly" | "hourly";
        lunch_allowance_minutes?: number | string | null;
      };
      setCode("");
      setStaffPick({
        code: value,
        name: st.staff_name ?? "",
        state: st.state ?? "off",
        clockInAt: st.clock_in_at ?? null,
        breakStartAt: st.break_start_at ?? null,
        breakMinutes: Number(st.break_minutes ?? 0),
        payType: st.pay_type ?? "monthly",
        lunchAllowance: Number(st.lunch_allowance_minutes ?? 60),
      });
    },
    [supabase, tenantId, mapError, setCode]
  );

  /** Commits the move the person chose. The database re-checks it regardless. */
  const runStaffAction = useCallback(
    async (action: StaffAction) => {
      const pick = staffPick;
      if (!pick || busy) return;
      setBusy(true);
      try {
        const { data, error: rpcError } = await supabase.rpc("kg_staff_clock_by_code", {
          p_tenant: tenantId,
          p_code: pick.code,
          p_direction: action,
        });
        if (rpcError) {
          setStaffPick(null);
          mapError(rpcError.message);
          return;
        }
        const ts = (data ?? {}) as {
          staff_name?: string;
          clock_in_at?: string | null;
          clock_out_at?: string | null;
          break_start_at?: string | null;
          break_minutes?: number | string | null;
          unpaid_break_minutes?: number | string | null;
        };
        const at =
          action === "in"
            ? ts.clock_in_at
            : action === "out"
              ? ts.clock_out_at
              : action === "break_start"
                ? ts.break_start_at
                : null;
        setStaffPick(null);
        setStaffResult({
          name: ts.staff_name ?? pick.name,
          action,
          at: at ?? new Date().toISOString(),
          breakMinutes: Number(ts.break_minutes ?? 0),
          unpaidBreakMinutes: Number(ts.unpaid_break_minutes ?? 0),
        });
        refreshPresent();
      } catch {
        showError(t("errors.generic"));
      } finally {
        setBusy(false);
      }
    },
    [staffPick, busy, supabase, tenantId, mapError, showError, t, refreshPresent]
  );

  const runValue = useCallback(
    async (raw: string) => {
      const value = normalizeScan(raw);
      if (!value || busy) return;
      if (!CODE_RE.test(value)) {
        showError(t("errors.unknownCode"));
        return;
      }
      setBusy(true);
      try {
        if (mode === "children") await submitChild(value);
        else await submitStaff(value);
      } catch {
        showError(t("errors.generic"));
      } finally {
        setBusy(false);
      }
    },
    [busy, mode, submitChild, submitStaff, showError, t]
  );

  const submit = useCallback(() => {
    void runValue(codeRef.current);
  }, [runValue]);

  // ----- physical keyboard / badge scanner support -----
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);
  const overlayOpen = !!(childResult || staffResult || pickList || duplicateBatch || staffPick);
  const overlayRef = useRef(overlayOpen);
  useEffect(() => {
    overlayRef.current = overlayOpen;
  }, [overlayOpen]);

  const closePickList = useCallback(() => {
    setPickList(null);
    setSelected([]);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (overlayRef.current) {
        if (e.key === "Escape") {
          closePickList();
          setStaffPick(null);
          setStaffResult(null);
          dismissChildResult();
          // Escape is the cautious answer: nothing extra gets written.
          void cancelDuplicates();
        }
        return;
      }
      if (e.key === "Enter") submitRef.current();
      else if (e.key === "Backspace") setCode((c) => c.slice(0, -1));
      else if (/^[a-zA-Z0-9-]$/.test(e.key))
        setCode((c) => (c + e.key.toUpperCase()).slice(0, 16));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissChildResult, closePickList, cancelDuplicates, setCode]);

  // A verification screen left open shows one family's children to the next
  // person in the queue. Abandoned overlays clear themselves: the pick list
  // after 60s without a tap, the duplicate question after 120s (it is a human
  // decision, so it gets longer — cancelling records nothing either way).
  useEffect(() => {
    if (!pickList) return;
    const id = setTimeout(closePickList, 60_000);
    return () => clearTimeout(id);
    // `selected` in the deps restarts the countdown on every tap.
  }, [pickList, selected, closePickList]);

  useEffect(() => {
    if (!duplicateBatch) return;
    const id = setTimeout(() => void cancelDuplicates(), 120_000);
    return () => clearTimeout(id);
  }, [duplicateBatch, cancelDuplicates]);

  useEffect(() => {
    if (!staffPick) return;
    const id = setTimeout(() => setStaffPick(null), 45_000);
    return () => clearTimeout(id);
  }, [staffPick]);

  // ----- multi-select confirm -----
  const toggleChild = useCallback((childId: string) => {
    setSelected((s) => (s.includes(childId) ? s.filter((i) => i !== childId) : [...s, childId]));
  }, []);

  const confirmSelection = useCallback(async () => {
    if (!pickList || busy) return;
    const chosen = pickList.children.filter((p) => selected.includes(p.child.id));
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      await recordChildren(
        chosen.map((p) => p.child),
        pickList.guardian,
        Object.fromEntries(pickList.children.map((p) => [p.child.id, p.photoUrl]))
      );
    } catch {
      showError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }, [pickList, selected, busy, recordChildren, showError, t]);

  // ----- pickup name save (fallback path only: no adult was identified) -----
  const savePickup = useCallback(async () => {
    if (!childResult || childResult.entries.length !== 1) return;
    setPickupSaving(true);
    await supabase
      .from("kg_attendance")
      .update({ picked_up_by: pickupName.trim() || null })
      .eq("tenant_id", tenantId)
      .eq("child_id", childResult.entries[0].child.id)
      .eq("date", childResult.date);
    setPickupSaving(false);
    dismissChildResult();
  }, [childResult, pickupName, supabase, tenantId, dismissChildResult]);

  // ----- display helpers -----
  const timeFmt = (iso: string) => formatTime(iso, locale);
  const clockLabel = now
    ? new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now)
    : "--:--:--";
  const dateLabel = now
    ? new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(now)
    : "";

  const childNames = (child: KioskChild): { primary: string; secondary: string | null } => {
    const primary = childDisplayName(child, locale);
    const latin = `${child.first_name} ${child.last_name}`;
    const arabic =
      child.first_name_ar && child.last_name_ar
        ? `${child.first_name_ar} ${child.last_name_ar}`
        : null;
    const secondary = locale === "ar" ? latin : arabic;
    return { primary, secondary: secondary === primary ? null : secondary };
  };

  const klassName = (child: KioskChild): string | null => {
    if (!child.kg_classes) return null;
    return locale === "ar" && child.kg_classes.name_ar
      ? child.kg_classes.name_ar
      : child.kg_classes.name;
  };

  const guardianName = (g: KioskGuardian) => `${g.first_name} ${g.last_name}`.trim();
  const relationshipLabel = (relationship: string) =>
    t(`relationships.${RELATIONSHIPS.includes(relationship) ? relationship : "other"}`);

  const selectedCount = selected.length;

  return (
    <div className="relative flex h-full flex-col">
      <style>{`@keyframes kiosk-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-10px)}40%{transform:translateX(10px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}`}</style>

      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card/40 px-5 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold sm:text-xl">{tenantName}</h1>
          <span className="mt-1 inline-flex items-center gap-2 rounded-full bg-success/15 px-3 py-0.5 text-sm font-semibold text-success">
            <span className="size-2 animate-pulse rounded-full bg-success" />
            {t("presentCount", { count: presentCount })}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Every adult at this door reads one of three scripts. Native names,
              no flags (a flag names a country, not a language). */}
          <div className="flex items-center gap-1 rounded-2xl border border-border bg-card p-1">
            {(
              [
                ["ar", "العربية"],
                ["en", "English"],
                ["fr", "Français"],
              ] as const
            ).map(([code, label]) => (
              <button
                key={code}
                type="button"
                lang={code}
                aria-pressed={locale === code}
                onClick={() => setLocale(code)}
                className={cn(
                  "min-h-9 rounded-xl px-2.5 text-xs font-semibold transition-colors",
                  locale === code
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="text-end">
            <div
              className="font-mono text-3xl font-bold tabular-nums sm:text-4xl"
              suppressHydrationWarning
            >
              {clockLabel}
            </div>
            <div className="text-xs text-muted-foreground" suppressHydrationWarning>
              {dateLabel}
            </div>
          </div>
          <Link
            href="/dashboard"
            aria-label={t("exit")}
            title={t("exit")}
            className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </Link>
        </div>
      </header>

      {/* Main pad */}
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-4 py-5">
        {/* Keypad ↔ camera. The keypad never goes away: it is the fallback when a
            camera fails, and hardware barcode scanners type straight into it. */}
        <div className="grid w-full max-w-sm grid-cols-2 gap-2 rounded-2xl border border-border bg-card/60 p-1">
          {(["keypad", "scan"] as Entry[]).map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={entry === e}
              onClick={() => setEntry(e)}
              className={cn(
                "flex h-12 items-center justify-center gap-2 rounded-xl text-base font-semibold transition-colors",
                entry === e
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {e === "keypad" ? <Keyboard className="size-5" /> : <ScanLine className="size-5" />}
              {t(`input.${e}`)}
            </button>
          ))}
        </div>

        <p className="text-center text-base text-muted-foreground sm:text-lg">
          {mode === "children" ? t("children.prompt") : t("staff.prompt")}
        </p>

        {/* Code display — also the readout for hardware scanners in scan mode */}
        <div
          key={shakeKey}
          className={cn(
            "flex h-16 w-full max-w-sm items-center justify-center rounded-2xl border-2 bg-card font-mono text-3xl font-bold tracking-[0.2em] shadow-sm sm:h-18 sm:text-4xl",
            error ? "border-destructive" : "border-border",
            error && "[animation:kiosk-shake_0.4s_ease-in-out]"
          )}
          dir="ltr"
        >
          {code || <span className="text-muted-foreground/60">{t("children.hint")}</span>}
          {code && <span className="ms-1 animate-pulse text-primary">|</span>}
        </div>

        <div aria-live="polite" className="min-h-6 text-center">
          {error && (
            <p className="flex items-center gap-2 text-base font-bold text-destructive">
              <TriangleAlert className="size-5" />
              {error}
            </p>
          )}
        </div>

        {entry === "keypad" ? (
          <KioskKeypad
            onKey={(k) => setCode((c) => (c + k).slice(0, 16))}
            onBackspace={() => setCode((c) => c.slice(0, -1))}
            onClear={() => setCode("")}
            onSubmit={submit}
            disabled={busy}
          />
        ) : (
          <KioskScanner
            paused={overlayOpen || busy}
            onScan={(text) => void runValue(text)}
            onFallback={() => setEntry("keypad")}
          />
        )}
      </main>

      {/* Bottom mode tabs */}
      <nav className="grid shrink-0 grid-cols-2 border-t border-border">
        {(["children", "staff"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              setCode("");
              setError(null);
            }}
            className={cn(
              "relative flex h-18 flex-col items-center justify-center gap-1 text-sm font-semibold transition-colors sm:h-20 sm:text-base",
              mode === m
                ? "bg-card text-primary"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            {mode === m && <span className="absolute inset-x-0 top-0 h-1 bg-primary" />}
            {m === "children" ? <Baby className="size-7" /> : <Users className="size-7" />}
            {t(`modes.${m}`)}
          </button>
        ))}
      </nav>

      {/* Guardian verification — the adult's face, then their children */}
      {pickList && (
        <div className="absolute inset-0 z-20 flex justify-center overflow-y-auto bg-background/95 p-4 backdrop-blur-sm sm:p-6">
          <div className="my-auto w-full max-w-2xl rounded-3xl border border-border bg-card p-5 shadow-2xl sm:p-6">
            <div className="flex items-center gap-4 rounded-2xl border border-primary/25 bg-primary/5 p-4">
              <GuardianFace guardian={pickList.guardian} size="lg" />
              <div className="min-w-0 flex-1 text-start">
                <p className="text-xs font-bold tracking-wide text-primary uppercase">
                  {t("verify.adultLabel")}
                </p>
                <h2 className="truncate text-2xl font-bold sm:text-3xl">
                  {guardianName(pickList.guardian)}
                </h2>
                <p className="text-base text-muted-foreground">
                  {relationshipLabel(pickList.guardian.relationship)}
                </p>
                {!pickList.guardian.photoUrl && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-warning-ink">
                    <TriangleAlert className="size-4 shrink-0" />
                    {t("verify.noPhoto")}
                  </p>
                )}
              </div>
            </div>
            <p className="mt-3 text-center text-sm text-muted-foreground">
              {t("verify.subtitle")}
            </p>

            <div className="mt-5 mb-3 flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold">{t("verify.chooseChildren")}</h3>
              {pickList.children.length > 1 && (() => {
                // "Select all" must never sweep in a child this adult cannot
                // take out of the building.
                const selectable = pickList.children
                  .filter((p) => p.direction === "in" || p.canPickup)
                  .map((p) => p.child.id);
                return (
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(selectedCount === selectable.length ? [] : selectable)
                    }
                    className="min-h-11 rounded-xl px-3 text-sm font-semibold text-primary hover:bg-primary/10"
                  >
                    {selectedCount === selectable.length && selectable.length > 0
                      ? t("verify.clearAll")
                      : t("verify.selectAll")}
                  </button>
                );
              })()}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {pickList.children.map((pick) => {
                const names = childNames(pick.child);
                const isSelected = selected.includes(pick.child.id);
                // Departure without pickup permission: the tile is visible —
                // staff must SEE why it cannot be tapped — but inert. Drop-off
                // (direction "in") stays open to any linked adult.
                const blocked = pick.direction === "out" && !pick.canPickup;
                return (
                  <button
                    key={pick.child.id}
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-disabled={blocked || undefined}
                    disabled={busy || blocked}
                    onClick={() => toggleChild(pick.child.id)}
                    className={cn(
                      "flex min-h-22 items-center gap-3 rounded-2xl border-2 p-3 text-start transition-transform active:scale-[0.98] disabled:opacity-50",
                      blocked
                        ? "border-destructive/40 bg-destructive/5 opacity-100!"
                        : isSelected
                          ? "border-primary bg-primary/10"
                          : "border-border bg-secondary hover:border-primary/40"
                    )}
                  >
                    {pick.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={pick.photoUrl}
                        alt=""
                        className="size-16 shrink-0 rounded-2xl object-cover"
                      />
                    ) : (
                      <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-xl font-bold text-primary">
                        {initials(pick.child.first_name, pick.child.last_name)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-lg font-bold">{names.primary}</span>
                      {names.secondary && (
                        <span className="block truncate text-sm text-muted-foreground">
                          {names.secondary}
                        </span>
                      )}
                      {blocked ? (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive-solid">
                          <Ban className="size-3.5" />
                          {t("verify.noPickup")}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold",
                            pick.direction === "in"
                              ? "bg-success/15 text-success"
                              : "bg-gold/15 text-gold-ink"
                          )}
                        >
                          {pick.direction === "in" ? (
                            <LogIn className="size-3.5 rtl:-scale-x-100" />
                          ) : (
                            <LogOut className="size-3.5 rtl:-scale-x-100" />
                          )}
                          {pick.direction === "in"
                            ? t("verify.willCheckIn")
                            : t("verify.arrivedAt", {
                                time: pick.checkInAt ? timeFmt(pick.checkInAt) : "",
                              })}
                        </span>
                      )}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full border-2",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border"
                      )}
                    >
                      {isSelected && <Check className="size-4" />}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={closePickList}
                disabled={busy}
                className="h-14 w-full rounded-2xl border border-border bg-muted text-base font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                {t("actions.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void confirmSelection()}
                disabled={busy || selectedCount === 0}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-transform active:scale-95 disabled:opacity-40"
              >
                {busy ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
                {t("verify.confirmCount", { count: selectedCount })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* A refused scan — the record already says something else, so we ask */}
      {duplicateBatch && duplicateBatch.queue.length > 0 && (
        <DuplicateCard
          batch={duplicateBatch}
          busy={dupBusy}
          t={t}
          timeFmt={timeFmt}
          childNames={childNames}
          klassName={klassName}
          onCancel={() => void answerDuplicate(false)}
          onCancelAll={() => void cancelDuplicates()}
          onForce={() => void answerDuplicate(true)}
        />
      )}

      {/* Confirmation — guardian face beside the child's, or an honest "no adult" */}
      {childResult && (
        <ChildResultCard
          result={childResult}
          onDismiss={dismissChildResult}
          t={t}
          timeFmt={timeFmt}
          childNames={childNames}
          klassName={klassName}
          guardianName={guardianName}
          relationshipLabel={relationshipLabel}
          pickup={{
            name: pickupName,
            saving: pickupSaving,
            touched: pickupTouched,
            setName: (v: string) => {
              setPickupName(v);
              setPickupTouched(true);
            },
            touch: () => setPickupTouched(true),
            save: () => void savePickup(),
          }}
        />
      )}

      {/* Staff confirmation card */}
      {staffPick && (
        <div
          className="absolute inset-0 z-40 flex justify-center overflow-y-auto bg-background/95 p-4 backdrop-blur-md sm:p-6"
          onClick={() => !busy && setStaffPick(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="kiosk-staff-title"
            onClick={(e) => e.stopPropagation()}
            className="my-auto w-full max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-2xl"
          >
            <h2 id="kiosk-staff-title" className="text-3xl font-bold">
              {staffPick.name}
            </h2>

            {/* Where the day stands, so the choice below is obvious. */}
            <p className="mt-2 text-base font-semibold text-muted-foreground">
              {staffPick.state === "on_break" && staffPick.breakStartAt
                ? t("staff.onBreakSince", { time: timeFmt(staffPick.breakStartAt) })
                : staffPick.state === "on_clock" && staffPick.clockInAt
                  ? t("staff.onClockSince", { time: timeFmt(staffPick.clockInAt) })
                  : t("staff.offToday")}
            </p>
            {staffPick.breakMinutes > 0 && (
              <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                {t("staff.breakSoFar", { minutes: Math.round(staffPick.breakMinutes) })}
              </p>
            )}

            <p className="mt-5 text-sm font-semibold text-muted-foreground">
              {t("staff.whatNow")}
            </p>

            {/* Only the moves that are legal from here. The database checks
                again, but nothing invalid is ever reachable by tapping. */}
            <div className="mt-3 grid gap-2">
              {staffPick.state === "off" && (
                <StaffActionButton
                  tone="in"
                  icon={<LogIn className="size-6 rtl:-scale-x-100" />}
                  label={t("staff.in")}
                  busy={busy}
                  onClick={() => void runStaffAction("in")}
                />
              )}
              {staffPick.state === "on_clock" && (
                <>
                  <StaffActionButton
                    tone="break"
                    icon={<Coffee className="size-6" />}
                    label={t("staff.breakStart")}
                    busy={busy}
                    onClick={() => void runStaffAction("break_start")}
                  />
                  <StaffActionButton
                    tone="out"
                    icon={<LogOut className="size-6 rtl:-scale-x-100" />}
                    label={t("staff.endDay")}
                    busy={busy}
                    onClick={() => void runStaffAction("out")}
                  />
                </>
              )}
              {staffPick.state === "on_break" && (
                <>
                  <StaffActionButton
                    tone="in"
                    icon={<LogIn className="size-6 rtl:-scale-x-100" />}
                    label={t("staff.breakEnd")}
                    busy={busy}
                    onClick={() => void runStaffAction("break_end")}
                  />
                  {/* Someone whose shift ends at the end of their break should
                      not have to clock back in just to clock straight out. */}
                  <StaffActionButton
                    tone="out"
                    icon={<LogOut className="size-6 rtl:-scale-x-100" />}
                    label={t("staff.endDay")}
                    busy={busy}
                    onClick={() => void runStaffAction("out")}
                  />
                </>
              )}
            </div>

            {/* The rule that applies to THIS contract, stated before the tap.
                A salaried lunch inside the allowance is paid time; an hourly
                one never is. */}
            <p className="mt-4 text-xs text-muted-foreground">
              {staffPick.payType === "hourly"
                ? t("staff.unpaidNote")
                : t("staff.allowanceNote", { minutes: staffPick.lunchAllowance })}
            </p>

            <button
              type="button"
              onClick={() => setStaffPick(null)}
              disabled={busy}
              className="mt-4 h-12 w-full rounded-2xl border border-border bg-muted text-base font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              {t("actions.cancel")}
            </button>
          </div>
        </div>
      )}

      {staffResult && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-background/90 p-6 backdrop-blur-md"
          onClick={() => setStaffResult(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "w-full max-w-md rounded-3xl border-2 bg-gradient-to-b p-8 text-center shadow-2xl",
              staffResult.action === "in" || staffResult.action === "break_end"
                ? "border-success/60 from-success/25 to-card shadow-success/10"
                : "border-gold/60 from-gold/25 to-card shadow-gold/10"
            )}
          >
            {/* Arriving and coming back from a break both put someone back on
                the clock, so they share the green treatment; leaving and going
                on a break both take them off it. */}
            <span
              className={cn(
                "mx-auto flex size-20 items-center justify-center rounded-full ring-4",
                staffResult.action === "in" || staffResult.action === "break_end"
                  ? "bg-success/20 ring-success/40"
                  : "bg-gold/20 ring-gold/40"
              )}
            >
              {staffResult.action === "break_start" ? (
                <Coffee className="size-10 text-gold-ink" />
              ) : staffResult.action === "out" ? (
                <LogOut className="size-10 text-gold-ink rtl:-scale-x-100" />
              ) : (
                <LogIn className="size-10 text-success rtl:-scale-x-100" />
              )}
            </span>
            <h2 className="mt-4 text-3xl font-bold">{staffResult.name}</h2>
            <p
              className={cn(
                "mt-3 text-2xl font-bold",
                staffResult.action === "in" || staffResult.action === "break_end"
                  ? "text-success"
                  : "text-gold-ink"
              )}
            >
              {staffResult.action === "in"
                ? t("staff.clockedIn", { time: timeFmt(staffResult.at) })
                : staffResult.action === "out"
                  ? t("staff.clockedOut", { time: timeFmt(staffResult.at) })
                  : staffResult.action === "break_start"
                    ? t("staff.breakStarted", { time: timeFmt(staffResult.at) })
                    : t("staff.breakEnded", {
                        time: timeFmt(staffResult.at),
                        minutes: Math.round(staffResult.breakMinutes),
                      })}
            </p>
            {/* On the way out, say what was deducted — a payslip surprise a
                month later is how trust in the clock gets lost. */}
            {staffResult.action === "out" && staffResult.breakMinutes > 0 && (
              <p className="mt-2 text-sm text-muted-foreground tabular-nums">
                {staffResult.unpaidBreakMinutes > 0
                  ? t("staff.breakDeducted", {
                      total: Math.round(staffResult.breakMinutes),
                      unpaid: Math.round(staffResult.unpaidBreakMinutes),
                    })
                  : t("staff.breakCovered", {
                      minutes: Math.round(staffResult.breakMinutes),
                    })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function GuardianFace({
  guardian,
  size,
}: {
  guardian: KioskGuardian;
  size: "lg" | "md";
}) {
  const box = size === "lg" ? "size-24 sm:size-28" : "size-14";
  const ring = "ring-4 ring-primary/30";
  if (guardian.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={guardian.photoUrl}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", box, ring)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-bold text-primary",
        box,
        ring,
        size === "lg" ? "text-3xl" : "text-lg"
      )}
    >
      {initials(guardian.first_name, guardian.last_name) || <UserRound className="size-8" />}
    </span>
  );
}

function ChildFace({
  entry,
  size,
  tone,
}: {
  entry: CheckedEntry;
  size: "lg" | "md";
  tone: Direction;
}) {
  const box = size === "lg" ? "size-24 sm:size-28" : "size-14";
  const ring = tone === "in" ? "ring-4 ring-success/50" : "ring-4 ring-gold/50";
  if (entry.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={entry.photoUrl}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", box, ring)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold",
        box,
        ring,
        size === "lg" ? "text-3xl" : "text-lg",
        tone === "in" ? "bg-success/20 text-success" : "bg-gold/20 text-gold-ink"
      )}
    >
      {initials(entry.child.first_name, entry.child.last_name)}
    </span>
  );
}

/**
 * The stop sign. A parent scanning twice at the door used to mark their child
 * as collected and gone, so nothing is written until someone answers this.
 * Cancelling is the big, obvious button: the common case really is an accident.
 */
function DuplicateCard({
  batch,
  busy,
  t,
  timeFmt,
  childNames,
  klassName,
  onCancel,
  onCancelAll,
  onForce,
}: {
  batch: DuplicateBatch;
  busy: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
  timeFmt: (iso: string) => string;
  childNames: (child: KioskChild) => { primary: string; secondary: string | null };
  klassName: (child: KioskChild) => string | null;
  onCancel: () => void;
  onCancelAll: () => void;
  onForce: () => void;
}) {
  const current = batch.queue[0];
  if (!current) return null;

  const names = childNames(current.child);
  const klass = klassName(current.child);
  const direction = forceDirection(current.reason);
  const stillQueued = batch.queue.length - 1;

  return (
    <div
      className="absolute inset-0 z-40 flex justify-center overflow-y-auto bg-background/95 p-4 backdrop-blur-md sm:p-6"
      onClick={() => !busy && onCancelAll()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kiosk-duplicate-title"
        onClick={(e) => e.stopPropagation()}
        className="my-auto w-full max-w-lg rounded-3xl border-2 border-warning/60 bg-gradient-to-b from-warning/20 to-card p-5 text-center shadow-2xl shadow-warning/10 sm:p-7"
      >
        <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-warning/20 ring-4 ring-warning/40">
          <TriangleAlert className="size-9 text-warning-ink" />
        </span>
        <h2 id="kiosk-duplicate-title" className="mt-4 text-2xl font-bold sm:text-3xl">
          {t("duplicate.title")}
        </h2>

        {/* Who this is about, and what the record already says about them */}
        <div className="mt-5 flex items-center gap-4 rounded-2xl border border-border bg-card/80 p-3 text-start">
          {current.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.photoUrl}
              alt=""
              className="size-20 shrink-0 rounded-2xl object-cover ring-4 ring-warning/40"
            />
          ) : (
            <span className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-warning/20 text-2xl font-bold text-warning-ink ring-4 ring-warning/40">
              {initials(current.child.first_name, current.child.last_name)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold sm:text-2xl">{names.primary}</p>
            {names.secondary && (
              <p className="truncate text-sm text-muted-foreground">{names.secondary}</p>
            )}
            {klass && (
              <p className="truncate text-sm text-muted-foreground">
                {t("children.class")} : {klass}
              </p>
            )}
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-bold">
              {current.checkInAt && (
                <span className="inline-flex items-center gap-1.5 text-success">
                  <LogIn className="size-4 shrink-0 rtl:-scale-x-100" />
                  {t("duplicate.arrivedAt", { time: timeFmt(current.checkInAt) })}
                </span>
              )}
              {current.checkOutAt && (
                <span className="inline-flex items-center gap-1.5 text-gold-ink">
                  <LogOut className="size-4 shrink-0 rtl:-scale-x-100" />
                  {t("duplicate.leftAt", { time: timeFmt(current.checkOutAt) })}
                </span>
              )}
            </p>
          </div>
        </div>

        <p className="mt-4 text-lg font-semibold text-foreground sm:text-xl">
          {t(`duplicate.reasons.${current.reason}`, { name: names.primary })}
        </p>

        {/* Siblings in the same scan really were recorded — say how many. */}
        {batch.total > 1 && (
          <p className="mt-3 text-sm text-muted-foreground">
            {t("duplicate.partial", { recorded: batch.done.length, total: batch.total })}
          </p>
        )}
        {stillQueued > 0 && (
          <p className="mt-1 text-sm font-semibold text-warning-ink">
            {t("duplicate.remaining", { count: stillQueued })}
          </p>
        )}
        {batch.failedCount > 0 && (
          <p className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive">
            <TriangleAlert className="size-5 shrink-0" />
            {t("result.partialFailure", { count: batch.failedCount })}
          </p>
        )}

        <div className="mt-6 grid gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-transform active:scale-95 disabled:opacity-50"
          >
            <X className="size-6 shrink-0" />
            {t("duplicate.cancel")}
          </button>
          <button
            type="button"
            onClick={onForce}
            disabled={busy}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-transparent text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : direction === "in" ? (
              <LogIn className="size-4 shrink-0 rtl:-scale-x-100" />
            ) : (
              <LogOut className="size-4 shrink-0 rtl:-scale-x-100" />
            )}
            {direction === "in"
              ? current.reason === "returned"
                ? t("duplicate.forceReturn")
                : t("duplicate.forceIn")
              : t("duplicate.forceOut")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChildResultCard({
  result,
  onDismiss,
  t,
  timeFmt,
  childNames,
  klassName,
  guardianName,
  relationshipLabel,
  pickup,
}: {
  result: ChildResult;
  onDismiss: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  timeFmt: (iso: string) => string;
  childNames: (child: KioskChild) => { primary: string; secondary: string | null };
  klassName: (child: KioskChild) => string | null;
  guardianName: (g: KioskGuardian) => string;
  relationshipLabel: (relationship: string) => string;
  pickup: {
    name: string;
    saving: boolean;
    touched: boolean;
    setName: (v: string) => void;
    touch: () => void;
    save: () => void;
  };
}) {
  const { entries, guardian, failedCount } = result;
  const tone: Direction = entries.every((e) => e.direction === "out") ? "out" : "in";
  const single = entries.length === 1 ? entries[0] : null;
  // Only the fallback path needs a typed name: with a guardian identified the
  // RPC already recorded who collected the child.
  const askPickup = !!single && !guardian && single.direction === "out";

  return (
    <div
      className="absolute inset-0 z-30 flex justify-center overflow-y-auto bg-background/90 p-4 backdrop-blur-md sm:p-6"
      onClick={() => !pickup.touched && onDismiss()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "my-auto w-full max-w-lg rounded-3xl border-2 bg-gradient-to-b p-5 text-center shadow-2xl sm:p-7",
          tone === "in"
            ? "border-success/60 from-success/25 to-card shadow-success/10"
            : "border-gold/60 from-gold/25 to-card shadow-gold/10"
        )}
      >
        {single ? (
          <>
            {/* The two faces side by side — the whole point of the door check. */}
            <div className="flex items-start justify-center gap-5">
              {guardian && (
                <div className="flex flex-col items-center gap-2">
                  <GuardianFace guardian={guardian} size="lg" />
                  <span className="text-xs font-bold tracking-wide text-primary uppercase">
                    {t("result.adult")}
                  </span>
                  <span className="max-w-32 truncate text-sm font-semibold">
                    {guardianName(guardian)}
                  </span>
                </div>
              )}
              <div className="flex flex-col items-center gap-2">
                <ChildFace entry={single} size="lg" tone={tone} />
                <span
                  className={cn(
                    "text-xs font-bold tracking-wide uppercase",
                    tone === "in" ? "text-success" : "text-gold-ink"
                  )}
                >
                  {t("result.child")}
                </span>
                <span className="max-w-32 truncate text-sm font-semibold">
                  {childNames(single.child).primary}
                </span>
              </div>
            </div>

            <h2 className="mt-4 text-3xl font-bold">{childNames(single.child).primary}</h2>
            {childNames(single.child).secondary && (
              <p className="mt-1 text-xl text-muted-foreground">
                {childNames(single.child).secondary}
              </p>
            )}
            {klassName(single.child) && (
              <p className="mt-1 text-base text-muted-foreground">
                {t("children.class")} : {klassName(single.child)}
              </p>
            )}

            {single.allergies.length > 0 && (
              <div className="mt-5 flex items-center justify-center gap-3 rounded-2xl bg-destructive-solid px-5 py-4 text-lg font-extrabold tracking-wide text-[var(--destructive-foreground)] uppercase shadow-lg shadow-destructive/30 ring-4 ring-destructive/30">
                <TriangleAlert className="size-7 shrink-0 animate-pulse" />
                <span>
                  {t("children.allergyWarning")} — {single.allergies.join(", ")}
                </span>
              </div>
            )}

            <p
              className={cn(
                "mt-6 flex items-center justify-center gap-2 text-2xl font-bold sm:text-3xl",
                single.direction === "in" ? "text-success" : "text-gold-ink"
              )}
            >
              {single.direction === "in" ? (
                <LogIn className="size-7 shrink-0 rtl:-scale-x-100" />
              ) : (
                <LogOut className="size-7 shrink-0 rtl:-scale-x-100" />
              )}
              {single.direction === "in"
                ? t("children.checkedIn", { time: timeFmt(single.at) })
                : t("children.checkedOut", { time: timeFmt(single.at) })}
            </p>
          </>
        ) : (
          <>
            {guardian && (
              <div className="flex items-center gap-4 rounded-2xl border border-primary/25 bg-primary/5 p-3 text-start">
                <GuardianFace guardian={guardian} size="md" />
                <div className="min-w-0">
                  <p className="text-xs font-bold tracking-wide text-primary uppercase">
                    {t("result.adult")}
                  </p>
                  <p className="truncate text-lg font-bold">{guardianName(guardian)}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {relationshipLabel(guardian.relationship)}
                  </p>
                </div>
              </div>
            )}
            <ul className="mt-3 grid gap-2 text-start">
              {entries.map((e) => (
                <li
                  key={e.child.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card/70 p-3"
                >
                  <ChildFace entry={e} size="md" tone={e.direction} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-bold">{childNames(e.child).primary}</p>
                    <p
                      className={cn(
                        "flex items-center gap-1.5 text-sm font-semibold",
                        e.direction === "in" ? "text-success" : "text-gold-ink"
                      )}
                    >
                      {e.direction === "in" ? (
                        <LogIn className="size-4 shrink-0 rtl:-scale-x-100" />
                      ) : (
                        <LogOut className="size-4 shrink-0 rtl:-scale-x-100" />
                      )}
                      {e.direction === "in"
                        ? t("children.checkedIn", { time: timeFmt(e.at) })
                        : t("children.checkedOut", { time: timeFmt(e.at) })}
                    </p>
                    {e.allergies.length > 0 && (
                      <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-destructive-solid px-2.5 py-0.5 text-xs font-extrabold tracking-wide text-[var(--destructive-foreground)] uppercase">
                        <TriangleAlert className="size-3.5 shrink-0" />
                        {t("children.allergyWarning")} — {e.allergies.join(", ")}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {guardian ? (
          <p className="mt-5 text-base font-semibold text-foreground">
            {t("result.recordedWith", {
              name: `${guardianName(guardian)} (${relationshipLabel(guardian.relationship)})`,
            })}
          </p>
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">{t("result.noGuardian")}</p>
        )}

        {failedCount > 0 && (
          <p className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive">
            <TriangleAlert className="size-5 shrink-0" />
            {t("result.partialFailure", { count: failedCount })}
          </p>
        )}

        {askPickup && (
          <div className="mt-6 text-start">
            <label
              htmlFor="kiosk-pickup"
              className="mb-1.5 block text-sm font-semibold text-muted-foreground"
            >
              {t("children.pickedUpBy")}
            </label>
            <div className="flex gap-2">
              <input
                id="kiosk-pickup"
                value={pickup.name}
                placeholder={t("children.pickedUpByPlaceholder")}
                onChange={(e) => pickup.setName(e.target.value)}
                onFocus={pickup.touch}
                className="h-14 flex-1 rounded-2xl border-2 border-border bg-card px-4 text-lg text-foreground placeholder:text-muted-foreground focus:border-gold focus:outline-none"
              />
              <button
                type="button"
                onClick={pickup.save}
                disabled={pickup.saving}
                className="flex h-14 items-center gap-2 rounded-2xl bg-gold px-5 text-lg font-bold text-gold-foreground transition-transform active:scale-95 disabled:opacity-50"
              >
                <Check className="size-6" />
                {t("actions.ok")}
              </button>
            </div>
          </div>
        )}

        {!askPickup && (
          <button
            type="button"
            onClick={onDismiss}
            className="mt-5 h-12 w-full rounded-2xl border border-border bg-muted text-base font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("actions.close")}
          </button>
        )}
      </div>
    </div>
  );
}


/** One choice on the staff pad: full-width, thumb-sized, unmistakably tappable. */
function StaffActionButton({
  tone,
  icon,
  label,
  busy,
  onClick,
}: {
  tone: "in" | "out" | "break";
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={cn(
        "flex h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-bold transition-transform active:scale-[0.98] disabled:opacity-50",
        tone === "in"
          ? "bg-success text-success-foreground shadow-lg shadow-success/20"
          : tone === "break"
            ? "bg-gold text-gold-foreground shadow-lg shadow-gold/20"
            : "border border-border bg-card text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
