import { AlertCircle, Building2, LinkIcon } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureMark } from "@/components/shared/structure-mark";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/tenant";
import { formatDate } from "@/lib/format";
import { CreateLinkDialog } from "@/components/modules/settings/create-link-dialog";
import {
  LinkActiveSwitch, LinkRowActions,
} from "@/components/modules/settings/enroll-link-actions";
import type { EnrollLinkRow } from "@/components/modules/settings/settings-types";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

/** The roster's head style: sentence case, muted, never uppercase. */
const HEAD = "text-sm font-medium text-muted-foreground";

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
  // structure must not bring the column back on its own.
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
            {/* No URL column: nobody reads a forty-character token, and the
                copy button carries the link. Without it the table fits the
                card at 1360 instead of clipping its own actions. */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={HEAD}>{t("enrollment.columns.label")}</TableHead>
                  {manyStructures && (
                    <TableHead className={HEAD}>{t("enrollment.columns.structure")}</TableHead>
                  )}
                  <TableHead className={HEAD}>{t("enrollment.columns.uses")}</TableHead>
                  <TableHead className={HEAD}>{t("enrollment.columns.expires")}</TableHead>
                  <TableHead className={HEAD}>{t("enrollment.columns.active")}</TableHead>
                  <TableHead className="w-28">
                    <span className="sr-only">{t("enrollment.columns.actions")}</span>
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
                    <TableRow key={link.id} className="h-14 transition-colors hover:bg-muted/40">
                      <TableCell>
                        {/* A label a director typed, in either script, with a
                            year in it: without its own direction the digits
                            jump to the front of an Arabic label on a French
                            page. */}
                        <span className="block text-start font-semibold text-foreground">
                          <bdi dir="auto">{link.label}</bdi>
                        </span>
                      </TableCell>
                      {manyStructures && (
                        <TableCell>
                          {structure ? (
                            <StructureMark
                              structure={{ ...structure, name: structureName(structure, locale) }}
                            />
                          ) : (
                            // The building has no colour of its own — a grey
                            // glyph, not a structure's hue borrowed at random.
                            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                              <Building2 className="size-3.5 shrink-0" aria-hidden />
                              {t("enrollment.wholeBuilding")}
                            </span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <span className="inline-flex items-center gap-2">
                          {link.max_uses !== null ? (
                            <span dir="ltr" className="tabular-nums">
                              {link.use_count} / {link.max_uses}
                            </span>
                          ) : (
                            <>
                              <span className="tabular-nums">{link.use_count}</span>
                              <span className="text-xs text-muted-foreground">
                                {t("enrollment.unlimited")}
                              </span>
                            </>
                          )}
                          {full && <StatusPill tone="attention">{t("enrollment.full")}</StatusPill>}
                        </span>
                      </TableCell>
                      <TableCell>
                        {!link.expires_at ? (
                          <span className="text-xs text-muted-foreground">
                            {t("enrollment.noExpiry")}
                          </span>
                        ) : expired ? (
                          <StatusPill tone="danger">{t("enrollment.expired")}</StatusPill>
                        ) : (
                          <span className="text-muted-foreground">
                            {formatDate(link.expires_at, locale)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <LinkActiveSwitch id={link.id} active={link.active} />
                      </TableCell>
                      <TableCell className="text-end">
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
