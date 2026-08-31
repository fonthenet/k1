import Link from "next/link";
import { Baby } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The child a conversation is about, as a tinted badge that opens their profile.
 *
 * Two things about it are deliberate.
 *
 * `variant="tinted"` rather than the default: every other variant hard-codes a
 * hover colour through `[a]:hover:bg-primary/80`, an element+class selector
 * that outranks anything passed in `className`. As a link with the default
 * variant this badge turned solid primary the moment you hovered it.
 *
 * `pointer-events-auto` because the rows that show it — the inbox panel, both
 * /messages lists — are one big click target for the conversation, and a link
 * cannot legally nest inside the button or link that makes it one. Those rows
 * put their target behind the content and switch the content's pointer events
 * off; this badge is the one part that takes clicks back.
 */
export function ChildBadge({
  id,
  name,
  portal = false,
  className,
}: {
  /** Null on a thread with no child attached — then it is a plain badge. */
  id: string | null;
  name: string;
  /** Parent-facing shells route to their own copy of the profile. */
  portal?: boolean;
  className?: string;
}) {
  const tint = cn("shrink-0 border-transparent bg-primary/10 font-medium text-primary", className);
  const content = (
    <>
      <Baby data-icon="inline-start" />
      {name}
    </>
  );

  if (!id) return <Badge className={tint}>{content}</Badge>;

  return (
    <Badge asChild variant="tinted" className={cn(tint, "pointer-events-auto relative")}>
      <Link href={portal ? `/portal/children/${id}` : `/children/${id}`}>{content}</Link>
    </Badge>
  );
}
