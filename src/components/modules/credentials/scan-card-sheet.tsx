"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { IssueCardForm } from "./issue-card-dialog";
import type { CredentialSubject } from "./types";

/** One person a card may go to, as the record page around the dialog knows them. */
export interface ScanSubject {
  type: CredentialSubject;
  id: string;
  /** The name in the reader's language. */
  name: string;
  /** A signed photo URL; null draws the initials instead. */
  photoUrl: string | null;
  /** Latin initials — two Arabic letters side by side would form a word. */
  initials: string;
  /** One muted word under the name: the roster noun, the relation, the job. */
  caption?: string | null;
}

/** The selected tile is said by its border and nothing else. */
const TILE =
  "flex items-center gap-3 rounded-xl border-2 px-3 py-2 text-start transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * "Scanner une carte" on a record page: one outline button in the identity
 * band and the dialog behind it. A family arrives with a pile of fobs, and
 * until now each one meant scrolling to the right guardian's row and opening
 * that row's dialog; here the director picks the person and passes the card,
 * from the top of the page, without leaving it.
 *
 * With one subject (a member of staff) there is nothing to pick and the
 * dialog is the plain enrolment form. With several (a child and the adults
 * on the file) the people are radio tiles above the same form; the child is
 * the default because the child is whose page this is.
 */
export function ScanCardSheet({ subjects, path }: { subjects: ScanSubject[]; path: string }) {
  const t = useTranslations("credentials");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);

  if (subjects.length === 0) return null;

  const selected = subjects.find((s) => s.id === selectedId) ?? subjects[0];
  const picker = subjects.length > 1;

  function change(next: boolean) {
    // Every opening starts on the child again, whoever got the last card.
    if (next) setSelectedId(null);
    setOpen(next);
  }

  function pick(id: string) {
    setSelectedId(id);
    // Clicking a tile took the focus with it; the reader fires the moment the
    // card touches it, so the field has to have the focus back first.
    fieldRef.current?.focus();
  }

  function issued() {
    const person = selected;
    toast.success(
      t.rich("scan.issuedTo", {
        name: () => (
          <bdi dir="auto" className="font-semibold">
            {person.name}
          </bdi>
        ),
      })
    );
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" onClick={() => change(true)}>
        <ScanLine data-icon="inline-start" aria-hidden />
        {t("scan.title")}
      </Button>

      <Dialog open={open} onOpenChange={change}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{t("scan.title")}</DialogTitle>
            <DialogDescription>
              {picker ? t("scan.pickDescription") : t("dialog.description")}
            </DialogDescription>
          </DialogHeader>

          {picker && (
            <div className="grid gap-2">
              <Label id="scan-subject-label">{t("scan.subject")}</Label>
              <div
                role="radiogroup"
                aria-labelledby="scan-subject-label"
                className="grid gap-2 sm:grid-cols-2"
              >
                {subjects.map((s) => {
                  const isSelected = s.id === selected.id;
                  return (
                    <button
                      key={`${s.type}:${s.id}`}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => pick(s.id)}
                      className={cn(TILE, isSelected ? "border-primary" : "border-border")}
                    >
                      <Avatar className="size-9">
                        <AvatarImage src={s.photoUrl ?? undefined} alt="" />
                        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                          {s.initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <bdi dir="auto" className="block truncate text-sm font-medium">
                          {s.name}
                        </bdi>
                        {s.caption && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {s.caption}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <IssueCardForm
            subjectType={selected.type}
            subjectId={selected.id}
            path={path}
            fieldRef={fieldRef}
            onIssued={issued}
            onCancel={() => change(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
