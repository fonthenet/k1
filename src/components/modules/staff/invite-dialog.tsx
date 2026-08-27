"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
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
import { createLocalMember, inviteStaff } from "./actions";

export function InviteDialog() {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("educator");
  const [jobTitle, setJobTitle] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  // "invite" mails a link to someone with an account; "local" adds a person who
  // has no email and never will — a cook, a driver — and hands over a code.
  const [mode, setMode] = useState<"invite" | "local">("local");
  const [fullName, setFullName] = useState("");
  const [payType, setPayType] = useState<"monthly" | "hourly">("monthly");
  const [rate, setRate] = useState("");
  const [issued, setIssued] = useState<{ staffCode: string; pinCode: string } | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setEmail("");
      setRole("educator");
      setJobTitle("");
      setLink(null);
      setCopied(false);
      setMode("local");
      setFullName("");
      setPayType("monthly");
      setRate("");
      setIssued(null);
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
        });
        if (res.ok) {
          setIssued({ staffCode: res.data.staffCode, pinCode: res.data.pinCode });
          toast.success(t("local.created"));
        } else {
          toast.error(t(`errors.${res.error}`));
        }
        return;
      }
      const res = await inviteStaff({ email, role, jobTitle: jobTitle || undefined });
      if (res.ok) {
        setLink(res.data.link);
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
                ? t("invite.linkHelp", { email })
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
              <div className="grid gap-2">
                <Label htmlFor="invite-email">{t("invite.email")}</Label>
                <Input
                  id="invite-email"
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="exemple@email.com"
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label>{t("invite.role")}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
                <SelectTrigger className="w-full">
                  {/* Only the role name collapses into the trigger — the
                      descriptions live in the list, where they help you choose. */}
                  <SelectValue>{t(`roles.${role}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STAFF_ROLES.map((r) => (
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
                disabled={
                  pending ||
                  (mode === "local" ? fullName.trim().length < 2 : !email.includes("@"))
                }
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
