// A name that goes to the record.
//
// The owner reported the same gap three times on three screens: a table prints
// a child's or a colleague's name and there is no way to get from the name to
// their file. An audit found 28 more. These are the fix, in one place, so a
// linked name looks and behaves the same everywhere instead of each page
// inventing its own hover colour.
//
// Deliberately a plain inline link, NOT the whole-row overlay used by the
// roster (`after:absolute after:inset-0`). Most of these rows already carry
// their own controls — a call button, a WhatsApp button, an editable salary
// input, a "mark repaid" button — and a full-row overlay would swallow them.
// The roster's overlay stays where it belongs: on rows that do nothing else.
//
// The dotted underline is the tell. These names sit inside dense tables of
// numbers where a solid underline on every row would be visual noise, but with
// no affordance at all nobody discovers the link exists.

import Link from "next/link";
import { cn } from "@/lib/utils";

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
    <Link
      href={href}
      className={cn(
        "rounded underline decoration-dotted underline-offset-4 transition-colors",
        "hover:text-primary hover:decoration-solid",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        className
      )}
    >
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
