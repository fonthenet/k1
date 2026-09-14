"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, MoreHorizontal } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  forKind,
  requirementDescription,
  requirementName,
  type DocumentRequirement,
  type DossierKind,
  type SignedUrlMap,
} from "@/lib/dossier";
import {
  deleteRequirement, moveRequirement, removeRequirementForm, restoreLegalList, setRequirementActive,
} from "./actions";
import { RequirementDialog } from "./requirement-dialog";

/** The roster's head style: sentence case, muted, never uppercase. */
const HEAD = "text-sm font-medium text-muted-foreground";
/** The two lists, in the order the page shows them: the crèche's, then the école's. */
const KIND_ORDER: readonly DossierKind[] = ["early", "school"];
/** Pièce · Concerne · Validité · Obligatoire · Active · overflow. */
const COLUMNS = 6;

export interface DossierTableProps {
  /** Active AND inactive, ordered by kind, sort_order. */
  requirements: ReadonlyArray<DocumentRequirement>;
  /** distinct kg_center_kind of the active structures; ['early'] when none. */
  kinds: ReadonlyArray<DossierKind>;
  /** form_path → signed URL. */
  formUrls: SignedUrlMap;
}

/**
 * The register of what the establishment asks for, one card, one table.
 * A building that runs both a crèche and an école sees two groups inside
 * the same card, never two cards; a crèche sees one flat list. An inactive
 * row reads muted with its switch off and keeps its place, because switching
 * it back on must put it back where it was.
 */
export function DossierTable({ requirements, kinds, formUrls }: DossierTableProps) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [editing, setEditing] = useState<DocumentRequirement | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [opening, setOpening] = useState(0);

  // A kind is shown when it has rows — the tenant's own kinds, plus a list
  // left behind by a structure since retired, which the director must still
  // be able to see and clear. Group rows only when there are two.
  const shownKinds = KIND_ORDER.filter((kind) => requirements.some((r) => r.kind === kind));
  const grouped = shownKinds.length > 1;

  function edit(req: DocumentRequirement) {
    setEditing(req);
    setOpening((n) => n + 1);
    setEditOpen(true);
  }

  return (
    <>
      <Card className="overflow-hidden border border-border py-0 shadow-sm ring-0">
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={HEAD}>{t("dossier.columns.piece")}</TableHead>
                {/* Dropped before the table clips at 1024: the name cell
                    already says who the paper is about in its description. */}
                <TableHead className={cn(HEAD, "hidden xl:table-cell")}>
                  {t("dossier.columns.appliesTo")}
                </TableHead>
                <TableHead className={HEAD}>{t("dossier.columns.validity")}</TableHead>
                <TableHead className={HEAD}>{t("dossier.columns.required")}</TableHead>
                <TableHead className={HEAD}>{t("dossier.columns.active")}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t("enrollment.columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownKinds.map((kind) => {
                const rows = forKind(requirements, kind);
                return (
                  <Fragment key={kind}>
                    {grouped && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={COLUMNS} className="py-1.5">
                          <span className="block text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                            {tc(`dossier.kinds.${kind}`)}
                          </span>
                          {/* The law the crèche's list comes from, once, where
                              the list starts; the école's follows the MEN's
                              circulars and names none. */}
                          {kind === "early" && (
                            <span className="block text-xs text-muted-foreground">
                              {t("dossier.legalNote")}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    {rows.map((req, i) => (
                      <RequirementRow
                        key={req.id}
                        requirement={req}
                        formUrl={req.form_path ? (formUrls[req.form_path] ?? null) : null}
                        first={i === 0}
                        last={i === rows.length - 1}
                        onEdit={() => edit(req)}
                      />
                    ))}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {editing && (
        <RequirementDialog
          key={opening}
          open={editOpen}
          onOpenChange={setEditOpen}
          requirement={editing}
          kinds={kinds}
          formUrl={editing.form_path ? (formUrls[editing.form_path] ?? null) : null}
        />
      )}
    </>
  );
}

function RequirementRow({
  requirement: req,
  formUrl,
  first,
  last,
  onEdit,
}: {
  requirement: DocumentRequirement;
  formUrl: string | null;
  first: boolean;
  last: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const name = requirementName(req, locale);
  // The other script under the name: Arabic under a French page, French
  // under an Arabic one — so a director checks both at a glance.
  const otherName = locale === "ar" ? (req.name_ar ? req.name : null) : req.name_ar;
  const description = requirementDescription(req, locale);

  return (
    <TableRow className={cn("h-14 transition-colors hover:bg-muted/40", !req.active && "text-muted-foreground")}>
      <TableCell className="max-w-md">
        <div className="min-w-0 py-1">
          <span className={cn("block text-start font-medium", req.active && "text-foreground")}>
            <bdi dir="auto">{name}</bdi>
          </span>
          {otherName && (
            <span className="block text-xs text-muted-foreground">
              <bdi dir="auto">{otherName}</bdi>
            </span>
          )}
          {description && (
            <span className="block text-xs text-muted-foreground">
              <bdi dir="auto">{description}</bdi>
            </span>
          )}
          {req.form_path &&
            (formUrl ? (
              <a
                href={formUrl}
                target="_blank"
                rel="noreferrer"
                className="relative z-10 mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Download className="size-3" aria-hidden />
                {tc("dossier.form")} · <bdi dir="auto">{req.form_name}</bdi>
              </a>
            ) : (
              <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Download className="size-3" aria-hidden />
                {tc("dossier.form")} · <bdi dir="auto">{req.form_name}</bdi>
              </span>
            ))}
        </div>
      </TableCell>
      <TableCell className="hidden text-muted-foreground xl:table-cell">
        {tc(`dossier.appliesTo.${req.applies_to}`)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {req.valid_months ? t("dossier.validity.months", { count: req.valid_months }) : "—"}
      </TableCell>
      <TableCell>
        {/* Required is the expected state and renders nothing; the one
            word is spent on the exception. */}
        {!req.required && <span className="text-muted-foreground">{tc("dossier.optional")}</span>}
      </TableCell>
      <TableCell>
        <ActiveSwitch id={req.id} name={name} active={req.active} />
      </TableCell>
      <TableCell className="text-end">
        <RowMenu requirement={req} first={first} last={last} onEdit={onEdit} />
      </TableCell>
    </TableRow>
  );
}

/** The enrollment link's switch idiom: optimistic, reverted with a toast when the database refuses. */
function ActiveSwitch({ id, name, active }: { id: string; name: string; active: boolean }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [checked, setChecked] = useState(active);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setChecked(next);
    startTransition(async () => {
      const res = await setRequirementActive(id, next);
      if (!res.ok) {
        setChecked(!next);
        toast.error(t(`errors.${res.error}`));
        return;
      }
      router.refresh();
    });
  }

  return (
    <Switch
      checked={checked}
      disabled={pending}
      onCheckedChange={toggle}
      // Eighteen switches named "Active" are indistinguishable to a screen
      // reader; the row's name tells them apart.
      aria-label={`${t("dossier.columns.active")} · ${name}`}
    />
  );
}

/**
 * Everything a row can do, behind one overflow: edit, move within its list,
 * take the form off, retire the row. The two removals confirm first, in
 * dialogs that live beside the menu rather than inside it — a menu's content
 * unmounts as it closes and would take its dialog with it. The second may be
 * refused by the database when papers already hang on the row, and the toast
 * then says what to do instead of retiring it.
 */
function RowMenu({
  requirement: req,
  first,
  last,
  onEdit,
}: {
  requirement: DocumentRequirement;
  first: boolean;
  last: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [removingForm, setRemovingForm] = useState(false);
  const [pending, startTransition] = useTransition();

  function move(direction: "up" | "down") {
    startTransition(async () => {
      const res = await moveRequirement(req.id, direction);
      if (res.ok) router.refresh();
      else toast.error(t(`errors.${res.error}`));
    });
  }

  function removeForm() {
    startTransition(async () => {
      const res = await removeRequirementForm(req.id);
      if (res.ok) {
        setRemovingForm(false);
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteRequirement(req.id);
      if (res.ok) {
        toast.success(t("dossier.toasts.removed"));
        setRemoving(false);
        router.refresh();
      } else if (res.error === "referenced") {
        toast.error(t("dossier.removeRefused"));
        setRemoving(false);
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("enrollment.more")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>{tc("actions.edit")}</DropdownMenuItem>
          <DropdownMenuItem disabled={first || pending} onSelect={() => move("up")}>
            {t("dossier.moveUp")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={last || pending} onSelect={() => move("down")}>
            {t("dossier.moveDown")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {req.form_path && (
            <DropdownMenuItem onSelect={() => setRemovingForm(true)}>{t("dossier.formRemove")}</DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(true)}>
            {t("dossier.remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={removingForm} onOpenChange={setRemovingForm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dossier.formRemove")}</AlertDialogTitle>
            <AlertDialogDescription>{t("dossier.formRemoveDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={removeForm}>
              {t("dossier.formRemove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dossier.remove")}</AlertDialogTitle>
            <AlertDialogDescription>{t("dossier.removeDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={remove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("dossier.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * "Rétablir la liste réglementaire", behind the one sentence that states
 * what it does to a tenant that existed before the register: the seeded
 * rows come on, and every child already enrolled reads "Dossier incomplet"
 * until their papers are added (D14). Rendered as the page's "…" menu next
 * to the primary while the table has rows, and as the empty state's outline
 * action when it has none — the same confirmation either way.
 */
export function RestoreListAction({ variant }: { variant: "menu" | "button" }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function restore() {
    startTransition(async () => {
      const res = await restoreLegalList();
      if (res.ok) {
        toast.success(t("dossier.restored", { count: res.count }));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <>
      {variant === "menu" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("enrollment.more")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuItem onSelect={() => setOpen(true)} className="whitespace-nowrap">
              {t("dossier.restore")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          {t("dossier.restore")}
        </Button>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dossier.restore")}</AlertDialogTitle>
            <AlertDialogDescription>{t("dossier.restoreDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={restore}>
              {t("dossier.restore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
