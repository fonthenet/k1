"use client";

import { useTranslations } from "next-intl";
import { Check, Delete } from "lucide-react";
import { cn } from "@/lib/utils";

const KEY_ROWS: string[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["K-", "0", "-"],
];

function Key({
  children,
  onClick,
  className,
  label,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-14 items-center justify-center rounded-2xl border border-border bg-secondary text-2xl font-bold text-secondary-foreground transition-transform select-none",
        "active:scale-95 active:bg-accent active:text-accent-foreground disabled:opacity-40 sm:h-16 sm:text-3xl",
        className
      )}
    >
      {children}
    </button>
  );
}

export function KioskKeypad({
  onKey,
  onBackspace,
  onClear,
  onSubmit,
  disabled,
}: {
  onKey: (key: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  const t = useTranslations("kiosk");
  return (
    <div className="w-full max-w-sm space-y-2">
      {KEY_ROWS.map((row, i) => (
        <div key={i} className="grid grid-cols-3 gap-2">
          {row.map((k) => (
            <Key key={k} onClick={() => onKey(k)} disabled={disabled}>
              {k}
            </Key>
          ))}
        </div>
      ))}
      <div className="grid grid-cols-3 gap-2">
        <Key
          onClick={onClear}
          disabled={disabled}
          label={t("keypad.clear")}
          className="text-base font-semibold text-muted-foreground sm:text-lg"
        >
          C
        </Key>
        <Key onClick={onBackspace} disabled={disabled} label={t("keypad.backspace")}>
          <Delete className="size-7 rtl:-scale-x-100" />
        </Key>
        <Key
          onClick={onSubmit}
          disabled={disabled}
          label={t("keypad.validate")}
          className="border-transparent bg-primary text-primary-foreground shadow-lg shadow-primary/20 active:bg-primary/80 active:text-primary-foreground"
        >
          <Check className="size-8" />
        </Key>
      </div>
    </div>
  );
}
