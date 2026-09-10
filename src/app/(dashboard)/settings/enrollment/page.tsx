import { AlertCircle, Building2, LinkIcon } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/tenant";
import { formatDate } from "@/lib/format";
import { CreateLinkDialog } from "@/components/modules/settings/create-link-dialog";
import {
  LinkActiveSwitch, LinkRowActions,
} from "@/components/modules/settings/enroll-link-actions";
import type { EnrollLinkRow } from "@/components/modules/settings/settings-types";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

export default async function EnrollmentLinksPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();
  const t = await getTranslations("settings");
  const locale = await getLocale();

  const [{ data, error }, { data: structureRows }] = await Promise.all([
    supabase
      .from("kg_enroll_links")
      .select("id, token, label, active, expires_at, max_uses, use_count, created_at, structure_id")
      .eq("tenant_id", ctx.tenant.id)
      .order("created_at", { ascending: false }),
    // Signup creates one link per structure; the column below is how a director
    // tells them apart afterwards.
    supabase
      .from("kg_structures")
      .select("id, name, name_ar, center_type, color, sort_order, active")
      .eq("tenant_id", ctx.tenant.id)
      .order("sort_order")
      .order("name"),
  ]);

  const links = (data ?? []) as EnrollLinkRow[];
  const structures = (structureRows ?? []) as Structure[];
  // Active ones only, the same count the link dialog uses: a retired
  // structure must not bring the chips back on its own.
  const manyStructures = structures.filter((s) => s.active).length > 1;
  const structureById = new Map(structures.map((s) => [s.id, s]));
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const now = new Date().toISOString();

  return (
    <div>
      <PageHeader title={t("enrollment.title")} description={t("enrollment.description")}>
        <CreateLinkDialog structures={structures} />
      </PageHeader>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{t("errors.generic")}</AlertTitle>
          <AlertDescription>{t("enrollment.loadError")}</AlertDescription>
        </Alert>
      ) : links.length === 0 ? (
        <EmptyState
          icon={<LinkIcon />}
          title={t("enrollment.empty")}
          description={t("enrollment.emptyHint")}
          action={<CreateLinkDialog structures={structures} />}
        />
      ) : (
        <Card className="overflow-hidden border border-border py-0 shadow-sm ring-0">
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    t("enrollment.columns.label"),
                    // Which structure the applications land in — only once the
                    // building runs more than one.
                    ...(manyStructures ? [t("enrollment.columns.structure")] : []),
                    t("enrollment.columns.url"),
                    t("enrollment.columns.uses"),
                    t("enrollment.columns.expires"),
                    t("enrollment.columns.active"),
                  ].map((label, i) => (
                    <TableHead
                      key={i}
                      className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                    >
                      {label}
                    </TableHead>
                  ))}
                  <TableHead className="text-end text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("enrollment.columns.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((link) => {
                  const url = `${base}/enroll/${link.token}`;
                  const expired = !!link.expires_at && link.expires_at <= now;
                  const full = link.max_uses !== null && link.use_count >= link.max_uses;
                  const structure = link.structure_id
                    ? (structureById.get(link.structure_id) ?? null)
                    : null;
                  // The WhatsApp text names the structure when the link has one,
                  // so the crèche's message and the école's are not word for
                  // word the same — a parent forwarded both should be able to
                  // tell which is which without opening either.
                  const waText = structure
                    ? t("enrollment.shareTextStructure", {
                        name: ctx.tenant.name,
                        structure: structureName(structure, locale),
                      })
                    : t("enrollment.shareText", { name: ctx.tenant.name });
                  return (
                    <TableRow key={link.id} className="transition-colors hover:bg-muted/40">
                      <TableCell className="font-semibold text-foreground">{link.label}</TableCell>
                      {manyStructures && (
                        <TableCell>
                          {/* The structure's own colour as a dot, the same chip
                              the sidebar switcher and the comms picker use. The
                              building has no colour of its own — a grey glyph,
                              not a structure's hue borrowed at random. */}
                          {structure ? (
                            <span className="inline-flex items-center gap-2 text-foreground">
                              <span
                                className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
                                style={{ backgroundColor: structure.color }}
                                aria-hidden
                              />
                              {structureName(structure, locale)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2 text-muted-foreground">
                              <Building2 className="size-3.5 shrink-0" aria-hidden />
                              {t("enrollment.wholeBuilding")}
                            </span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <span
                          dir="ltr"
                          className="block max-w-[22rem] truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
                        >
                          {url}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {link.max_uses !== null ? (
                          <span className="flex items-center gap-2">
                            {t("enrollment.usesOf", {
                              used: link.use_count,
                              max: link.max_uses,
                            })}
                            {full && (
                              <Badge className="border-transparent bg-gold font-medium text-gold-foreground">
                                {t("enrollment.full")}
                              </Badge>
                            )}
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            {link.use_count}
                            <span className="text-xs text-muted-foreground">
                              {t("enrollment.unlimited")}
                            </span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {!link.expires_at ? (
                          <span className="text-xs text-muted-foreground">
                            {t("enrollment.noExpiry")}
                          </span>
                        ) : expired ? (
                          <Badge className="border-transparent bg-destructive/10 font-medium text-destructive">
                            {t("enrollment.expired")}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">
                            {formatDate(link.expires_at, locale)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <LinkActiveSwitch id={link.id} active={link.active} />
                      </TableCell>
                      <TableCell>
                        <LinkRowActions
                          id={link.id}
                          label={link.label}
                          url={url}
                          waText={`${waText} ${url}`}
                        />
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
