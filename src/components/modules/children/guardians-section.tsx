"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Ellipsis, Phone, ScanLine, Star, TriangleAlert, UserPlus, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { childDisplayName, formatPhone, telHref } from "@/lib/format";
import type { Relationship } from "@/lib/types";
import { addGuardian, linkGuardian, unlinkGuardian } from "./actions";
import { GuardianPhotoControl } from "./photo-controls";
import {
  GuardianCredentialsControl,
  type GuardianCredentialState,
} from "./guardian-credentials-control";
import { CredentialCards } from "@/components/modules/credentials/credential-cards";
import { IssueCardDialog } from "@/components/modules/credentials/issue-card-dialog";
import { GuardianPortalAccess } from "./guardian-portal-access";
import type { CredentialRow } from "@/components/modules/credentials/types";
import { RELATIONSHIPS, type GuardianLink, type GuardianOption } from "./types";

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  firstNameAr: "",
  lastNameAr: "",
  relationship: "father" as Relationship,
  phone: "",
  phoneAlt: "",
  email: "",
  nationalId: "",
  address: "",
  workplace: "",
};

const EMPTY_FLAGS = { isPrimary: false, canPickup: true, isFinancial: false };

function AddGuardianDialog({
  childId,
  available,
}: {
  childId: string;
  available: GuardianOption[];
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"new" | "existing">("new");
  // A parent typed in by hand whose number already belongs to somebody. Held
  // here rather than toasted away, because the useful thing is the record it
  // found — one press links to it instead of making a second copy.
  const [dupe, setDupe] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [flags, setFlags] = useState(EMPTY_FLAGS);
  const [existingId, setExistingId] = useState("");
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof EMPTY_FORM) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const canSubmit =
    !pending &&
    (mode === "existing"
      ? existingId !== ""
      : form.firstName.trim() && form.lastName.trim() && form.phone.trim());

  function submit(force = false) {
    if (!canSubmit) return;
    startTransition(async () => {
      const res =
        mode === "existing"
          ? await linkGuardian(childId, existingId, flags)
          : await addGuardian(
              childId,
              {
                firstName: form.firstName,
                lastName: form.lastName,
                firstNameAr: form.firstNameAr || undefined,
                lastNameAr: form.lastNameAr || undefined,
                relationship: form.relationship,
                phone: form.phone,
                phoneAlt: form.phoneAlt || undefined,
                email: form.email || undefined,
                nationalId: form.nationalId || undefined,
                address: form.address || undefined,
                workplace: form.workplace || undefined,
              },
              flags,
              force
            );
      if (res.ok) {
        toast.success(t("toasts.linked"));
        setOpen(false);
        setForm(EMPTY_FORM);
        setFlags(EMPTY_FLAGS);
        setExistingId("");
        router.refresh();
      } else if (res.error === "existingPhone") {
        setDupe(res.match);
      } else {
        toast.error(res.error === "duplicate" ? t("toasts.duplicate") : t("toasts.error"));
      }
    });
  }

  /** Attach the record we found instead of creating a second one. */
  function linkFound() {
    if (!dupe) return;
    startTransition(async () => {
      const res = await linkGuardian(childId, dupe.id, flags);
      if (res.ok) {
        toast.success(t("toasts.linked"));
        setOpen(false);
        setForm(EMPTY_FORM);
        setFlags(EMPTY_FLAGS);
        setExistingId("");
        setDupe(null);
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus data-icon="inline-start" />
          {t("guardians.add")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("guardians.addTitle")}</DialogTitle>
          <DialogDescription>{t("guardians.addDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <Button
            type="button"
            size="sm"
            variant={mode === "new" ? "outline" : "ghost"}
            className="flex-1"
            onClick={() => setMode("new")}
          >
            {t("guardians.modeNew")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "existing" ? "outline" : "ghost"}
            className="flex-1"
            onClick={() => setMode("existing")}
          >
            {t("guardians.modeExisting")}
          </Button>
        </div>

        {mode === "existing" ? (
          <div className="grid gap-1.5">
            <Label>{t("guardians.selectGuardian")}</Label>
            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("guardians.noneAvailable")}</p>
            ) : (
              <Select value={existingId} onValueChange={setExistingId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("guardians.selectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {available.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {/* The phone is isolated as LTR: after an Arabic name the
                          bidi algorithm reverses the digit groups ("56 34 12 0550"),
                          and this number is what a secretary uses to tell two
                          parents with the same name apart. Only the span is
                          isolated — a dir on the item would flip the name too.
                          Radix clones these children into the closed trigger, so
                          the fix covers both. */}
                      {g.label} —{" "}
                      <span dir="ltr" className="tabular-nums">
                        {formatPhone(g.phone)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="g-first">{t("form.firstName")}</Label>
              <Input
                id="g-first"
                value={form.firstName}
                onChange={(e) => set("firstName")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-last">{t("form.lastName")}</Label>
              <Input
                id="g-last"
                value={form.lastName}
                onChange={(e) => set("lastName")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-first-ar">{t("form.firstNameAr")}</Label>
              <Input
                id="g-first-ar"
                dir="rtl"
                value={form.firstNameAr}
                onChange={(e) => set("firstNameAr")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-last-ar">{t("form.lastNameAr")}</Label>
              <Input
                id="g-last-ar"
                dir="rtl"
                value={form.lastNameAr}
                onChange={(e) => set("lastNameAr")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("guardians.relationship")}</Label>
              <Select
                value={form.relationship}
                onValueChange={(v) => setForm((f) => ({ ...f, relationship: v as Relationship }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATIONSHIPS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`guardians.relationships.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-phone">{t("guardians.phone")}</Label>
              <Input
                id="g-phone"
                type="tel"
                dir="ltr"
                value={form.phone}
                onChange={(e) => set("phone")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-phone-alt">{t("guardians.phoneAlt")}</Label>
              <Input
                id="g-phone-alt"
                type="tel"
                dir="ltr"
                value={form.phoneAlt}
                onChange={(e) => set("phoneAlt")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-email">{t("guardians.email")}</Label>
              <Input
                id="g-email"
                type="email"
                dir="ltr"
                value={form.email}
                onChange={(e) => set("email")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-nid">{t("guardians.nationalId")}</Label>
              <Input
                id="g-nid"
                value={form.nationalId}
                onChange={(e) => set("nationalId")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-work">{t("guardians.workplace")}</Label>
              <Input
                id="g-work"
                value={form.workplace}
                onChange={(e) => set("workplace")(e.target.value)}
              />
            </div>
            <div className="col-span-2 grid gap-1.5">
              <Label htmlFor="g-address">{t("guardians.address")}</Label>
              <Input
                id="g-address"
                value={form.address}
                onChange={(e) => set("address")(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="grid gap-2.5 rounded-lg border p-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={flags.canPickup}
              onCheckedChange={(v) => setFlags((f) => ({ ...f, canPickup: v === true }))}
            />
            {t("guardians.canPickup")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={flags.isFinancial}
              onCheckedChange={(v) => setFlags((f) => ({ ...f, isFinancial: v === true }))}
            />
            {t("guardians.isFinancial")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={flags.isPrimary}
              onCheckedChange={(v) => setFlags((f) => ({ ...f, isPrimary: v === true }))}
            />
            {t("guardians.isPrimary")}
          </label>
        </div>

        {/* The number already belongs to somebody. Offer that record first —
            making a second copy of a parent is how a family ends up with two
            half-filled files and no portal account on the one being used. */}
        {dupe && mode === "new" && (
          <div className="rounded-xl bg-gold-muted/60 p-3 text-sm text-gold-ink ring-1 ring-gold/25">
            <p className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t("guardians.duplicatePhone", { name: dupe.name })}</span>
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button size="sm" onClick={linkFound} disabled={pending}>
                {t("guardians.linkFound", { name: dupe.name })}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setDupe(null);
                  submit(true);
                }}
              >
                {t("guardians.createAnyway")}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={() => submit()} disabled={!canSubmit}>
            {tc("actions.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GuardiansSection({
  tenantId,
  childId,
  links,
  available,
  credentials,
  guardianCards,
  canManageCredentials = false,
  now,
}: {
  /** Needed to build the guardian photo storage prefix. */
  tenantId: string;
  childId: string;
  links: GuardianLink[];
  available: GuardianOption[];
  /** guardian_id → door-credential state. Admin-only; omitted for other staff. */
  credentials?: Record<string, GuardianCredentialState>;
  /** guardian_id → their proximity cards. Admin-only, same as above. */
  guardianCards?: Record<string, CredentialRow[]>;
  canManageCredentials?: boolean;
  /** The server's clock, passed down so invite expiry is computed from props
   *  rather than a `Date.now()` read during render. */
  now: string;
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const tCred = useTranslations("credentials");
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();
  // The guardian whose removal is being confirmed — one dialog for the list,
  // opened from each row's overflow.
  const [unlinking, setUnlinking] = useState<string | null>(null);
  // The guardian a card is being scanned for, from the same overflow. The
  // page's band already offers "Scanner une carte" for everyone on the file;
  // the row keeps the verb in its menu rather than as a second button.
  const [scanningFor, setScanningFor] = useState<GuardianLink | null>(null);

  function unlink(guardianId: string) {
    startTransition(async () => {
      const res = await unlinkGuardian(childId, guardianId);
      if (res.ok) {
        toast.success(t("toasts.unlinked"));
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <SectionCard
      icon={Users}
      tone={0}
      title={t("guardians.title")}
      action={<AddGuardianDialog childId={childId} available={available} />}
      contentClassName="gap-0"
    >
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("guardians.empty")}</p>
      ) : (
        <div className="divide-y divide-border">
          {links.map((g) => {
            const cards = guardianCards?.[g.guardian_id] ?? [];
            return (
              <div key={g.guardian_id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  {/* The face staff compare with the adult at the door — tap
                      to set it. The camera affordance shows on hover and
                      focus only, so the gold star stays the one mark on the
                      principal's row. */}
                  <div className="shrink-0 [&_button>span.absolute]:opacity-0 [&_button>span.absolute]:transition-opacity [&_button:focus-visible>span.absolute]:opacity-100 [&_button:hover>span.absolute]:opacity-100">
                    <GuardianPhotoControl
                      tenantId={tenantId}
                      guardianId={g.guardian_id}
                      childId={childId}
                      name={childDisplayName(g, locale)}
                      firstName={g.first_name}
                      lastName={g.last_name}
                      photoPath={g.photo_path}
                      photoUrl={g.photoUrl}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* "Principal" is one mark: the gold star before the name.
                          No badge, no tinted frame — the roles that follow are
                          plain words after the relation. */}
                      {g.is_primary && (
                        <Star
                          className="size-4 fill-gold text-gold"
                          aria-label={t("guardians.primaryBadge")}
                        />
                      )}
                      <bdi dir="auto" className="font-semibold text-start">
                        {childDisplayName(g, locale)}
                      </bdi>
                      <span className="text-xs text-muted-foreground">
                        {[
                          t(`guardians.relationships.${g.relationship}`),
                          g.can_pickup ? t("guardians.canPickupBadge") : null,
                          g.is_financial ? t("guardians.financialBadge") : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <a
                        href={telHref(g.phone)}
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                        dir="ltr"
                      >
                        <Phone className="size-3.5" />
                        {formatPhone(g.phone)}
                      </a>
                      {g.phone_alt && (
                        <a
                          href={telHref(g.phone_alt)}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          dir="ltr"
                        >
                          <Phone className="size-3.5" />
                          {formatPhone(g.phone_alt)}
                        </a>
                      )}
                      {g.email && <span dir="ltr">{g.email}</span>}
                      {g.national_id && (
                        <span>
                          {t("guardians.nationalId")}: {g.national_id}
                        </span>
                      )}
                    </div>
                    {(g.address || g.workplace) && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {[g.address, g.workplace].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  {/* The row's only control: an overflow holding the one
                      destructive verb, never a red trash icon on the row. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={t("profile.more")}>
                        <Ellipsis className="text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canManageCredentials && (
                        <>
                          <DropdownMenuItem onSelect={() => setScanningFor(g)}>
                            <ScanLine />
                            {tCred("scan.title")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setUnlinking(g.guardian_id)}
                      >
                        <UserMinus />
                        {t("guardians.unlink")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* How this adult proves who they are, on one line under the
                    contact details: the portal account, then the door badge
                    and PIN, then the proximity cards once there are any.
                    Admin-only. Enrolling a card is in the row's overflow and
                    in the page's band, so the list comes without its button
                    and is absent altogether while it would be empty. */}
                {canManageCredentials && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-2 ps-15 text-sm">
                    <GuardianPortalAccess
                      guardianId={g.guardian_id}
                      guardianName={childDisplayName(g, locale)}
                      phone={g.phone || null}
                      hasAccount={g.hasAccount}
                      email={g.email || null}
                      claim={g.claim}
                      now={now}
                    />
                    <GuardianCredentialsControl
                      childId={childId}
                      guardianId={g.guardian_id}
                      credential={
                        credentials?.[g.guardian_id] ?? { tagCode: null, hasPin: false }
                      }
                    />
                    {cards.length > 0 && (
                      <div className="basis-full">
                        <CredentialCards
                          subjectType="guardian"
                          subjectId={g.guardian_id}
                          cards={cards}
                          path={`/children/${childId}`}
                          withAddButton={false}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {scanningFor && (
        <IssueCardDialog
          subjectType="guardian"
          subjectId={scanningFor.guardian_id}
          open
          onOpenChange={(o) => !o && setScanningFor(null)}
          path={`/children/${childId}`}
          personName={childDisplayName(scanningFor, locale)}
        />
      )}

      <AlertDialog open={unlinking !== null} onOpenChange={(o) => !o && setUnlinking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("guardians.unlinkTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("guardians.unlinkDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = unlinking;
                setUnlinking(null);
                if (id) unlink(id);
              }}
            >
              {tc("actions.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}
