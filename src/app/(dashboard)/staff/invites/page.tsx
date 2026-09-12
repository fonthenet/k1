import Link from "next/link";
import { AlertCircle, ArrowLeft, MailPlus } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill } from "@/components/shared/status-pill";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/tenant";
import { formatDate } from "@/lib/format";
import { CopyLinkButton } from "@/components/modules/staff/copy-link-button";
import { InviteDialog } from "@/components/modules/staff/invite-dialog";
import { InviteRowMenu } from "@/components/modules/staff/revoke-invite-button";
import { ROLE_BADGE } from "@/components/modules/staff/maps";
import type { StaffInvite, StaffRole } from "@/components/modules/staff/staff-types";

export default async function StaffInvitesPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();
  const t = await getTranslations("staff");
  const locale = await getLocale();

  const { data: invites, error } = await supabase
    .from("kg_staff_invites")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  const list = (invites ?? []) as StaffInvite[];
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const now = new Date().toISOString();

  return (
    <div>
      {/* Not in the sidebar, so without this the only way out is the browser. */}
      <Link
        href="/staff"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("detail.backToTeam")}
      </Link>

      <PageHeader title={t("invites.title")} description={t("invites.description")}>
        <InviteDialog />
      </PageHeader>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{t("errors.generic")}</AlertTitle>
          <AlertDescription>{t("invites.empty")}</AlertDescription>
        </Alert>
      ) : list.length === 0 ? (
        <EmptyState icon={<MailPlus />} title={t("invites.empty")} description={t("invites.emptyHint")} />
      ) : (
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
              <TableHeader>
                <TableRow className="[&>th]:font-semibold">
                  <TableHead>{t("invites.columns.email")}</TableHead>
                  <TableHead>{t("invites.columns.role")}</TableHead>
                  <TableHead>{t("invites.columns.expires")}</TableHead>
                  <TableHead className="w-24">
                    <span className="sr-only">{t("invites.columns.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((inv) => {
                  const expired = inv.expires_at <= now;
                  const role = inv.role as StaffRole;
                  return (
                    // An invitation has no page of its own, so the row has
                    // no door; its two controls sit plainly at the end.
                    <TableRow key={inv.id} className="transition-colors hover:bg-primary/5">
                      <TableCell>
                        {/* The address is an LTR island, but the column starts
                            where the Arabic reader starts: the lines shrink to
                            their text so they sit at the cell's start edge. */}
                        <span className="flex min-w-0 flex-col items-start">
                          <span dir="ltr" className="max-w-full truncate font-semibold">
                            {inv.email}
                          </span>
                          {inv.job_title && (
                            <bdi dir="auto" className="max-w-full truncate text-xs text-muted-foreground">
                              {inv.job_title}
                            </bdi>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge className={ROLE_BADGE[role] ?? ""}>{t(`roles.${role}`)}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {/* The date, or the one red word that replaces it. */}
                        {expired ? (
                          <StatusPill tone="danger">{t("invites.expired")}</StatusPill>
                        ) : (
                          <span className="text-muted-foreground tabular-nums">
                            {formatDate(inv.expires_at, locale)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="w-24">
                        <span className="flex items-center justify-end gap-0.5">
                          {!expired && <CopyLinkButton text={`${base}/join/${inv.token}`} iconOnly />}
                          <InviteRowMenu id={inv.id} email={inv.email} />
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
