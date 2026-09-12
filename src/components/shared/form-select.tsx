"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const emptyOption = "__empty_option__";

/**
 * Themed selection with the same FormData and reset contract as other fields.
 *
 * The trigger is the same 32px control as Input, DatePicker and TimePicker,
 * so a filter bar or a two-up form row lines up on one baseline; it used to
 * be the one field 8px taller than its neighbours.
 */
export function FormSelect({
  name,
  options,
  value,
  defaultValue = "",
  onValueChange,
  placeholder,
  required,
}: {
  name: string;
  options: { value: string; label: string; disabled?: boolean }[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const locale = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selected = value ?? internalValue;
  useEffect(() => {
    const form = input.current?.form;
    const reset = () => setInternalValue(defaultValue);
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultValue]);
  return (
    <>
      <input ref={input} type="hidden" name={name} value={selected} />
      <Select
        dir={locale === "ar" ? "rtl" : "ltr"}
        required={required}
        value={
          selected ||
          (options.some((option) => option.value === "") ? emptyOption : "")
        }
        onValueChange={(next) => {
          const resolved = next === emptyOption ? "" : next;
          setInternalValue(resolved);
          onValueChange?.(resolved);
        }}
      >
        <SelectTrigger className="h-8 w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value || emptyOption}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
