import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { childDisplayName, formatDate, formatTime } from "@/lib/format";
import type { Gender } from "@/lib/types";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/modules/dashboard/print-button";

// ---------- local row types (schema: supabase/migrations) ----------

interface NamedPerson {
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
}

interface GuardianRow extends NamedPerson {
  relationship: string;
  phone: string;
  address: string | null;
}

interface ChildGuardianEmbed {
  is_primary: boolean;
  kg_guardians: GuardianRow | null;
}

interface MatriculeRow extends NamedPerson {
  id: string;
  dob: string;
  gender: Gender;
  enrollment_date: string | null;
  withdrawal_date: string | null;
  kg_child_guardians: ChildGuardianEmbed[];
}

interface ExitRow {
  id: string;
  date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  picked_up_by: string | null;
  notes: string | null;
  kg_children: NamedPerson | null;
}

const KINDS = ["matricule", "sorties"] as const;
type Kind = (typeof KINDS)[number];
const RELATIONSHIPS = ["father", "mother", "guardian", "grandparent", "sibling", "other"];

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function primaryGuardian(cgs: ChildGuardianEmbed[] | null | undefined): GuardianRow | null {
  if (!cgs || cgs.length === 0) return null;
  const sorted = [...cgs].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  return sorted.find((g) => g.kg_guardians)?.kg_guardians ?? null;
}

const th = "border border-black/40 bg-black/6 px-2 py-1.5 text-start text-xs font-semibold";
const td = "border border-black/25 px-2 py-1.5 text-start align-top text-xs";

export default async function PrintRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { kind: rawKind } = await params;
  if (!KINDS.includes(rawKind as Kind)) notFound();
  const kind = rawKind as Kind;

  const ctx = await requireFinance();
  const supabase = await createClient();
  const [t, locale] = await Promise.all([getTranslations("reports"), getLocale()]);
  const tid = ctx.tenant.id;
  const intlLocale = locale === "ar" ? "ar-DZ" : "fr-DZ";

  const sp = await searchParams;
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? (sp.month as string) : currentKey;
  const [y, m] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = isoDate(new Date(y, m, 0));
  const monthTitle = new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" }).format(
    new Date(y, m - 1, 1)
  );

  let matricule: MatriculeRow[] = [];
  let exits: ExitRow[] = [];
  let loadError = false;

  if (kind === "matricule") {
    const res = await supabase
      .from("kg_children")
      .select(
        "id, first_name, last_name, first_name_ar, last_name_ar, dob, gender, enrollment_date, withdrawal_date, kg_child_guardians(is_primary, kg_guardians(first_name, last_name, first_name_ar, last_name_ar, relationship, phone, address))"
      )
      .eq("tenant_id", tid)
      .order("enrollment_date", { ascending: true, nullsFirst: false })
      .order("last_name");
    loadError = Boolean(res.error);
    matricule = (res.data ?? []) as unknown as MatriculeRow[];
  } else {
    const res = await supabase
      .from("kg_attendance")
      .select(
        "id, date, check_in_at, check_out_at, picked_up_by, notes, kg_children(first_name, last_name, first_name_ar, last_name_ar)"
      )
      .eq("tenant_id", tid)
      .gte("date", monthStart)
      .lte("date", monthEnd)
      .not("check_in_at", "is", null)
      .order("date")
      .order("check_in_at");
    loadError = Boolean(res.error);
    exits = (res.data ?? []) as unknown as ExitRow[];
  }

  const count = kind === "matricule" ? matricule.length : exits.length;
  const relationshipLabel = (rel: string) =>
    RELATIONSHIPS.includes(rel) ? t(`print.relationship.${rel}`) : rel;
  const secondaryName = (p: NamedPerson): string | null => {
    if (locale === "ar") return `${p.first_name} ${p.last_name}`;
    return p.first_name_ar && p.last_name_ar ? `${p.first_name_ar} ${p.last_name_ar}` : null;
  };
  const tenantPlace = [ctx.tenant.address, ctx.tenant.commune, ctx.tenant.wilaya]
    .filter(Boolean)
    .join(" — ");

  return (
    <div className="space-y-4">
      <style>{`
        @page { size: A4 ${kind === "matricule" ? "landscape" : "portrait"}; margin: 12mm; }
        @media print {
          body * { visibility: hidden !important; }
          #print-area, #print-area * { visibility: visible !important; }
          #print-area {
            position: absolute; top: 0; left: 0; right: 0;
            margin: 0 !important; border: none !important; box-shadow: none !important;
            border-radius: 0 !important; padding: 0 !important; max-width: none !important;
          }
        }
        #print-area thead { display: table-header-group; }
        #print-area tr { break-inside: avoid; }
      `}</style>

      {/* Screen-only toolbar */}
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 print:hidden">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
          <Link href="/reports?tab=registers">
            <ArrowLeft data-icon="inline-start" className="rtl:-scale-x-100" />
            {t("print.back")}
          </Link>
        </Button>
        <PrintButton label={t("print.print")} />
      </div>

      {loadError && (
        <Alert variant="destructive" className="mx-auto max-w-5xl print:hidden">
          <TriangleAlert />
          <AlertTitle>{t("loadError")}</AlertTitle>
        </Alert>
      )}

      {/* The printable sheet. Deliberately literal black-on-white: this is an
          official DAS register and must print at full contrast regardless of
          the app theme, so it does NOT follow the theme tokens. */}
      <div
        id="print-area"
        className="mx-auto max-w-5xl rounded-xl border border-border bg-white p-8 text-black shadow-sm md:p-10 print:shadow-none"
      >
        {/* Letterhead */}
        <div className="text-center">
          <p className="text-xs text-black/60">{t("print.republic")}</p>
          <h1 className="mt-2 text-lg font-bold">{ctx.tenant.name}</h1>
          {tenantPlace && <p className="mt-0.5 text-xs text-black/60">{tenantPlace}</p>}
          {ctx.tenant.phone && (
            <p className="mt-0.5 text-xs text-black/60" dir="ltr">
              {ctx.tenant.phone}
            </p>
          )}
        </div>

        <div className="my-5 border-t-2 border-black/80" />

        <h2 className="text-center text-xl font-bold uppercase tracking-wide">
          {kind === "matricule" ? t("print.matricule.title") : t("print.exits.title")}
        </h2>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-black/60">
          <span>{kind === "sorties" ? t("print.period", { month: monthTitle }) : t("print.count", { count })}</span>
          {kind === "sorties" && <span>{t("print.count", { count })}</span>}
          <span>{t("print.generated", { date: formatDate(now, locale) })}</span>
        </div>

        {count === 0 ? (
          <p className="py-16 text-center text-sm text-black/50">
            {t("print.count", { count: 0 })}
          </p>
        ) : kind === "matricule" ? (
          <table className="mt-4 w-full border-collapse">
            <thead>
              <tr>
                <th className={`${th} w-10`}>{t("print.matricule.num")}</th>
                <th className={th}>{t("print.matricule.child")}</th>
                <th className={th}>{t("print.matricule.dob")}</th>
                <th className={`${th} w-14`}>{t("print.matricule.gender")}</th>
                <th className={th}>{t("print.matricule.enrolled")}</th>
                <th className={th}>{t("print.matricule.withdrawn")}</th>
                <th className={th}>{t("print.matricule.guardian")}</th>
                <th className={th}>{t("print.matricule.phone")}</th>
                <th className={th}>{t("print.matricule.address")}</th>
              </tr>
            </thead>
            <tbody>
              {matricule.map((c, i) => {
                const g = primaryGuardian(c.kg_child_guardians);
                const alt = secondaryName(c);
                return (
                  <tr key={c.id}>
                    <td className={`${td} text-center tabular-nums`}>{i + 1}</td>
                    <td className={td}>
                      <div className="font-medium">{childDisplayName(c, locale)}</div>
                      {alt && (
                        <div className="text-black/50" dir={locale === "ar" ? "ltr" : "rtl"}>
                          {alt}
                        </div>
                      )}
                    </td>
                    <td className={`${td} tabular-nums`}>{formatDate(c.dob, locale)}</td>
                    <td className={`${td} text-center`}>
                      {c.gender === "male" ? t("print.male") : t("print.female")}
                    </td>
                    <td className={`${td} tabular-nums`}>
                      {c.enrollment_date ? formatDate(c.enrollment_date, locale) : "—"}
                    </td>
                    <td className={`${td} tabular-nums`}>
                      {c.withdrawal_date ? formatDate(c.withdrawal_date, locale) : "—"}
                    </td>
                    <td className={td}>
                      {g ? (
                        <>
                          <div className="font-medium">{childDisplayName(g, locale)}</div>
                          <div className="text-black/50">{relationshipLabel(g.relationship)}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${td} tabular-nums`} dir="ltr">
                      {g?.phone ?? "—"}
                    </td>
                    <td className={td}>{g?.address ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="mt-4 w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>{t("print.exits.date")}</th>
                <th className={th}>{t("print.exits.child")}</th>
                <th className={`${th} w-20`}>{t("print.exits.in")}</th>
                <th className={`${th} w-20`}>{t("print.exits.out")}</th>
                <th className={th}>{t("print.exits.pickedUpBy")}</th>
                <th className={th}>{t("print.exits.notes")}</th>
              </tr>
            </thead>
            <tbody>
              {exits.map((r) => (
                <tr key={r.id}>
                  <td className={`${td} tabular-nums`}>{formatDate(r.date, locale)}</td>
                  <td className={`${td} font-medium`}>
                    {r.kg_children ? childDisplayName(r.kg_children, locale) : "—"}
                  </td>
                  <td className={`${td} tabular-nums`}>
                    {r.check_in_at ? formatTime(r.check_in_at, locale) : "—"}
                  </td>
                  <td className={`${td} tabular-nums`}>
                    {r.check_out_at ? formatTime(r.check_out_at, locale) : "—"}
                  </td>
                  <td className={td}>{r.picked_up_by ?? "—"}</td>
                  <td className={td}>{r.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Signature */}
        <div className="mt-12 flex justify-end">
          <div className="w-64 text-center text-xs text-black/70">
            <p>{t("print.signature")}</p>
            <div className="h-24" />
          </div>
        </div>
      </div>
    </div>
  );
}
