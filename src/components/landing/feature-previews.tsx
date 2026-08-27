// The eight product miniatures that live inside the feature cards.
//
// The whole promise of this page is "here is the actual product, small".
// Each miniature below is a faithful, token-driven reduction of a real
// Rawdati screen — the admissions pipeline, the reception check-in, the
// parent thread, the monthly ledger — built only from the shared primitives
// in preview-kit.tsx so the eight of them read as one designed system.
//
// Every label comes from the `landingFeatures` namespace: the miniatures are
// fully translated, so an Arabic visitor sees an Arabic product, not an
// English screenshot with Arabic captions around it.

import {
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  ImageIcon,
  ReceiptTextIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import {
  MiniAvatar,
  MiniBars,
  MiniBubble,
  MiniPill,
  MiniRow,
  MiniStat,
} from "./preview-kit";
import { PREVIEW_WELL } from "./styles";

/* ── shared chrome ─────────────────────────────────────────────────────── */

/** The tinted well every miniature sits in. A floor height keeps the grid even. */
function Well({ children }: { children: React.ReactNode }) {
  return <div className={cn(PREVIEW_WELL, "mt-5 min-h-[10.5rem]")}>{children}</div>;
}

/** Screen title + trailing meta — the miniature's "toolbar". */
function WellHead({ title, meta }: { title: string; meta?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="truncate text-[10px] font-semibold text-muted-foreground">{title}</span>
      {meta}
    </div>
  );
}

/** Small tinted square holding a lucide glyph, used as a row's leading slot. */
function RowGlyph({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", className)}>
      {children}
    </span>
  );
}

const META_TEXT = "shrink-0 text-[9px] font-semibold text-muted-foreground tabular-nums";

/* ── 1. Online enrolment — the admissions pipeline ─────────────────────── */

const ADMISSIONS = [
  { k: "r1", avatar: "sky", pill: "primary" },
  { k: "r2", avatar: "amber", pill: "warning" },
  { k: "r3", avatar: "mint", pill: "success" },
] as const;

export async function EnrollmentPreview() {
  const t = await getTranslations("landingFeatures.items.enrollment.preview");
  return (
    <Well>
      <WellHead title={t("head")} meta={<MiniPill tone="primary">{t("count")}</MiniPill>} />
      <div className="space-y-1.5">
        {ADMISSIONS.map((r) => (
          <MiniRow
            key={r.k}
            avatar={<MiniAvatar tone={r.avatar}>{t(`${r.k}.mono`)}</MiniAvatar>}
            label={t(`${r.k}.name`)}
            sub={t(`${r.k}.sub`)}
            end={<MiniPill tone={r.pill}>{t(`${r.k}.pill`)}</MiniPill>}
          />
        ))}
      </div>
    </Well>
  );
}

/* ── 2. Badge check-in — reception roster ──────────────────────────────── */

export async function CheckinPreview() {
  const t = await getTranslations("landingFeatures.items.checkin.preview");
  return (
    <Well>
      <WellHead
        title={t("head")}
        meta={
          <span className={cn(META_TEXT, "inline-flex items-center gap-1")}>
            <ClockIcon className="size-2.5" aria-hidden />
            {t("count")}
          </span>
        }
      />
      <div className="space-y-1.5">
        {/* Allergy stays destructive everywhere it appears — safety signal. */}
        <MiniRow
          avatar={<MiniAvatar tone="pink">{t("r1.mono")}</MiniAvatar>}
          label={t("r1.name")}
          sub={t("r1.sub")}
          end={
            <span className="flex shrink-0 items-center gap-1">
              <MiniPill tone="danger">{t("r1.allergy")}</MiniPill>
              <MiniPill tone="success">{t("r1.pill")}</MiniPill>
            </span>
          }
        />
        <MiniRow
          avatar={<MiniAvatar tone="sky">{t("r2.mono")}</MiniAvatar>}
          label={t("r2.name")}
          sub={t("r2.sub")}
          end={<MiniPill tone="success">{t("r2.pill")}</MiniPill>}
        />
        <MiniRow
          avatar={<MiniAvatar tone="mint">{t("r3.mono")}</MiniAvatar>}
          label={t("r3.name")}
          sub={t("r3.sub")}
          end={<MiniPill>{t("r3.pill")}</MiniPill>}
        />
      </div>
    </Well>
  );
}

/* ── 3. Parent app — a thread from the class ───────────────────────────── */

export async function ParentAppPreview() {
  const t = await getTranslations("landingFeatures.items.parentApp.preview");
  return (
    <Well>
      <WellHead title={t("head")} meta={<span className={META_TEXT}>{t("count")}</span>} />
      <div className="space-y-1.5">
        <MiniBubble side="start">{t("educator")}</MiniBubble>
        <MiniBubble side="end">{t("parent")}</MiniBubble>
        <MiniRow
          avatar={
            <RowGlyph className="bg-tile-4 text-chart-5">
              <ImageIcon className="size-3" aria-hidden />
            </RowGlyph>
          }
          label={t("photo")}
          end={<span className={META_TEXT}>{t("photoTime")}</span>}
        />
      </div>
    </Well>
  );
}

/* ── 4. Sessions & progress — the Sun→Thu week ─────────────────────────── */

const WEEK = ["d1", "d2", "d3", "d4", "d5"] as const;

export async function SessionsPreview() {
  const t = await getTranslations("landingFeatures.items.sessions.preview");
  return (
    <Well>
      <WellHead title={t("head")} meta={<MiniPill tone="warning">{t("badge")}</MiniPill>} />
      <MiniBars values={[46, 62, 74, 95, 58]} highlight={3} />
      <div className="mt-1 flex gap-1.5">
        {WEEK.map((d) => (
          <span key={d} className="flex-1 truncate text-center text-[9px] text-muted-foreground">
            {t(d)}
          </span>
        ))}
      </div>
      <div className="mt-2.5 space-y-1 border-t border-border/60 pt-2.5">
        <MiniStat label={t("statSessions")} value={t("statSessionsValue")} />
        <MiniStat label={t("statGoals")} value={t("statGoalsValue")} />
      </div>
    </Well>
  );
}

/* ── 5. Invoicing in dinars ────────────────────────────────────────────── */

export async function InvoicingPreview() {
  const t = await getTranslations("landingFeatures.items.invoicing.preview");
  return (
    <Well>
      <div className="rounded-lg bg-card p-2.5 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[10px] font-semibold text-muted-foreground tabular-nums">
            {t("number")}
          </span>
          <MiniPill tone="success">{t("pill")}</MiniPill>
        </div>
        <div className="mt-2 truncate text-[11px] leading-tight font-semibold text-foreground">
          {t("child")}
        </div>
        <div className="truncate text-[10px] leading-tight text-muted-foreground">{t("period")}</div>
        <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-border/60 pt-2">
          <span className="text-[10px] text-muted-foreground">{t("totalLabel")}</span>
          <span className="text-[13px] font-extrabold text-foreground tabular-nums">
            {t("amount")}
          </span>
        </div>
      </div>
      <MiniRow
        className="mt-1.5"
        avatar={
          <RowGlyph className="bg-tile-2 text-success">
            <ReceiptTextIcon className="size-3" aria-hidden />
          </RowGlyph>
        }
        label={t("receipt")}
        end={<MiniPill>{t("receiptPill")}</MiniPill>}
      />
    </Well>
  );
}

/* ── 6. Built-in accounting — money in vs money out ────────────────────── */

export async function AccountingPreview() {
  const t = await getTranslations("landingFeatures.items.accounting.preview");
  return (
    <Well>
      <WellHead title={t("head")} />
      <div className="rounded-lg bg-card px-2.5 pt-2.5 pb-2 shadow-xs">
        <div
          className="flex h-12 items-end justify-center gap-4 border-b border-border/70"
          aria-hidden
        >
          <span className="w-10 rounded-t-[3px] bg-income" style={{ height: "84%" }} />
          <span className="w-10 rounded-t-[3px] bg-expense" style={{ height: "46%" }} />
        </div>
        <div className="mt-1.5 flex justify-center gap-4 text-[9px] text-muted-foreground">
          <span className="w-10 truncate text-center">{t("in")}</span>
          <span className="w-10 truncate text-center">{t("out")}</span>
        </div>
      </div>
      <div className="mt-2 space-y-1">
        <MiniStat label={t("statNet")} value={t("statNetValue")} tone="income" />
        <MiniStat label={t("statPayroll")} value={t("statPayrollValue")} tone="expense" />
      </div>
    </Well>
  );
}

/* ── 7. Team & tasks — today's checklist ───────────────────────────────── */

function TaskBox({ done }: { done: boolean }) {
  if (!done) {
    return <span className="size-4 shrink-0 rounded-[5px] border border-border bg-card" aria-hidden />;
  }
  return (
    <span
      className="grid size-4 shrink-0 place-items-center rounded-[5px] bg-success/12 text-success"
      aria-hidden
    >
      <CheckIcon className="size-2.5" />
    </span>
  );
}

const TASKS = [
  { k: "t1", done: true, pill: "neutral", row: undefined },
  { k: "t2", done: true, pill: "neutral", row: undefined },
  { k: "t3", done: false, pill: "warning", row: "bg-gold-muted/60" },
] as const;

export async function TeamPreview() {
  const t = await getTranslations("landingFeatures.items.team.preview");
  return (
    <Well>
      <WellHead title={t("head")} meta={<span className={META_TEXT}>{t("count")}</span>} />
      <div className="space-y-1.5">
        {TASKS.map((task) => (
          <MiniRow
            key={task.k}
            className={task.row}
            avatar={<TaskBox done={task.done} />}
            label={
              <span className={task.done ? "text-muted-foreground line-through" : undefined}>
                {t(`${task.k}.text`)}
              </span>
            }
            sub={t(`${task.k}.who`)}
            end={<MiniPill tone={task.pill}>{t(`${task.k}.due`)}</MiniPill>}
          />
        ))}
      </div>
    </Well>
  );
}

/* ── 8. Compliance registers ───────────────────────────────────────────── */

const REGISTERS = [
  { k: "d1", glyph: "bg-tile-2 text-success", pill: "success" },
  { k: "d2", glyph: "bg-tile-3 text-gold-ink", pill: "warning" },
  { k: "d3", glyph: "bg-tile-1 text-primary", pill: "neutral" },
] as const;

export async function CompliancePreview() {
  const t = await getTranslations("landingFeatures.items.compliance.preview");
  return (
    <Well>
      <WellHead title={t("head")} />
      <div className="space-y-1.5">
        {REGISTERS.map((d) => (
          <MiniRow
            key={d.k}
            avatar={
              <RowGlyph className={d.glyph}>
                <FileTextIcon className="size-3" aria-hidden />
              </RowGlyph>
            }
            label={t(`${d.k}.name`)}
            sub={t(`${d.k}.sub`)}
            end={<MiniPill tone={d.pill}>{t(`${d.k}.pill`)}</MiniPill>}
          />
        ))}
      </div>
    </Well>
  );
}
