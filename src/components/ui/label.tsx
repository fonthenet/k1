"use client"

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"

/**
 * A field label, optionally marked required or optional.
 *
 * WHY THE MARK LIVES HERE. Before this, nothing in the product told anyone
 * which fields they had to fill: a director met a form, guessed, submitted,
 * and found out from a validation error. A few forms wrote "(facultatif)"
 * into the translated label by hand, which meant the convention existed in
 * some strings and nowhere else, and could not be applied consistently.
 *
 * ACCESSIBILITY. A bare "*" is announced as "star" or skipped entirely, so
 * the asterisk is aria-hidden and the real word rides along in a sr-only
 * span. Screen-reader users hear "Téléphone, obligatoire"; everyone else
 * sees the asterisk they expect. The `required` attribute on the input is
 * still what the browser and the server enforce — this only makes that
 * visible, and the two must be kept in step.
 */
function Label({
  className,
  children,
  required,
  optional,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & {
  required?: boolean
  optional?: boolean
}) {
  const t = useTranslations("common.labels")

  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      {required && (
        <span className="-ms-1 inline-flex items-baseline">
          <span aria-hidden className="text-destructive">
            *
          </span>
          <span className="sr-only">{t("required")}</span>
        </span>
      )}
      {optional && !required && (
        <span className="-ms-1 text-xs font-normal text-muted-foreground">
          ({t("optional")})
        </span>
      )}
    </LabelPrimitive.Root>
  )
}

export { Label }
