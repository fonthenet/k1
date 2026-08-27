import Link from "next/link";
import { AlertCircle, ArrowLeft, ArrowRight, MailPlus } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/tenant";
import { formatDate } from "@/lib/format";
import { CopyLinkButton } from "@/components/modules/staff/copy-link-button";
import { InviteDialog } from "@/components/modules/staff/invite-dialog";
import { RevokeInviteButton } from "@/components/modules/staff/revoke-invite-button";
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
  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;

  return (
    <div>
      <PageHeader title={t("invites.title")} description={t("invites.description")}>
        <Button asChild variant="ghost">
          <Link href="/staff">
            <BackIcon data-icon="inline-start" />
            {t("detail.backToTeam")}
          </Link>
        </Button>
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
        <Card className="overflow-hidden border border-border py-0 shadow-sm ring-0">
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  {[
                    t("invites.columns.email"),
                    t("invites.columns.role"),
                    t("invites.columns.jobTitle"),
                    t("invites.columns.expires"),
                  ].map((label, i) => (
                    <TableHead
                      key={i}
                      className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                    >
                      {label}
                    </TableHead>
                  ))}
                  <TableHead className="text-end" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((inv) => {
                  const expired = inv.expires_at <= now;
                  const role = inv.role as StaffRole;
                  return (
                    <TableRow key={inv.id} className="transition-colors hover:bg-muted/40">
                      <TableCell className="font-semibold text-foreground" dir="ltr">
                        {inv.email}
                      </TableCell>
                      <TableCell>
                        <Badge className={ROLE_BADGE[role] ?? ""}>{t(`roles.${role}`)}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{inv.job_title ?? "—"}</TableCell>
                      <TableCell>
                        {expired ? (
                          <Badge className="border-transparent bg-destructive/10 font-medium text-destructive">
                            {t("invites.expired")}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">
                            {formatDate(inv.expires_at, locale)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1.5">
                          {!expired && <CopyLinkButton text={`${base}/join/${inv.token}`} />}
                          <RevokeInviteButton id={inv.id} email={inv.email} />
                        </div>
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
