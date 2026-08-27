import {
  AlertCircle, Clock3, ExternalLink, FileText, ShieldAlert, ShieldCheck,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, signedMediaUrl } from "@/lib/tenant";
import { formatDate } from "@/lib/format";
import { AddDocumentDialog } from "@/components/modules/settings/add-document-dialog";
import { DeleteDocumentButton } from "@/components/modules/settings/delete-document-button";
import {
  TENANT_DOC_TYPES, docExpiryStatus,
  type DocExpiryStatus, type TenantDocType, type TenantDocumentRow,
} from "@/components/modules/settings/settings-types";

/** Compliance chips: valid = success, expiring within 60 days = gold, expired = destructive. */
const STATUS_BADGE: Record<DocExpiryStatus, string> = {
  valid: "border-transparent bg-success/10 font-medium text-success",
  expiring: "border-transparent bg-gold font-medium text-gold-foreground",
  expired: "border-transparent bg-destructive/10 font-medium text-destructive",
  noExpiry: "border-transparent bg-muted font-medium text-muted-foreground",
};

/** Icon tile behind each document — same tone family as its expiry chip. */
const STATUS_TILE: Record<DocExpiryStatus, string> = {
  valid: "bg-success/10 text-success",
  expiring: "bg-gold text-gold-foreground",
  expired: "bg-destructive/10 text-destructive",
  noExpiry: "bg-primary/10 text-primary",
};

/** Only the two states that need attention pull the eye with a coloured edge. */
const STATUS_EDGE: Record<DocExpiryStatus, string> = {
  valid: "border-border",
  expiring: "border-gold/45",
  expired: "border-destructive/45",
  noExpiry: "border-border",
};

const STATUS_ICON: Record<DocExpiryStatus, typeof FileText> = {
  valid: ShieldCheck,
  expiring: Clock3,
  expired: ShieldAlert,
  noExpiry: FileText,
};

/** Today in Algeria (UTC+1, no DST) as YYYY-MM-DD. */
function algiersToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(new Date());
}

export default async function TenantDocumentsPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();
  const t = await getTranslations("settings");
  const locale = await getLocale();
  const today = algiersToday();

  const { data, error } = await supabase
    .from("kg_tenant_documents")
    .select("id, doc_type, title, file_path, issued_at, expires_at")
    .eq("tenant_id", ctx.tenant.id)
    .order("expires_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  const docs = (data ?? []) as TenantDocumentRow[];
  const fileUrls = await Promise.all(docs.map((d) => signedMediaUrl(d.file_path)));

  const needsAttention = docs.filter((d) => {
    const status = docExpiryStatus(d.expires_at, today);
    return status === "expired" || status === "expiring";
  }).length;

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
          action={<AddDocumentDialog />}
        />
      ) : (
        <div className="space-y-6">
          {needsAttention > 0 && (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertTitle>{t("documents.alertTitle")}</AlertTitle>
              <AlertDescription>
                {t("documents.alertDescription", { count: needsAttention })}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {docs.map((doc, i) => {
              const status = docExpiryStatus(doc.expires_at, today);
              const type = (TENANT_DOC_TYPES as readonly string[]).includes(doc.doc_type)
                ? (doc.doc_type as TenantDocType)
                : "other";
              const fileUrl = fileUrls[i];
              const StatusIcon = STATUS_ICON[status];
              return (
                <Card
                  key={doc.id}
                  className={`flex flex-col border ${STATUS_EDGE[status]} shadow-sm ring-0 transition-shadow hover:shadow-md`}
                >
                  <CardHeader className="gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-3">
                        <span
                          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${STATUS_TILE[status]}`}
                          aria-hidden
                        >
                          <StatusIcon className="size-5" />
                        </span>
                        <CardTitle className="text-base leading-snug font-semibold">
                          {doc.title}
                        </CardTitle>
                      </div>
                      <DeleteDocumentButton id={doc.id} title={doc.title} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="border-transparent bg-muted font-medium text-muted-foreground">
                        {t(`documents.types.${type}`)}
                      </Badge>
                      <Badge className={STATUS_BADGE[status]}>
                        {t(`documents.status.${status}`)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="mt-auto flex flex-col gap-3">
                    <div className="space-y-0.5 text-sm text-muted-foreground">
                      {doc.issued_at && (
                        <p>{t("documents.issuedOn", { date: formatDate(doc.issued_at, locale) })}</p>
                      )}
                      {doc.expires_at ? (
                        <p>{t("documents.expiresOn", { date: formatDate(doc.expires_at, locale) })}</p>
                      ) : (
                        <p>{t("documents.status.noExpiry")}</p>
                      )}
                    </div>
                    {fileUrl ? (
                      <Button asChild variant="outline" size="sm" className="self-start">
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink data-icon="inline-start" />
                          {t("documents.view")}
                        </a>
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("documents.noFile")}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
