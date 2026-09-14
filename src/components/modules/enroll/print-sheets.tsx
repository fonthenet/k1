import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { allergenLabel } from "@/lib/allergens";
import { requirementName, type DossierStatus } from "@/lib/dossier";
import { formatDate, formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AppChildPayload, AppGuardianPayload, AppHealthPayload } from "./types";

/**
 * The two printable sheets of the dossier d'inscription — the pre-filled
 * Fiche de renseignements and the Demande manuscrite template — shared by
 * the office (/applications/[id]/print) and the family (/enroll/dossier/
 * [id]/print). Server components: they read their strings themselves and
 * hold no state, so a page renders one and prints it.
 *
 * Deliberately ink-on-paper, black on white in both themes, like the DAS
 * registers and the receipt: a sheet the family signs and the inspector
 * reads must print at full contrast whatever the app's theme. Arabic is set
 * in Cairo; every date goes through formatDate (Western digits); phones and
 * numbers are ltr islands.
 */

const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }
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
`;

/** The registers' cell classes (reports/print): bordered, small, start-aligned. */
const th = "border border-black/40 bg-black/6 px-2 py-1.5 text-start text-xs font-semibold";
const td = "border border-black/25 px-2 py-1.5 text-start align-top text-xs";

export interface PrintTenant {
  name: string;
  address: string | null;
  commune: string | null;
  wilaya: string | null;
  phone: string | null;
  /** Signed URL, already minted. */
  logoUrl: string | null;
}

export interface FicheSheetProps {
  locale: string;
  tenant: PrintTenant;
  child: AppChildPayload;
  guardians: ReadonlyArray<AppGuardianPayload>;
  health: AppHealthPayload;
  /** Already picked for the locale. */
  structureName: string | null;
  className: string | null;
  /** "Pièces au dossier": one line per active line; null omits the section. */
  dossier: DossierStatus | null;
}

export interface DemandeSheetProps {
  locale: string;
  tenant: PrintTenant;
  /** The applicant guardian (is_applicant, else guardians[0]); null prints blank lines. */
  guardian: AppGuardianPayload | null;
}

export type PrintSheet = "fiche" | "demande";
export interface PrintSearchParams {
  /** default "fiche" */
  sheet?: PrintSheet;
}

/** searchParams.sheet, defaulting to the fiche: anything else is a typo, not a third sheet. */
export function printSheetOf(value: string | string[] | undefined): PrintSheet {
  return value === "demande" ? "demande" : "fiche";
}

/** A blank on a form: something to write on, sized so a name fits. */
function Blank({ className }: { className?: string }) {
  return <span className={cn("inline-block min-w-[48mm] border-b border-black/40 align-baseline", className)} aria-hidden />;
}

/** The A4 sheet every print route wraps its content in, with the print rules. */
function Sheet({ locale, children }: { locale: string; children: React.ReactNode }) {
  const arabic = locale === "ar";
  return (
    <>
      <style>{PRINT_CSS}</style>
      <div
        id="print-area"
        dir={arabic ? "rtl" : "ltr"}
        lang={locale}
        className={cn(
          "mx-auto max-w-[210mm] rounded-xl border border-border bg-white p-8 text-black shadow-sm md:p-10 print:shadow-none",
          arabic && "font-[family-name:var(--font-cairo)]"
        )}
      >
        {children}
      </div>
    </>
  );
}

/** The establishment's letterhead: republic, logo, name, place, phone — the registers' head. */
function Letterhead({ tenant, republic }: { tenant: PrintTenant; republic: string }) {
  const place = [tenant.address, tenant.commune, tenant.wilaya].filter(Boolean).join(" · ");
  return (
    <>
      <div className="text-center">
        <p className="text-xs text-black/60">{republic}</p>
        {tenant.logoUrl && (
          <Image
            src={tenant.logoUrl}
            alt=""
            width={64}
            height={64}
            unoptimized
            className="mx-auto mt-3 size-16 object-contain"
          />
        )}
        <h1 className="mt-2 text-lg font-bold">
          <bdi dir="auto">{tenant.name}</bdi>
        </h1>
        {place && (
          <p className="mt-0.5 text-xs text-black/60">
            <bdi dir="auto">{place}</bdi>
          </p>
        )}
        {tenant.phone && (
          <p className="mt-0.5 text-xs text-black/60" dir="ltr">
            {formatPhone(tenant.phone)}
          </p>
        )}
      </div>
      <div className="my-5 border-t-2 border-black/80" />
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-5 mb-1.5 text-sm font-bold">{children}</h3>;
}

/** "Fait à ______ le ______", the line every signed paper ends with. */
function DoneAt({ label }: { label: string }) {
  return <p className="mt-6 text-sm">{label}</p>;
}

/** A labelled signature box. */
function SignatureBox({ label }: { label: string }) {
  return (
    <div>
      <p className="text-xs text-black/70">{label}</p>
      <div className="mt-1.5 h-20 rounded border border-black/30" />
    </div>
  );
}

/** A person-typed value on the sheet, or the dash that says the field was left empty. */
function Value({ value, ltr }: { value: string | null | undefined; ltr?: boolean }) {
  const text = value?.trim();
  if (!text) return <>—</>;
  return ltr ? <span dir="ltr">{text}</span> : <bdi dir="auto">{text}</bdi>;
}

/**
 * The Fiche de renseignements, filled in from what the family typed: the
 * child, one column per guardian, health, three blank rows for the people
 * allowed to collect the child, the state of each pièce, the engagement and
 * two signatures. A family prints it from the success screen or its file
 * page, signs it and brings it in; the office prints the same sheet from
 * the application.
 */
export async function FicheSheet({
  locale,
  tenant,
  child,
  guardians,
  health,
  structureName,
  className,
  dossier,
}: FicheSheetProps) {
  const [t, te, tc, tr] = await Promise.all([
    getTranslations("enroll.print"),
    getTranslations("enroll"),
    getTranslations("common"),
    getTranslations("reports.print"),
  ]);
  const allergies = Array.isArray(health.allergies) ? health.allergies : [];
  const conditions = Array.isArray(health.medical_conditions) ? health.medical_conditions : [];
  const medications = Array.isArray(health.medications) ? health.medications : [];
  const activeLines = dossier?.lines.filter((line) => line.active) ?? [];
  // At least one column, so a sibling file — whose guardians the office
  // already holds — still prints a column the family fills in by hand.
  const columns = guardians.length > 0 ? [...guardians] : [null];
  const yes = t("yes");
  const no = t("no");

  // Two label/value pairs per row: the child's facts fit on five lines
  // instead of ten, and the sheet stays on one A4 page with the rest.
  const childFacts: Array<[string, React.ReactNode]> = [
    [te("child.lastName"), <Value key="ln" value={child.last_name} />],
    [te("child.firstName"), <Value key="fn" value={child.first_name} />],
    [te("child.lastNameAr"), <Value key="lna" value={child.last_name_ar} />],
    [te("child.firstNameAr"), <Value key="fna" value={child.first_name_ar} />],
    [te("child.dob"), <span key="dob" className="tabular-nums">{child.dob ? formatDate(child.dob, locale) : "—"}</span>],
    [te("child.gender"), child.gender === "female" ? te("child.female") : child.gender === "male" ? te("child.male") : "—"],
    [te("child.bloodType"), <Value key="bt" value={child.blood_type} ltr />],
    [te("review.structure"), <Value key="st" value={structureName} />],
    [te("review.class"), <Value key="cl" value={className} />],
  ];
  const childRows: Array<Array<[string, React.ReactNode]>> = [];
  for (let i = 0; i < childFacts.length; i += 2) childRows.push(childFacts.slice(i, i + 2));

  const healthFacts: Array<[string, React.ReactNode]> = [
    [
      te("health.allergies"),
      allergies.length > 0 ? (
        <span>
          {allergies.map((a, i) => (
            <span key={i}>
              {i > 0 && " · "}
              <bdi dir="auto">{allergenLabel(a.allergen, tc)}</bdi>
              {a.severity && <span className="text-black/60"> ({te(`health.severities.${a.severity}`)})</span>}
            </span>
          ))}
        </span>
      ) : (
        "—"
      ),
    ],
    [te("health.conditions"), <Value key="co" value={conditions.join(" · ")} />],
    [te("health.medications"), <Value key="me" value={medications.join(" · ")} />],
    [
      te("health.doctorName"),
      health.doctor_name || health.doctor_phone ? (
        <span>
          {health.doctor_name && <bdi dir="auto">{health.doctor_name}</bdi>}
          {health.doctor_name && health.doctor_phone && " · "}
          {health.doctor_phone && <span dir="ltr">{formatPhone(health.doctor_phone)}</span>}
        </span>
      ) : (
        "—"
      ),
    ],
    [te("health.dietary"), <Value key="di" value={health.dietary_restrictions} />],
  ];
  if (health.emergency_notes) {
    healthFacts.push([tc("labels.notes"), <Value key="no" value={health.emergency_notes} />]);
  }

  return (
    <Sheet locale={locale}>
      <Letterhead tenant={tenant} republic={tr("republic")} />
      <h2 className="text-center text-xl font-bold tracking-wide">{t("fiche")}</h2>

      <SectionTitle>{t("child")}</SectionTitle>
      <table className="w-full border-collapse">
        <tbody>
          {childRows.map((row, i) => (
            <tr key={i}>
              {row.map(([label, value], j) => (
                <Cell key={j} label={label} value={value} span={row.length === 1 ? 3 : 1} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <SectionTitle>{t("guardians")}</SectionTitle>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={cn(th, "w-[34mm]")} />
            {columns.map((g, i) => (
              <th key={i} className={th}>
                {g ? te(`guardians.relationships.${g.relationship}`) : " "}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <GuardianRow
            label={tc("labels.name")}
            columns={columns}
            render={(g) => (
              <>
                <div className="font-medium">
                  <Value value={`${g.first_name} ${g.last_name}`} />
                </div>
                {g.first_name_ar && g.last_name_ar && (
                  <div className="text-black/60">
                    <bdi dir="auto">{`${g.first_name_ar} ${g.last_name_ar}`}</bdi>
                  </div>
                )}
              </>
            )}
          />
          <GuardianRow
            label={te("guardians.phone")}
            columns={columns}
            render={(g) => <Value value={formatPhone(g.phone)} ltr />}
          />
          <GuardianRow
            label={te("guardians.phoneAlt")}
            columns={columns}
            render={(g) => <Value value={formatPhone(g.phone_alt)} ltr />}
          />
          <GuardianRow label={tc("labels.email")} columns={columns} render={(g) => <Value value={g.email} ltr />} />
          <GuardianRow
            label={te("guardians.nationalId")}
            columns={columns}
            render={(g) => <Value value={g.national_id} ltr />}
          />
          <GuardianRow label={te("guardians.address")} columns={columns} render={(g) => <Value value={g.address} />} />
          <GuardianRow
            label={te("guardians.workplace")}
            columns={columns}
            render={(g) => <Value value={g.workplace} />}
          />
          <GuardianRow label={t("authorised")} columns={columns} render={(g) => (g.can_pickup ? yes : no)} />
        </tbody>
      </table>

      <SectionTitle>{t("health")}</SectionTitle>
      <table className="w-full border-collapse">
        <tbody>
          {healthFacts.map(([label, value], i) => (
            <tr key={i}>
              <Cell label={label} value={value} span={1} />
            </tr>
          ))}
        </tbody>
      </table>

      <SectionTitle>{t("pickups")}</SectionTitle>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>{tc("labels.name")}</th>
            <th className={th}>{te("guardians.relationship")}</th>
            <th className={cn(th, "w-[40mm]")}>{tc("labels.phone")}</th>
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2].map((i) => (
            <tr key={i}>
              <td className={cn(td, "h-9")} />
              <td className={cn(td, "h-9")} />
              <td className={cn(td, "h-9")} />
            </tr>
          ))}
        </tbody>
      </table>

      {dossier && activeLines.length > 0 && (
        <>
          <SectionTitle>{t("documents")}</SectionTitle>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>{tc("dossier.piece")}</th>
                <th className={cn(th, "w-[40mm]")}>{tc("labels.status")}</th>
              </tr>
            </thead>
            <tbody>
              {activeLines.map((line) => (
                <tr key={line.id}>
                  <td className={td}>
                    <bdi dir="auto">{requirementName(line, locale)}</bdi>
                    {!line.required && <span className="text-black/60"> · {tc("dossier.optional")}</span>}
                  </td>
                  <td className={td}>{line.state === "missing" ? "—" : tc(`dossier.states.${line.state}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="mt-6 text-xs leading-relaxed">{t("engagement")}</p>
      <DoneAt label={t("doneAt")} />
      <div className="mt-4 grid grid-cols-2 gap-8">
        <SignatureBox label={t("signGuardian")} />
        <SignatureBox label={t("signDirector")} />
      </div>
    </Sheet>
  );
}

/** One label cell and its value; `span` stretches the value across the row. */
function Cell({ label, value, span }: { label: string; value: React.ReactNode; span: number }) {
  return (
    <>
      <th className={cn(th, "w-[34mm] font-semibold")} scope="row">
        {label}
      </th>
      <td className={td} colSpan={span}>
        {value}
      </td>
    </>
  );
}

/** One row of the guardians table: the label, then the same fact for each guardian — or a blank to fill in. */
function GuardianRow({
  label,
  columns,
  render,
}: {
  label: string;
  columns: ReadonlyArray<AppGuardianPayload | null>;
  render: (guardian: AppGuardianPayload) => React.ReactNode;
}) {
  return (
    <tr>
      <th className={th} scope="row">
        {label}
      </th>
      {columns.map((g, i) => (
        <td key={i} className={cn(td, !g && "h-8")}>
          {g ? render(g) : null}
        </td>
      ))}
    </tr>
  );
}

/**
 * The Demande d'inscription manuscrite: the letter the décret asks the
 * guardian to write by hand, as a template — their name, address and phone
 * pre-filled when the file knows them, the addressee, the subject, and
 * fourteen ruled lines to write on.
 */
export async function DemandeSheet({ locale, tenant, guardian }: DemandeSheetProps) {
  const [t, tr] = await Promise.all([getTranslations("enroll.print"), getTranslations("reports.print")]);
  // French sets a space before the colon; English and Arabic do not.
  const colon = locale === "fr" ? " : " : ": ";
  const name = guardian ? `${guardian.first_name} ${guardian.last_name}`.trim() : "";

  return (
    <Sheet locale={locale}>
      <Letterhead tenant={tenant} republic={tr("republic")} />

      <div className="space-y-2.5 text-sm">
        <p>
          {t("requestGuardian")}
          {colon}
          {name ? <bdi dir="auto" className="font-medium">{name}</bdi> : <Blank className="min-w-[70mm]" />}
        </p>
        <p>
          {t("address")}
          {colon}
          {guardian?.address ? <bdi dir="auto">{guardian.address}</bdi> : <Blank className="min-w-[70mm]" />}
        </p>
        <p>
          {t("phone")}
          {colon}
          {guardian?.phone ? <span dir="ltr">{formatPhone(guardian.phone)}</span> : <Blank />}
        </p>
      </div>

      {/* The addressee wraps the tenant name in its own bidi run: an Arabic
          establishment named inside a French sentence would otherwise pull
          the closing parenthesis to the wrong side. */}
      <p className="mt-8 text-end text-sm">
        {t.rich("requestTo", { name: () => <bdi dir="auto">{tenant.name}</bdi> })}
      </p>

      <p className="mt-6 text-sm font-semibold">{t("requestSubject")}</p>
      <p className="mt-1 text-[9pt] text-black/55">{t("requestHint")}</p>

      <div className="mt-2" aria-hidden>
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="h-[11mm] border-b border-black/40" />
        ))}
      </div>

      <DoneAt label={t("doneAt")} />
      <div className="mt-4 grid grid-cols-2 gap-8">
        <div />
        <SignatureBox label={t("signatureGuardian")} />
      </div>
    </Sheet>
  );
}
