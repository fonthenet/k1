"use client";

// The only interactive part of the FAQ section. Kept in its own client island
// so the heading, the contact card and the answer copy all render on the
// server — the answers arrive as props, already translated.

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export type FaqItem = { key: string; q: string; a: string };

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  return (
    <Accordion type="single" collapsible defaultValue={items[0]?.key}>
      {items.map((item) => (
        <AccordionItem key={item.key} value={item.key}>
          <AccordionTrigger className="gap-4 py-5 text-base font-semibold hover:no-underline aria-expanded:text-primary">
            {item.q}
          </AccordionTrigger>
          <AccordionContent className="pb-5 text-sm leading-relaxed text-pretty text-muted-foreground">
            {item.a}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
