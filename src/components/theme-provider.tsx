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
      {/*
        LIGHT ONLY, deliberately.

        `enableSystem` used to be on, so anyone whose laptop or phone sat in
        dark mode got the dark palette — while the app shipped no way to turn it
        off, because there is no theme toggle anywhere in the product. A theme
        nobody chose and nobody can leave is not a feature.

        `forcedTheme` rather than just dropping `enableSystem`: next-themes
        honours a previously stored preference, so anyone already carrying
        `theme: dark` in localStorage would have stayed dark forever.

        The kiosk is the one exception and it still works. It applies `.dark` to
        its OWN wrapper (kiosk-shell.tsx) to go dark after dusk on a tablet
        mounted by the door, and the dark variant is `&:is(.dark *)` — scoped to
        descendants of any element carrying the class, not to <html>. So the
        door tablet keeps its night mode while the rest of the app stays light.
      */}
      <NextThemesProvider
        attribute="class"
        defaultTheme="light"
        forcedTheme="light"
        disableTransitionOnChange
      >
        {children}
      </NextThemesProvider>
    </DirectionProvider>
  );
}
