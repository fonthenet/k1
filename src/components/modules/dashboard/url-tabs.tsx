"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";

/** Radix Tabs whose active tab is mirrored in the URL (?tab=…) so it survives
 *  month changes and reloads. Tab contents are server-rendered children. */
export function UrlTabs({
  defaultValue,
  paramName = "tab",
  className,
  children,
}: {
  defaultValue: string;
  paramName?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get(paramName) ?? defaultValue;

  return (
    <Tabs
      value={value}
      className={className}
      onValueChange={(v) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set(paramName, v);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }}
    >
      {children}
    </Tabs>
  );
}
