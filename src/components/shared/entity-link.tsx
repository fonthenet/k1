// A name that goes to the record.
//
// The owner reported the same gap three times on three screens: a table prints
// a child's or a colleague's name and there is no way to get from the name to
// their file. An audit found 28 more. These are the fix, in one place, so a
// linked name looks and behaves the same everywhere instead of each page
// inventing its own hover colour.
//
// Two doors, two shapes. A row whose record has a page or a dialog of its own
// makes its name cell the whole-row overlay (`after:absolute after:inset-0`,
// as the classes register does) and lifts its few controls above it. These
// wrappers are the OTHER door: the inline link to a person inside a row that
// is about something else — a leave, an advance, a payslip line — or the
// second door inside an overlaid row, where the primary colour is what tells
// it apart from the row it sits in.

import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The affordance itself, for the doors that are not one of the names below.
 *
 * Colour at rest, underline on hover AND focus — the standard technique for
 * identifying a link without underlining it (WCAG G183). It needs the link to
 * clear 3:1 against the text around it, which `text-primary` does against both
 * `text-foreground` and `text-muted-foreground`.
 *
 * This replaced a dotted underline that was drawn on every name at rest. The
 * dotted rule was written for the arrears and aging tables, where thirty names
 * sit among columns of numbers and a solid underline on each would be noise —
 * but it was the default everywhere, so it also decorated a five-row list on
 * the dashboard that had nothing to be quiet about, and it made a name under a
 * page title read as marked-up prose. Colour carries the same information for
 * less ink, and unlike a hover-only treatment it is still visible on the
 * tablet the office actually works on, where there is no hover at all.
 */
export const ENTITY_LINK_CLASS = cn(
  "rounded font-medium text-primary transition-colors",
  "hover:underline hover:underline-offset-4",
  "focus-visible:underline focus-visible:underline-offset-4",
  "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
);

/**
 * The same door, for text that already carries a colour of its own.
 *
 * The arrears tables make the AMOUNT the link, and an amount is red when it is
 * more than thirty days late. Recolouring it to the link colour would delete
 * the one signal the column exists to give, so this inherits whatever colour
 * it is given and offers the underline on hover instead.
 */
export const ENTITY_LINK_INHERIT_CLASS = cn(
  "rounded transition-colors",
  "hover:underline hover:underline-offset-4",
  "focus-visible:underline focus-visible:underline-offset-4",
  "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
);

function EntityLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={cn(ENTITY_LINK_CLASS, className)}>
      {children}
    </Link>
  );
}

/** Staff-side link to a child's file. Never use on a parent-facing page. */
export function ChildLink({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <EntityLink href={`/children/${id}`} className={className}>
      {children}
    </EntityLink>
  );
}

/**
 * Parent-side link to their own child.
 *
 * Separate from ChildLink on purpose: /children/[id] is staff-only, and a
 * parent sent there gets a redirect at best. The portal has its own route and
 * its own RLS, and keeping them as two names makes using the wrong one on the
 * wrong surface a visible mistake rather than a silent one.
 */
export function PortalChildLink({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <EntityLink href={`/portal/children/${id}`} className={className}>
      {children}
    </EntityLink>
  );
}

/** `id` is the kg_memberships id — that is what /staff/[id] looks up. */
export function StaffLink({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <EntityLink href={`/staff/${id}`} className={className}>
      {children}
    </EntityLink>
  );
}

export function ClassLink({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <EntityLink href={`/classes/${id}`} className={className}>
      {children}
    </EntityLink>
  );
}

export function InvoiceLink({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <EntityLink href={`/billing/invoices/${id}`} className={className}>
      {children}
    </EntityLink>
  );
}

export function ActivityLink({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <EntityLink href={`/activities/${id}`} className={className}>
      {children}
    </EntityLink>
  );
}
