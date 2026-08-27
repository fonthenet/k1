"use client";

import { DirectionProvider } from "@radix-ui/react-direction";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * App-wide client providers.
 *
 * DirectionProvider is not optional here: every Radix primitive (Select,
 * DropdownMenu, Menubar, Slider, Tabs…) reads its direction from this context
 * and falls back to "ltr" when it is missing. Without it, a Select in an
 * Arabic page renders `dir="ltr"` on its trigger — value pinned to the left,
 * chevron to the right — inside an otherwise right-to-left form.
 */
export function ThemeProvider({
  dir,
  children,
}: {
  dir: "rtl" | "ltr";
  children: React.ReactNode;
}) {
  return (
    <DirectionProvider dir={dir}>
      <NextThemesProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange
      >
        {children}
      </NextThemesProvider>
    </DirectionProvider>
  );
}
