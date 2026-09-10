"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy, KeyRound, UserPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { centerTypeOption } from "@/components/modules/settings/center-types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { STAFF_ROLES } from "./maps";
import type { StaffRole } from "./staff-types";
import { createLocalMember, inviteStaff, listUnlinkedMembers, type UnlinkedMember } from "./actions";

// Ownership is transferred by editing a member, never handed out through a
// link or typed in as a cook's role — see inviteRoleSchema in ./actions.
const INVITABLE_ROLES = STAFF_ROLES.filter((r) => r !== "owner");

// Radix Select cannot represent "nothing chosen" with an empty string.
const NEW_MEMBER = "__new__";

export function InviteDialog({ structures = [] }: { structures?: Structure[] }) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const locale = useLocale();
  // Where the person will work — asked at the hire, because that is when the
  // director knows. Several may be ticked (the cook feeds both sides). Shown
  // only for a building with more than one structure.
  const placeable = structures.filter((s) => s.active);
  const [structureIds, setStructureIds] = useState<Set<string>>(new Set());
  const toggleStructure = (id: string) =>
    setStructureIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [open, setOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<StaffRole>("educator");
  const [jobTitle, setJobTitle] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [boundTo, setBoundTo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  // "invite" creates a link that grants the chosen role to whoever accepts
  // it — nothing is mailed; the director forwards it herself. "local" adds a
  // person who has no email and never will — a cook, a driver — and hands
  // over a code.
  const [mode, setMode] = useState<"invite" | "local">("local");
  const [fullName, setFullName] = useState("");
  const [payType, setPayType] = useState<"monthly" | "hourly">("monthly");
  const [rate, setRate] = useState("");
  const [issued, setIssued] = useState<{ staffCode: string; pinCode: string } | null>(null);
  // Name-only members the link could attach a login to. Loaded once, the
  // first time the invite tab is opened, so the common "create directly"
  // path costs nothing extra.
  const [members, setMembers] = useState<UnlinkedMember[] | null>(null);
  const [attachTo, setAttachTo] = useState<string>(NEW_MEMBER);

  useEffect(() => {
    if (!open || mode !== "invite" || members !== null) return;
    let cancelled = false;
    listUnlinkedMembers().then((res) => {
      if (!cancelled) setMembers(res.ok ? res.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, mode, members]);

  const attached = members?.find((m) => m.id === attachTo) ?? null;
  const effectiveRole = attached?.role ?? role;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setIdentifier("");
      setRole("educator");
      setJobTitle("");
      setLink(null);
      setBoundTo(null);
      setCopied(false);
      setMode("local");
      setFullName("");
      setPayType("monthly");
      setRate("");
      setIssued(null);
      setMembers(null);
      setAttachTo(NEW_MEMBER);
    }
  }

  function submit() {
    startTransition(async () => {
      if (mode === "local") {
        const amount = rate.trim() === "" ? null : Number(rate);
        if (amount != null && (Number.isNaN(amount) || amount < 0)) {
          toast.error(t("errors.invalid"));
          return;
        }
        const res = await createLocalMember({
          fullName,
          role,
          jobTitle: jobTitle || undefined,
          payType,
          baseSalary: payType === "monthly" ? amount : null,
          hourlyRate: payType === "hourly" ? amount : null,
          structureIds: [...structureIds],
        });
        if (res.ok) {
          setIssued({ staffCode: res.data.staffCode, pinCode: res.data.pinCode });
          toast.success(t("local.created"));
        } else {
          toast.error(t(`errors.${res.error}`));
        }
        return;
      }
      const res = await inviteStaff({
        identifier: identifier.trim() || undefined,
        role: effectiveRole === "owner" ? "admin" : effectiveRole,
        jobTitle: jobTitle || undefined,
        membershipId: attached?.id,
        structureIds: [...structureIds],
      });
      if (res.ok) {
        setLink(res.data.link);
        setBoundTo(res.data.boundTo);
        toast.success(t("invite.linkTitle"));
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success(t("invite.copied"));
    } catch {
      toast.error(t("errors.generic"));
    }
  }

  const roleLabel = t(`roles.${effectiveRole}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus data-icon="inline-start" />
          {t("invite.addButton")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("invite.addTitle")}</DialogTitle>
          <DialogDescription>
            {issued
              ? t("local.handOver", { name: fullName })
              : link
                ? boundTo
                  ? t("invite.linkHelpBound", { identity: boundTo })
                  : t("invite.linkHelpOpen", { role: roleLabel })
                : mode === "local"
                  ? t("local.description")
                  : t("invite.description")}
          </DialogDescription>
        </DialogHeader>

        {!link && !issued && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as "invite" | "local")}>
            <TabsList className="w-full">
              <TabsTrigger value="local" className="flex-1">{t("invite.modeLocal")}</TabsTrigger>
              <TabsTrigger value="invite" className="flex-1">{t("invite.modeInvite")}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {issued ? (
          /* The PIN is shown exactly once — same rule as guardian PINs. Nothing
             reads it back, so it is written down now or reissued later. */
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>{t("local.staffCode")}</Label>
              <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-lg font-bold tracking-widest" dir="ltr">
                {issued.staffCode}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("local.pinCode")}</Label>
              <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 font-mono text-lg font-bold tracking-widest text-primary" dir="ltr">
                {issued.pinCode}
              </div>
            </div>
            <p className="flex items-start gap-2 rounded-lg bg-gold-muted px-3 py-2 text-xs leading-relaxed text-gold-ink">
              <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {t("local.pinOnce")}
            </p>
          </div>
        ) : link ? (
          <div className="flex items-center gap-2">
            <Input readOnly value={link} className="font-mono text-xs" dir="ltr" />
            <Button variant="outline" onClick={copy}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {t("invite.copy")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {mode === "local" ? (
              <div className="grid gap-2">
                <Label htmlFor="local-name">{t("local.fullName")}</Label>
                <Input
                  id="local-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t("local.fullNamePlaceholder")}
                />
              </div>
            ) : (
              <>
                {members && members.length > 0 && (
                  <div className="grid gap-2">
                    <Label>{t("invite.attachTo")}</Label>
                    <Select value={attachTo} onValueChange={setAttachTo}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NEW_MEMBER}>{t("invite.attachNone")}</SelectItem>
                        {members.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            <div className="flex flex-col items-start gap-0.5 text-start">
                              <span>{m.fullName}</span>
                              <span className="text-xs text-muted-foreground">
                                {m.jobTitle ?? t(`roles.${m.role}`)}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {attached && (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {t("invite.attachHint", { name: attached.fullName })}
                      </p>
                    )}
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="invite-identifier">
                    {t("invite.identifier")}{" "}
                    <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
                  </Label>
                  <Input
                    id="invite-identifier"
                    dir="ltr"
                    autoComplete="off"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={t("invite.identifierPlaceholder")}
                  />
                  {/* The one sentence that keeps this honest: nothing is sent,
                      and an empty field means the link itself is the key. */}
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {identifier.trim() === ""
                      ? t("invite.openHint", { role: roleLabel })
                      : t("invite.boundHint")}
                  </p>
                </div>
              </>
            )}
            {/* A link for an existing member grants the job they already
                hold, so role and title are read from their record instead. */}
            {!attached && (
              <>
                <div className="grid gap-2">
                  <Label>{t("invite.role")}</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
                    <SelectTrigger className="w-full">
                      {/* Only the role name collapses into the trigger — the
                          descriptions live in the list, where they help you choose. */}
                      <SelectValue>{t(`roles.${role}`)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {INVITABLE_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          <div className="flex flex-col items-start gap-0.5 text-start">
                            <span>{t(`roles.${r}`)}</span>
                            <span className="text-xs text-muted-foreground">{t(`roleDescriptions.${r}`)}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="invite-job">
                    {t("invite.jobTitle")}{" "}
                    <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
                  </Label>
                  <Input
                    id="invite-job"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder={t("invite.jobTitlePlaceholder")}
                  />
                </div>
                {placeable.length > 1 && (
                  <div className="grid gap-2">
                    <Label>{t("invite.structures")}</Label>
                    <div className="flex flex-wrap gap-2">
                      {placeable.map((s) => {
                        const { Icon } = centerTypeOption(s.center_type);
                        const on = structureIds.has(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleStructure(s.id)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition",
                              on ? "border-transparent" : "border-border hover:bg-muted/50"
                            )}
                            style={
                              on
                                ? { backgroundColor: `${s.color}14`, boxShadow: `inset 0 0 0 1.5px ${s.color}` }
                                : undefined
                            }
                          >
                            <Icon className="size-3.5" style={{ color: s.color }} aria-hidden />
                            {structureName(s, locale)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-pretty text-muted-foreground">{t("invite.structuresHint")}</p>
                  </div>
                )}
              </>
            )}
            {mode === "local" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>{t("edit.payType")}</Label>
                  <Select value={payType} onValueChange={(v) => setPayType(v as "monthly" | "hourly")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">{t("payType.monthly")}</SelectItem>
                      <SelectItem value="hourly">{t("payType.hourly")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="local-rate">
                    {payType === "monthly" ? t("edit.baseSalary") : t("edit.hourlyRate")}
                  </Label>
                  <Input
                    id="local-rate"
                    type="number"
                    min={0}
                    step={payType === "monthly" ? 1000 : 50}
                    dir="ltr"
                    className="tabular-nums"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {link || issued ? (
            <Button onClick={() => onOpenChange(false)}>{tc("actions.close")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {tc("actions.cancel")}
              </Button>
              <Button
                onClick={submit}
                disabled={pending || (mode === "local" && fullName.trim().length < 2)}
              >
                {mode === "local" ? t("local.create") : t("invite.create")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
