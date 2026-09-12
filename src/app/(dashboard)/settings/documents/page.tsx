import { algiersToday } from "@/lib/algiers";
import { AlertCircle, FileText } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, signedMediaUrl } from "@/lib/tenant";
import { formatDate } from "@/lib/format";
import { AddDocumentDialog } from "@/components/modules/settings/add-document-dialog";
import { DocumentRowMenu } from "@/components/modules/settings/delete-document-button";
import {
  TENANT_DOC_TYPES, docExpiryStatus,
  type DocExpiryStatus, type TenantDocType, type TenantDocumentRow,
} from "@/components/modules/settings/settings-types";

/**
 * The one mark an expiry date carries. A valid document is the expected
 * state and says nothing; a document without an expiry has no date at all
 * and says so in words instead of a pill.
 */
const EXPIRY_TONE: Partial<Record<DocExpiryStatus, StatusTone>> = {
  expiring: "attention",
  expired: "danger",
};

export default async function TenantDocumentsPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();
  const t = await getTranslations("settings");
  const locale = await getLocale();
  const today = algiersToday();

  // Soonest expiry first, so the documents that need a hand sit at the top
  // of the register and carry its only gold and red — no banner needed.
  const { data, error } = await supabase
    .from("kg_tenant_documents")
    .select("id, doc_type, title, file_path, issued_at, expires_at")
    .eq("tenant_id", ctx.tenant.id)
    .order("expires_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  const docs = (data ?? []) as TenantDocumentRow[];
  const fileUrls = await Promise.all(docs.map((d) => signedMediaUrl(d.file_path)));

  return (
    <div>
      <PageHeader title={t("documents.title")} description={t("documents.description")}>
        <AddDocumentDialog />
      </PageHeader>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{t("errors.generic")}</AlertTitle>
          <AlertDescription>{t("documents.loadError")}</AlertDescription>
        </Alert>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={t("documents.empty")}
          description={t("documents.emptyHint")}
        />
      ) : (
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
              <TableHeader>
                <TableRow className="[&>th]:font-semibold">
                  <TableHead>{t("documents.columns.document")}</TableHead>
                  <TableHead>{t("documents.columns.type")}</TableHead>
                  <TableHead>{t("documents.columns.issued")}</TableHead>
                  <TableHead>{t("documents.columns.expires")}</TableHead>
                  <TableHead className="w-20">
                    <span className="sr-only">{t("documents.columns.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((doc, i) => {
                  const status = docExpiryStatus(doc.expires_at, today);
                  const tone = EXPIRY_TONE[status];
                  const type = (TENANT_DOC_TYPES as readonly string[]).includes(doc.doc_type)
                    ? (doc.doc_type as TenantDocType)
                    : "other";
                  const fileUrl = fileUrls[i];
                  return (
                    <TableRow key={doc.id} className="relative transition-colors hover:bg-primary/5">
                      <TableCell>
                        {/* The file is the record's door: the title's overlay
                            reaches every cell and the menu is lifted above it.
                            A document with no file has nowhere to go, so its
                            title stays plain text and says why. */}
                        {fileUrl ? (
                          <a
                            href={fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold after:absolute after:inset-0"
                          >
                            <bdi dir="auto">{doc.title}</bdi>
                          </a>
                        ) : (
                          <span className="flex min-w-0 flex-col items-start">
                            <bdi dir="auto" className="font-semibold">{doc.title}</bdi>
                            <span className="text-xs text-muted-foreground">{t("documents.noFile")}</span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {t(`documents.types.${type}`)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                        {doc.issued_at ? formatDate(doc.issued_at, locale) : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {doc.expires_at ? (
                          <span className="flex items-center gap-2">
                            <span className="text-muted-foreground tabular-nums">
                              {formatDate(doc.expires_at, locale)}
                            </span>
                            {tone && <StatusPill tone={tone}>{t(`documents.status.${status}`)}</StatusPill>}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("documents.status.noExpiry")}</span>
                        )}
                      </TableCell>
                      <TableCell className="w-20">
                        <span className="relative z-10 flex items-center justify-end gap-0.5">
                          <DocumentRowMenu id={doc.id} title={doc.title} fileUrl={fileUrl} />
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
