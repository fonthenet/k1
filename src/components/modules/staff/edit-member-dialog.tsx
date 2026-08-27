"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Membership } from "@/lib/types";
import { STAFF_ROLES } from "./maps";
import type { StaffRole } from "./staff-types";
import { updateMember } from "./actions";

export function EditMemberDialog({ member, name }: { member: Membership; name: string }) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<StaffRole>(member.role === "parent" ? "staff" : member.role);
  const [jobTitle, setJobTitle] = useState(member.job_title ?? "");
  const [payType, setPayType] = useState<"monthly" | "hourly">(member.pay_type ?? "monthly");
  const [baseSalary, setBaseSalary] = useState(member.base_salary != null ? String(member.base_salary) : "");
  const [hourlyRate, setHourlyRate] = useState(member.hourly_rate != null ? String(member.hourly_rate) : "");
  const [staffCode, setStaffCode] = useState(member.staff_code ?? "");
  const [pinCode, setPinCode] = useState(member.pin_code ?? "");
  const [status, setStatus] = useState<"active" | "disabled">(member.status === "disabled" ? "disabled" : "active");
  const [pending, startTransition] = useTransition();

  function submit() {
    const raw = payType === "monthly" ? baseSalary : hourlyRate;
    const rate = raw.trim() === "" ? null : Number(raw);
    if (rate != null && (Number.isNaN(rate) || rate < 0)) {
      toast.error(t("errors.invalid"));
      return;
    }
    startTransition(async () => {
      const res = await updateMember({
        membershipId: member.id,
        role,
        jobTitle: jobTitle || undefined,
        payType,
        baseSalary: payType === "monthly" ? rate : null,
        hourlyRate: payType === "hourly" ? rate : null,
        staffCode: staffCode || undefined,
        pinCode: pinCode || undefined,
        status,
      });
      if (res.ok) {
        toast.success(t("edit.saved"));
        setOpen(false);
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={tc("actions.edit")}>
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("edit.title")}</DialogTitle>
          <DialogDescription>{t("edit.description", { name })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>{t("edit.role")}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAFF_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{t(`roles.${r}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t("edit.status")}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as "active" | "disabled")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("memberStatus.active")}</SelectItem>
                  <SelectItem value="disabled">{t("memberStatus.disabled")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-job">{t("edit.jobTitle")}</Label>
            <Input id="edit-job" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </div>
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
            {/* One field, not two: only the rate that matches the contract is
                ever shown, so nobody can leave a monthly salary sitting next to
                an hourly rate and wonder which one payroll used. */}
            <div className="grid gap-2">
              <Label htmlFor="edit-salary">
                {payType === "monthly" ? t("edit.baseSalary") : t("edit.hourlyRate")}
              </Label>
              <Input
                id="edit-salary"
                type="number"
                min={0}
                step={payType === "monthly" ? 1000 : 50}
                dir="ltr"
                className="tabular-nums"
                value={payType === "monthly" ? baseSalary : hourlyRate}
                onChange={(e) =>
                  payType === "monthly"
                    ? setBaseSalary(e.target.value)
                    : setHourlyRate(e.target.value)
                }
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {payType === "monthly" ? t("edit.monthlyHint") : t("edit.hourlyHint")}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="edit-code">{t("edit.staffCode")}</Label>
              <Input id="edit-code" dir="ltr" value={staffCode} onChange={(e) => setStaffCode(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-pin">{t("edit.pinCode")}</Label>
              <Input
                id="edit-pin"
                dir="ltr"
                inputMode="numeric"
                maxLength={8}
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{tc("actions.cancel")}</Button>
          <Button onClick={submit} disabled={pending}>{tc("actions.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
