"use client";

// "Changer de structure" — a family asks for the other side of the building.
//
// The dialog asks three things, in the order a parent thinks of them: which
// structure (the current one is not offered — asking to stay is not a
// request), which room if they have a preference, and why. It sends a
// REQUEST: kg_request_transfer files an application pointing at the existing
// child, and the director decides from the applications queue. The copy says
// "the office will confirm" rather than "your child has moved", because the
// second would be a lie on the day the family reads it, and a family who
// packed the child's things for the école on the strength of it would be
// told at the gate.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import type { PortalClassOption } from "./portal-types";
import { StructureChoice } from "./structure-choice";
import { ClassChoice, classesForStructure, CLASS_UNDECIDED } from "./class-choice";
import { requestTransfer } from "./actions";

export function RequestTransferDialog({
  childId,
  childName,
  dob,
  currentStructureId,
  structures,
  classes,
}: {
  childId: string;
  childName: string;
  /** Marks the room that fits the child's age in the structure chosen. */
  dob: string;
  /** Excluded from the cards: the request is always for somewhere else. */
  currentStructureId: string | null;
  structures: Structure[];
  classes: PortalClassOption[];
}) {
  const t = useTranslations("portal.transfer");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [structureId, setStructureId] = useState<string | null>(null);
  const [classId, setClassId] = useState<string>(CLASS_UNDECIDED);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const others = structures.filter((s) => s.id !== currentStructureId);
  // With exactly one other structure the first question answers itself, so
  // it is pre-answered and the cards show it selected rather than asking.
  const effectiveStructureId = structureId ?? (others.length === 1 ? others[0].id : null);
  const target = others.find((s) => s.id === effectiveStructureId) ?? null;
  const roomsOffered = effectiveStructureId
    ? classesForStructure(classes, effectiveStructureId)
    : [];

  function reset() {
    setStructureId(null);
    setClassId(CLASS_UNDECIDED);
    setNote("");
  }

  function submit() {
    if (!effectiveStructureId) return;
    startTransition(async () => {
      const res = await requestTransfer({
        childId,
        structureId: effectiveStructureId,
        classId: classId === CLASS_UNDECIDED ? null : classId,
        note,
      });
      if (res.ok) {
        toast.success(t("success", { name: childName }));
        setOpen(false);
        reset();
        // The action revalidated the path; the refresh is what makes THIS
        // page re-read it, so the button becomes "request pending" in place
        // rather than on the next visit — the same belt-and-braces the
        // health editors use.
        router.refresh();
        return;
      }
      // Each refusal the RPC names is something the parent can understand
      // — and in two of the four cases, something the page had not caught
      // up with yet (a request filed from another phone, a child withdrawn
      // this morning), so the sentence says what is true now.
      const message =
        res.error === "transferPending"
          ? t("errors.transferPending")
          : res.error === "sameStructure"
            ? t("errors.sameStructure")
            : res.error === "notEnrolled"
              ? t("errors.notEnrolled")
              : res.error === "unknownStructure"
                ? t("errors.unknownStructure")
                : tc("toasts.error");
      toast.error(message);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-11 rounded-lg px-3">
          <ArrowRightLeft data-icon="inline-start" />
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { name: childName })}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label>{t("structureLabel")}</Label>
            <StructureChoice
              structures={others}
              classes={classes}
              value={effectiveStructureId}
              onChange={(id) => {
                setStructureId(id);
                // A room belongs to a structure; changing one forgets the other.
                setClassId(CLASS_UNDECIDED);
              }}
              ariaLabel={t("structureLabel")}
            />
          </div>

          {/* Only once a structure is chosen, and only when it has rooms to
              name: a family should not be shown "let the crèche decide" as
              the sole option, which reads as a broken form. */}
          {target && roomsOffered.length > 0 && (
            <div className="grid gap-2">
              <Label>
                {t("classLabel")}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({tc("labels.optional")})
                </span>
              </Label>
              <ClassChoice
                classes={classes}
                structures={structures}
                structureId={target.id}
                dob={dob}
                value={classId}
                onChange={setClassId}
                ariaLabel={t("classLabel")}
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="transfer-note">
              {t("noteLabel")}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({tc("labels.optional")})
              </span>
            </Label>
            <Textarea
              id="transfer-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              maxLength={1000}
              dir="auto"
              className="text-start"
            />
          </div>

          {/* The one consequence, as one sentence with the changed fact in
              bold — said once a structure is chosen, before the button, so it
              is read before the tap and not after. */}
          {target && (
            <p className="text-sm text-muted-foreground">
              {t.rich("consequence", {
                structure: structureName(target, locale),
                b: (chunks) => <b className="font-semibold text-foreground">{chunks}</b>,
              })}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="lg" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button size="lg" onClick={submit} disabled={pending || !effectiveStructureId}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
