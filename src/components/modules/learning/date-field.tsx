"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DatePicker } from "@/components/shared/date-picker";

/** Adapts the shared themed picker to the learning forms' FormData contract. */
export function LearningDateField({
  name, defaultValue = "", required, minDate, maxDate,
}: {
  name: string;
  defaultValue?: string;
  required?: boolean;
  minDate?: string;
  maxDate?: string;
}) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = input.current?.form;
    const reset = () => setValue(defaultValue);
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultValue]);
  return <>
    <input ref={input} type="hidden" name={name} value={value} />
    <DatePicker id={id} value={value} onChange={setValue} required={required}
      minDate={minDate} maxDate={maxDate} />
  </>;
}
